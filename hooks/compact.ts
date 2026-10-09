import { COMPACT_AFTER_MS, COMPACT_BATCH_DELETES, DAY_DOC_MAX_BYTES, MAX_DAY_PARTS } from './limits'
import { utf8Bytes, type Message } from './protocol'
import type { Relay, Stored } from './relay'

// Retention (T15): each person moves their own week-old messages into one doc per UTC day, which is all the room's
// rules let them write. A busy day goes on in `<day>.2`, `<day>.3`, … so no doc nears the 1 MiB batch body.

export type Compacted = { moved: number; isDone: boolean }
type Opts = { relay: Relay; uid: string; now: number }
type Group = Opts & { day: string; items: Stored[] }

export const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10)
export const dayDocId = (day: string, part: number) => (part <= 1 ? day : `${day}.${part}`)

export function groupByDay(items: readonly Stored[]): Map<string, Stored[]> {
  const groups = new Map<string, Stored[]>()
  for (const item of items) {
    const key = dayOf(item.message.ts)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return groups
}

// Each batch leaves one write for the day doc: 49 deletes and the day make 50.
export function deleteBatches<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += COMPACT_BATCH_DELETES) out.push(items.slice(i, i + COMPACT_BATCH_DELETES))
  return out
}

const order = (a: Message, b: Message) => a.ts - b.ts || (a.id < b.id ? -1 : 1)

// By id, oldest first: a message already in the day (a retried batch, or one a crash left in both places) is
// kept once.
export function mergeDay(known: readonly Message[], adding: readonly Message[]): Message[] {
  const byId = new Map(known.map(m => [m.id, m]))
  for (const m of adding) byId.set(m.id, m)
  return [...byId.values()].sort(order)
}

const docBytes = (msgs: readonly Message[]) => utf8Bytes(JSON.stringify({ v: 1, ts: Number.MAX_SAFE_INTEGER, msgs }))

// How many of `batch` fit beside what the day doc already holds.
export function fitting(known: readonly Message[], batch: readonly Stored[]): number {
  const ids = new Set(known.map(m => m.id))
  let size = docBytes(known)
  let n = 0
  for (const item of batch) {
    const add = ids.has(item.message.id) ? 0 : utf8Bytes(JSON.stringify(item.message)) + 1
    if (size + add > DAY_DOC_MAX_BYTES) break
    size += add
    n += 1
  }
  return n
}

// One day's messages, batch by batch. A refused batch (another session moved the day doc or a message) throws:
// nothing of it was written, and the next run starts again from what is stored.
async function compactGroup(g: Group): Promise<number> {
  let queue = g.items
  let moved = 0
  let part = 1
  while (queue.length > 0 && part <= MAX_DAY_PARTS) {
    const docId = dayDocId(g.day, part)
    const existing = await g.relay.day(g.uid, docId)
    const known = existing?.msgs ?? []
    const batch = queue.slice(0, fitting(known, deleteBatches(queue)[0] ?? []))
    if (batch.length === 0) { part += 1; continue }
    const msgs = mergeDay(known, batch.map(b => b.message))
    const deletes = batch.map(b => ({ id: b.message.id, version: b.version }))
    await g.relay.compactDay({ uid: g.uid, docId, msgs, dayVersion: existing?.version, deletes })
    moved += batch.length
    queue = queue.slice(batch.length)
  }
  return moved
}

// One page of the oldest week-old messages per run; `isDone` once a run found less than a full page.
export async function compactRoom(opts: Opts): Promise<Compacted> {
  const old = await opts.relay.older(opts.uid, opts.now - COMPACT_AFTER_MS)
  let moved = 0
  for (const [day, items] of groupByDay(old.items)) moved += await compactGroup({ ...opts, day, items })
  return { moved, isDone: !old.isFull }
}
