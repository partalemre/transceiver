import type { Timer } from 'claude-code'

import type { Host } from './host'
import { DISCOVER_MS } from './limits'
import type { Message } from './protocol'
import { callerOf, relayOf } from './relay'
import { discoverInvites, loadRooms, loadSettings, saveRooms, type RoomRecord } from './rooms'
import { enqueue, initialSync, nextDelay, tick, type RoomSync } from './sync'
import type { Entry } from './timeline'

// One timer per active room. The sync state lives here and in `$.store` (a reload drops module state and timers;
// `session.start` starts the loop again from the store).

export type TickEvent = { room: RoomRecord; state: RoomSync; fresh: Entry[]; isDenied: boolean }
type Listener = (ev: TickEvent) => Promise<void>

const syncKey = (id: string) => `tx.sync.${id}`
const syncs = new Map<string, RoomSync>()
const saved = new Map<string, string>()
const timers = new Map<string, Timer>()
const active = new Set<string>()
const errors = new Map<string, number>()
const listeners: Listener[] = []
let viewing: string | null = null
let isPaneOpen = false
let discovery: Timer | null = null

export const onTick = (fn: Listener) => { listeners.push(fn) }
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
  const out = await tick({ relay, state: before, isViewing, isReceiptsOn: settings.isReceiptsOn, now: await host.now() })
  const state = carryQueued({ before, during: syncs.get(room.id), after: out.state })
  syncs.set(room.id, state)
  await persist(host, room.id, state)
  for (const fn of listeners) await fn({ room, state, fresh: out.fresh, isDenied: out.isDenied })
  schedule(host, room, nextDelay({ isPaneOpen, failures: state.failures }))
}

// Only the room's title and the error's name reach the log, never message text or tool output.
async function run(host: Host, room: RoomRecord): Promise<void> {
  try {
    await step(host, room)
    errors.delete(room.id)
  } catch (err) {
    const failures = (errors.get(room.id) ?? 0) + 1
    errors.set(room.id, failures)
    host.log(`transceiver: ${room.title}: ${err instanceof Error ? err.name : 'error'}`)
    schedule(host, room, nextDelay({ isPaneOpen, failures }))
  }
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
}

// Shows the message at once (pending) and sends it on the room's next tick. False until the room has synced once.
export function enqueueMessage(opts: { host: Host; room: RoomRecord; message: Message }): boolean {
  const state = syncs.get(opts.room.id)
  if (state === undefined) return false
  syncs.set(opts.room.id, enqueue(state, opts.message))
  pokeRoom(opts.host, opts.room)
  return true
}

async function discover(host: Host): Promise<void> {
  const rooms = await loadRooms(host)
  const found = await discoverInvites({ host, known: rooms }).catch(() => [])
  if (found.length > 0) await saveRooms(host, [...(await loadRooms(host)), ...found])
}

export async function startLoop(host: Host): Promise<void> {
  for (const room of await loadRooms(host)) if (room.status === 'active') pokeRoom(host, room)
  discovery?.cancel()
  discovery = host.every(DISCOVER_MS, () => { void discover(host) })
}
