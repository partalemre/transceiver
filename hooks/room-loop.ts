import type { Timer } from 'claude-code'

import type { Host } from './host'
import { DISCOVER_MS } from './limits'
import type { Message } from './protocol'
import { callerOf, relayOf, type HeadState } from './relay'
import { discoverInvites, loadRooms, loadSettings, saveRooms, type RoomRecord } from './rooms'
import { enqueue, initialSync, nextDelay, tick, type RoomSync } from './sync'
import type { Entry } from './timeline'

// One timer per active room. The sync state lives here and in `$.store` (a reload drops module state and timers;
// `session.start` starts the loop again from the store).

// `tookMs`: how long the poll took, the pane's "sinyal" figure. `docsUsed`: the room's document count from the
// newest write result that named it (T15 rollover), when one did.
export type TickEvent = { room: RoomRecord; state: RoomSync; fresh: Entry[]; isDenied: boolean; tookMs?: number; docsUsed?: number }
type Listener = (ev: TickEvent) => Promise<void>

const syncKey = (id: string) => `tx.sync.${id}`
const syncs = new Map<string, RoomSync>()
const saved = new Map<string, string>()
const timers = new Map<string, Timer>()
const active = new Set<string>()
const errors = new Map<string, number>()
const used = new Map<string, number>()
// One poll per room at a time: a poke while one is in flight runs again right after it, never beside it.
const running = new Set<string>()
const rerun = new Set<string>()
const listeners: Listener[] = []
let viewing: string | null = null
let isPaneOpen = false
let discovery: Timer | null = null
let isDiscovering = false

// Returns the unsubscribe, so a rewiring (or a test) never stacks listeners.
export function onTick(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const at = listeners.indexOf(fn)
    if (at >= 0) listeners.splice(at, 1)
  }
}
export const setViewing = (roomId: string | null, isOpen: boolean) => { viewing = roomId; isPaneOpen = isOpen }
export const syncOf = (roomId: string) => syncs.get(roomId)

const isSync = (x: unknown): x is RoomSync =>
  typeof x === 'object' && x !== null && typeof (x as RoomSync).selfUid === 'string' && Array.isArray((x as RoomSync).entries)

async function loadSync(host: Host, room: RoomRecord): Promise<RoomSync> {
  const cached = syncs.get(room.id)
  if (cached !== undefined) return cached
  const stored = await host.storeGet(syncKey(room.id))
  const state = isSync(stored) ? stored : initialSync(await relayOf(callerOf(host), room.url).whoami())
  syncs.set(room.id, state)
  return state
}

// The store is written only when something a restart needs moved, not on every quiet poll.
const fingerprint = (s: RoomSync) =>
  JSON.stringify([s.ownVersion, s.cursors, s.pending.map(m => m.id), s.entries.length, s.entries.at(-1)?.message.id, s.failures])

async function persist(host: Host, roomId: string, state: RoomSync): Promise<void> {
  const print = fingerprint(state)
  if (saved.get(roomId) === print) return
  await host.storeSet(syncKey(roomId), state)
  saved.set(roomId, print)
}

// Messages queued while a tick was in flight are carried onto its result, so none is lost.
function carryQueued(opts: { before: RoomSync; during: RoomSync | undefined; after: RoomSync }): RoomSync {
  const { before, during, after } = opts
  if (during === undefined || during === before) return after
  const known = new Set(before.pending.map(m => m.id))
  return during.pending.filter(m => !known.has(m.id)).reduce(enqueue, after)
}

async function step(host: Host, room: RoomRecord): Promise<void> {
  const before = await loadSync(host, room)
  const settings = await loadSettings(host)
  const isViewing = isPaneOpen && viewing === room.id
  const relay = relayOf(callerOf(host), room.url)
  const startedAt = await host.now()
  // Until the session is connected (spike R1) the loop only reads: no send, no read mark raises an approval.
  const out = await tick({ relay, state: before, isViewing, isReceiptsOn: settings.isReceiptsOn, now: startedAt, canWrite: host.isConnected() })
  const tookMs = (await host.now()) - startedAt
  // Left while the poll was in flight: nothing of it is kept.
  if (!active.has(room.id)) return
  const state = carryQueued({ before, during: syncs.get(room.id), after: out.state })
  syncs.set(room.id, state)
  await persist(host, room.id, state)
  const docsUsed = relay.usage() ?? used.get(room.id)
  if (docsUsed !== undefined) used.set(room.id, docsUsed)
  for (const fn of listeners) await fn({ room, state, fresh: out.fresh, isDenied: out.isDenied, tookMs, docsUsed })
  // A listener that queued a message (an answer) gets it sent at once rather than a poll later.
  const isQueued = (syncs.get(room.id)?.pending.length ?? 0) > state.pending.length
  schedule(host, room, isQueued ? 0 : nextDelay({ isPaneOpen, failures: state.failures }))
}

// Only the room's title and the error's name reach the log, never message text or tool output.
async function run(host: Host, room: RoomRecord): Promise<void> {
  if (running.has(room.id)) {
    rerun.add(room.id)
    return
  }
  running.add(room.id)
  try {
    await step(host, room)
    errors.delete(room.id)
  } catch (err) {
    const failures = (errors.get(room.id) ?? 0) + 1
    errors.set(room.id, failures)
    host.log(`transceiver: ${room.title}: ${err instanceof Error ? err.name : 'error'}`)
    schedule(host, room, nextDelay({ isPaneOpen, failures }))
  } finally {
    running.delete(room.id)
  }
  if (rerun.delete(room.id)) schedule(host, room, 0)
}

function schedule(host: Host, room: RoomRecord, ms: number): void {
  timers.get(room.id)?.cancel()
  if (!active.has(room.id)) return
  timers.set(room.id, host.after(ms, () => { void run(host, room) }))
}

export function pokeRoom(host: Host, room: RoomRecord): void {
  active.add(room.id)
  schedule(host, room, 0)
}

export function stopRoom(roomId: string): void {
  active.delete(roomId)
  timers.get(roomId)?.cancel()
  timers.delete(roomId)
  used.delete(roomId)
  rerun.delete(roomId)
}

// Leaving for good: the poll stops and the room's sync state goes, from memory and from the store (a rejoin
// starts a new record, so the old state would never be read again).
export async function forgetRoom(host: Host, roomId: string): Promise<void> {
  stopRoom(roomId)
  syncs.delete(roomId)
  saved.delete(roomId)
  errors.delete(roomId)
  await host.storeSet(syncKey(roomId), null)
}

// Takes the own head a listener wrote (e.g. the `gh` login), so the next send is pinned to its version.
export function adoptOwnHead(roomId: string, own: HeadState): void {
  const state = syncs.get(roomId)
  if (state === undefined || own.version <= state.ownVersion) return
  syncs.set(roomId, { ...state, ownHead: own.head, ownVersion: own.version })
}

// Shows the message at once (pending) and sends it on the room's next tick. False until the room has synced once.
export function enqueueMessage(opts: { host: Host; room: RoomRecord; message: Message }): boolean {
  const state = syncs.get(opts.room.id)
  if (state === undefined) return false
  syncs.set(opts.room.id, enqueue(state, opts.message))
  pokeRoom(opts.host, opts.room)
  return true
}

// One discovery at a time. The rooms are read again before saving: one joined by link meanwhile is not added twice.
async function discover(host: Host): Promise<void> {
  if (isDiscovering) return
  isDiscovering = true
  try {
    const found = await discoverInvites({ host, known: await loadRooms(host) }).catch(() => [])
    const rooms = await loadRooms(host)
    const urls = new Set(rooms.map(r => r.url))
    const added = found.filter(r => !urls.has(r.url))
    if (added.length > 0) await saveRooms(host, [...rooms, ...added])
  } finally {
    isDiscovering = false
  }
}

export async function startLoop(host: Host): Promise<void> {
  for (const room of await loadRooms(host)) if (room.status === 'active') pokeRoom(host, room)
  discovery?.cancel()
  discovery = host.every(DISCOVER_MS, () => { void discover(host) })
}
