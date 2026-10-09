import type { Head, Message, Unreadable } from './protocol'
import type { Receipt } from './state-types'

export type Entry = { author: string; message: Message | Unreadable; isPending?: boolean }

const tsOf = (e: Entry) => ('ts' in e.message ? e.message.ts : 0)
const order = (a: Entry, b: Entry) => tsOf(a) - tsOf(b) || (a.message.id < b.message.id ? -1 : 1)

// Keyed by author and id: ids are not namespaced by outbox, so a peer reusing my message's id in their own outbox
// is their message, never a copy of mine.
const keyOf = (e: Entry) => `${e.author}/${e.message.id}`

export function mergeEntries(current: Entry[], incoming: Entry[], keep = Number.POSITIVE_INFINITY): Entry[] {
  const byId = new Map<string, Entry>()
  for (const e of current) byId.set(keyOf(e), e)
  for (const e of incoming) {
    const prev = byId.get(keyOf(e))
    // A pending copy never replaces a stored one; a stored copy always replaces a pending one.
    if (prev === undefined || prev.isPending === true) byId.set(keyOf(e), e.isPending === true ? e : { author: e.author, message: e.message })
  }
  const sorted = [...byId.values()].sort(order)
  return sorted.slice(Math.max(0, sorted.length - keep))
}

// Ids sort by time across authors, so a peer's cursor at or past my message's id means it reached them.
export function receiptOf(opts: { entry: Entry; selfUid: string; peers: Head[]; isReceiptsOn: boolean }): Receipt {
  const { entry, peers } = opts
  if (entry.isPending === true) return 'pending'
  const id = entry.message.id
  const isRead = opts.isReceiptsOn && peers.length > 0 && peers.every(p => p.readUpTo >= id)
  if (isRead) return 'read'
  const isDelivered = peers.length > 0 && peers.every(p => p.seenUpTo >= id)
  return isDelivered ? 'delivered' : 'sent'
}

export function unreadCount(opts: { entries: Entry[]; selfUid: string; readUpTo: string }): number {
  return opts.entries.filter(e => e.author !== opts.selfUid && e.message.id > opts.readUpTo).length
}
