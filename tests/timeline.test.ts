import { expect, test } from 'claude-code/testing'
import { emptyHead, type Message } from '../hooks/protocol'
import { mergeEntries, receiptOf, unreadCount, type Entry } from '../hooks/timeline'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const m = (id: string, ts: number): Message => ({ v: 1, id, ts, kind: 'human', text: id })
const A = '01K7A0000000000000000000A1'
const B = '01K7A0000000000000000000A2'
const C = '01K7A0000000000000000000A3'

test('merge dedupes by id, prefers the stored copy over the pending one, and orders by ts then id', () => {
  const pending: Entry = { author: ME, message: m(B, 20), isPending: true }
  const stored: Entry = { author: ME, message: m(B, 20) }
  const out = mergeEntries([pending, { author: PEER, message: m(C, 30) }], [stored, { author: PEER, message: m(A, 10) }])
  expect(out.map(e => e.message.id)).toEqual([A, B, C])
  expect(out[1]?.isPending).toBe(undefined)
})

test('a pending copy never replaces a stored one', () => {
  const stored: Entry = { author: ME, message: m(B, 20) }
  const out = mergeEntries([stored], [{ ...stored, isPending: true }])
  expect(out[0]?.isPending).toBe(undefined)
})

test('merge keeps only the newest entries when asked', () => {
  const many = [A, B, C].map((id, i) => ({ author: PEER, message: m(id, i) }))
  expect(mergeEntries([], many, 2).map(e => e.message.id)).toEqual([B, C])
})

test('receipts: pending, sent, delivered, read; read hidden when receipts are off', () => {
  const mine: Entry = { author: ME, message: m(B, 20) }
  const peerSaw = { ...emptyHead(), seenUpTo: B }
  const peerRead = { ...peerSaw, readUpTo: B }
  expect(receiptOf({ entry: { ...mine, isPending: true }, selfUid: ME, peers: [], isReceiptsOn: true })).toBe('pending')
  expect(receiptOf({ entry: mine, selfUid: ME, peers: [emptyHead()], isReceiptsOn: true })).toBe('sent')
  expect(receiptOf({ entry: mine, selfUid: ME, peers: [peerSaw], isReceiptsOn: true })).toBe('delivered')
  expect(receiptOf({ entry: mine, selfUid: ME, peers: [peerRead], isReceiptsOn: true })).toBe('read')
  expect(receiptOf({ entry: mine, selfUid: ME, peers: [peerRead], isReceiptsOn: false })).toBe('delivered')
})

test('a room with no peer yet shows sent, never delivered', () => {
  expect(receiptOf({ entry: { author: ME, message: m(B, 20) }, selfUid: ME, peers: [], isReceiptsOn: true })).toBe('sent')
})

test('unread counts only other authors after my read cursor', () => {
  const entries = [{ author: PEER, message: m(A, 1) }, { author: ME, message: m(B, 2) }, { author: PEER, message: m(C, 3) }]
  expect(unreadCount({ entries, selfUid: ME, readUpTo: A })).toBe(1)
})
