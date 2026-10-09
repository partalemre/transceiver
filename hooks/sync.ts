import { DAYS_PULL_AFTER_MS, KEEP_ENTRIES, POLL_BACKOFF, POLL_CLOSED_MS, POLL_MAX_MS, POLL_OPEN_MS, SINCE_PAGE } from './limits'
import { authorKey } from './authors'
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
  // Which mailbox each author (authors.ts key) writes, for their names; and the other members' mailboxes the last
  // poll could not read (not shared with this person yet, or gone).
  boxOf: Record<string, string>
  unread: string[]
}

// `relay` is this person's own mailbox, the only one written; `boxes` are the other members', read only. `now`
// stamps `readTs`; without it the newest read message's time stands in. `canWrite: false` (the session is not
// connected yet) pulls only: queued messages and read marks wait.
export type TickOpts = {
  relay: Relay; boxes?: Relay[]; state: RoomSync; isViewing: boolean; isReceiptsOn: boolean; now?: number; canWrite?: boolean
}
export type TickResult = { state: RoomSync; fresh: Entry[]; isDenied: boolean }

type Outcome = { state: RoomSync; isDenied: boolean; hasFailed: boolean }

export const initialSync = (selfUid: string): RoomSync => ({
  selfUid, ownHead: emptyHead(), ownVersion: 0, cursors: {}, peers: {}, entries: [], pending: [], failures: 0, boxOf: {}, unread: [],
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

type Pull = { relay: Relay; state: RoomSync; now?: number }
type Pulled = { state: RoomSync; fresh: Entry[] }
type Author = { uid: string; key: string }

// A cursor near the compaction age may have missed messages their author has since moved into day docs (T15):
// those are read too. A message in both places (a crash between batches) is one entry, merged by id.
async function compacted(opts: Pull & { author: Author; cursor: number }): Promise<Entry[]> {
  const isAway = opts.now !== undefined && opts.cursor < opts.now - DAYS_PULL_AFTER_MS
  if (!isAway) return []
  return (await opts.relay.days(opts.author.uid, opts.cursor)).map(message => ({ author: opts.author.key, message }))
}

async function pullOne(opts: Pull & { author: Author }, entry: HeadEntry): Promise<{ state: RoomSync; got: Entry[] }> {
  const { head } = entry
  const { state, author } = opts
  const { key } = author
  const seen = key === state.selfUid ? withOwn(state, entry) : { ...state, peers: { ...state.peers, [key]: head } }
  const s = { ...seen, boxOf: { ...seen.boxOf, [key]: opts.relay.url } }
  const cursor = s.cursors[key] ?? 0
  if (head.head === '' || head.headTs <= cursor) return { state: s, got: [] }
  const older = await compacted({ ...opts, cursor })
  const recent = (await opts.relay.since(author.uid, cursor)).map(message => ({ author: key, message }))
  const cursors = { ...s.cursors, [key]: nextCursor({ cursor, head, got: recent }) }
  const got = mergeEntries([], [...older, ...recent])
  return { state: { ...s, cursors, entries: mergeEntries(s.entries, got, KEEP_ENTRIES) }, got }
}

// Only a mailbox's owner writes it, so it holds one author: the first seen there is its author for good (the own
// mailbox's is this person, bound before anything is read), and a head under any other uid there is skipped.
function isAuthorOf(state: RoomSync, key: string, url: string): boolean {
  const box = state.boxOf[key]
  return box === undefined ? !Object.values(state.boxOf).includes(url) : box === url
}

async function pullBox(opts: Pull & { isOwn: boolean }): Promise<Pulled> {
  let s = opts.state
  const fresh: Entry[] = []
  for (const entry of await opts.relay.heads()) {
    const author = { uid: entry.uid, key: authorKey({ uid: entry.uid, url: opts.relay.url, isOwn: opts.isOwn }) }
    if (!isAuthorOf(s, author.key, opts.relay.url)) continue
    const out = await pullOne({ ...opts, state: s, author }, entry)
    s = out.state
    if (author.key !== s.selfUid) fresh.push(...out.got)
  }
  return { state: s, fresh }
}

// The own mailbox first: a failure there fails the tick. Another member's mailbox that cannot be read is noted and
// skipped, so one member who has not shared theirs yet never stops the rest of the room.
async function pull(opts: Pull & { boxes: Relay[] }): Promise<Pulled> {
  const { state } = opts
  const own = await pullBox({ ...opts, isOwn: true, state: { ...state, boxOf: { ...state.boxOf, [state.selfUid]: opts.relay.url } } })
  let s = own.state
  const fresh = [...own.fresh]
  const unread: string[] = []
  for (const relay of opts.boxes) {
    try {
      const out = await pullBox({ ...opts, relay, isOwn: false, state: s })
      s = out.state
      fresh.push(...out.fresh)
    } catch (err) {
      if (!(err instanceof RelayError)) throw err
      unread.push(relay.url)
    }
  }
  return { state: { ...s, unread }, fresh }
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
    const pulled = await pull({ relay: opts.relay, boxes: opts.boxes ?? [], state: sent.state, now: opts.now })
    const acked = sent.isDenied || !canWrite ? settled(pulled.state) : await ackOutcome({ ...opts, state: pulled.state }, pulled.fresh)
    const failures = sent.hasFailed || acked.hasFailed ? opts.state.failures + 1 : 0
    return { state: { ...acked.state, failures }, fresh: pulled.fresh, isDenied: sent.isDenied || acked.isDenied }
  } catch (err) {
    const failed = asOutcome(sent.state, err)
    return { state: { ...failed.state, failures: opts.state.failures + 1 }, fresh: [], isDenied: sent.isDenied }
  }
}
