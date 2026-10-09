import { KEEP_ENTRIES, POLL_BACKOFF, POLL_CLOSED_MS, POLL_MAX_MS, POLL_OPEN_MS, SINCE_PAGE } from './limits'
import { emptyHead, isUnreadable } from './protocol'
import type { Head, Message } from './protocol'
import { RelayError } from './relay'
import type { HeadEntry, HeadState, Relay } from './relay'
import { mergeEntries, type Entry } from './timeline'

export type RoomSync = {
  selfUid: string
  ownHead: Head
  ownVersion: number
  cursors: Record<string, number>
  peers: Record<string, Head>
  entries: Entry[]
  pending: Message[]
  failures: number
}

// `now` stamps `readTs`; without it the newest read message's time stands in. `canWrite: false` (the session is
// not connected yet) pulls only: queued messages and read marks wait.
export type TickOpts = { relay: Relay; state: RoomSync; isViewing: boolean; isReceiptsOn: boolean; now?: number; canWrite?: boolean }
export type TickResult = { state: RoomSync; fresh: Entry[]; isDenied: boolean }

type Outcome = { state: RoomSync; isDenied: boolean; hasFailed: boolean }

export const initialSync = (selfUid: string): RoomSync => ({
  selfUid, ownHead: emptyHead(), ownVersion: 0, cursors: {}, peers: {}, entries: [], pending: [], failures: 0,
})

export function enqueue(state: RoomSync, message: Message): RoomSync {
  const entry: Entry = { author: state.selfUid, message, isPending: true }
  return { ...state, pending: [...state.pending, message], entries: mergeEntries(state.entries, [entry], KEEP_ENTRIES) }
}

export function nextDelay(opts: { isPaneOpen: boolean; failures: number }): number {
  const base = opts.isPaneOpen ? POLL_OPEN_MS : POLL_CLOSED_MS
  return Math.min(POLL_MAX_MS, base * POLL_BACKOFF ** opts.failures)
}

// The cached own head rides along as `known`, so a send or an ack needs no read unless another session moved it.
const knownOf = (s: RoomSync): HeadState | undefined => (s.ownVersion > 0 ? { head: s.ownHead, version: s.ownVersion } : undefined)
const withOwn = (s: RoomSync, own: HeadState): RoomSync => ({ ...s, ownHead: own.head, ownVersion: own.version })

const settled = (state: RoomSync): Outcome => ({ state, isDenied: false, hasFailed: false })

function asOutcome(state: RoomSync, err: unknown): Outcome {
  if (!(err instanceof RelayError)) throw err
  return { state, isDenied: err.kind === 'denied', hasFailed: err.kind !== 'denied' }
}

// Sends in order and stops at the first refusal, so a later message never lands before an earlier one.
async function flush(relay: Relay, state: RoomSync): Promise<Outcome> {
  let s = state
  for (const message of state.pending) {
    try {
      const own = await relay.send({ uid: s.selfUid, message, known: knownOf(s) })
      s = { ...withOwn(s, own), pending: s.pending.filter(p => p.id !== message.id) }
      s = { ...s, entries: mergeEntries(s.entries, [{ author: s.selfUid, message }], KEEP_ENTRIES) }
    } catch (err) {
      return asOutcome(s, err)
    }
  }
  return settled(s)
}

// A short page means everything up to the head was read, unreadable docs included: the cursor moves to the head.
function nextCursor(opts: { cursor: number; head: Head; got: Entry[] }): number {
  const lastTs = opts.got.reduce((max, e) => (isUnreadable(e.message) ? max : Math.max(max, e.message.ts)), opts.cursor)
  return opts.got.length < SINCE_PAGE ? Math.max(lastTs, opts.head.headTs) : lastTs
}

async function pullOne(relay: Relay, state: RoomSync, entry: HeadEntry): Promise<{ state: RoomSync; got: Entry[] }> {
  const { uid, head } = entry
  const s = uid === state.selfUid ? withOwn(state, entry) : { ...state, peers: { ...state.peers, [uid]: head } }
  const cursor = s.cursors[uid] ?? 0
  if (head.head === '' || head.headTs <= cursor) return { state: s, got: [] }
  const got = (await relay.since(uid, cursor)).map(message => ({ author: uid, message }))
  const cursors = { ...s.cursors, [uid]: nextCursor({ cursor, head, got }) }
  return { state: { ...s, cursors, entries: mergeEntries(s.entries, got, KEEP_ENTRIES) }, got }
}

async function pull(relay: Relay, state: RoomSync): Promise<{ state: RoomSync; fresh: Entry[] }> {
  let s = state
  const fresh: Entry[] = []
  for (const entry of await relay.heads()) {
    const out = await pullOne(relay, s, entry)
    s = out.state
    if (entry.uid !== s.selfUid) fresh.push(...out.got)
  }
  return { state: s, fresh }
}

// Seen moves with every message pulled; read follows it only while the person has this room open. Both catch up
// on what was pulled while the session could not write yet, not only on this tick's fresh messages.
async function acknowledge(opts: TickOpts, fresh: Entry[]): Promise<RoomSync> {
  const { state } = opts
  const own = state.ownHead
  const theirs = state.entries.filter(e => e.author !== state.selfUid)
  const newest = [...theirs, ...fresh].reduce((max, e) => (e.message.id > max ? e.message.id : max), own.seenUpTo)
  const isReading = opts.isViewing && opts.isReceiptsOn && newest > own.readUpTo
  if (newest === own.seenUpTo && !isReading) return state
  const newestTs = fresh.reduce((max, e) => (isUnreadable(e.message) ? max : Math.max(max, e.message.ts)), own.readTs)
  const mark = { uid: state.selfUid, seenUpTo: newest, known: knownOf(state) }
  const out = await opts.relay.markRead(isReading ? { ...mark, readUpTo: newest, readTs: opts.now ?? newestTs } : mark)
  return withOwn(state, out)
}

async function ackOutcome(opts: TickOpts, fresh: Entry[]): Promise<Outcome> {
  try {
    return settled(await acknowledge(opts, fresh))
  } catch (err) {
    return asOutcome(opts.state, err)
  }
}

// A write the session has not approved yet (spike R1) must not stop reading: pull still runs, sends wait.
export async function tick(opts: TickOpts): Promise<TickResult> {
  const canWrite = opts.canWrite !== false
  const sent = canWrite ? await flush(opts.relay, opts.state) : settled(opts.state)
  try {
    const pulled = await pull(opts.relay, sent.state)
    const acked = sent.isDenied || !canWrite ? settled(pulled.state) : await ackOutcome({ ...opts, state: pulled.state }, pulled.fresh)
    const failures = sent.hasFailed || acked.hasFailed ? opts.state.failures + 1 : 0
    return { state: { ...acked.state, failures }, fresh: pulled.fresh, isDenied: sent.isDenied || acked.isDenied }
  } catch (err) {
    const failed = asOutcome(sent.state, err)
    return { state: { ...failed.state, failures: opts.state.failures + 1 }, fresh: [], isDenied: sent.isDenied }
  }
}
