import { expect, test } from 'claude-code/testing'
import { authorKey } from '../hooks/authors'
import { relayOf } from '../hooks/relay'
import { enqueue, initialSync, nextDelay, tick } from '../hooks/sync'
import { callerAs, callerFor, fakeDb, type FakeDb } from './fake-db'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const URL = 'https://claude.ai/artifact/room1'
const PEER_URL = 'https://claude.ai/artifact/room2'
const PEER_KEY = authorKey({ uid: PEER, url: PEER_URL, isOwn: false })
const A = '01K7A0000000000000000000A1'
const B = '01K7A0000000000000000000A2'
const C = '01K7A0000000000000000000A3'
const human = (id: string, ts: number, text = 'x') => ({ v: 1 as const, id, ts, kind: 'human' as const, text })
// The peer polls their own mailbox and reads mine.
const asPeer = (opts: { mine: FakeDb; theirs: FakeDb }) =>
  ({ relay: relayOf(callerFor(opts.theirs), PEER_URL), boxes: [relayOf(callerAs(opts.mine, PEER), URL)] })

test('a queued message is sent, then appears as stored for both sides', async () => {
  const db = fakeDb(ME)
  const mine = relayOf(callerFor(db), URL)
  let state = enqueue(initialSync(ME), human(A, 10, 'selam'))
  expect(state.entries[0]?.isPending).toBe(true)
  state = (await tick({ relay: mine, state, isViewing: true, isReceiptsOn: true })).state
  expect(state.pending.length).toBe(0)
  expect(state.entries[0]?.isPending).toBe(undefined)

  const seen = await tick({ ...asPeer({ mine: db, theirs: fakeDb(PEER) }), state: initialSync(PEER), isViewing: true, isReceiptsOn: true, now: 99 })
  expect(seen.fresh.map(e => e.message.id)).toEqual([A])
  expect(seen.state.ownHead.seenUpTo).toBe(A)
  expect(seen.state.ownHead.readUpTo).toBe(A)
  expect(seen.state.ownHead.readTs).toBe(99)
})

test('a failed send stays queued and counts a failure', async () => {
  const db = fakeDb(ME)
  db.isDown = true
  const state = enqueue(initialSync(ME), human(B, 20))
  const out = await tick({ relay: relayOf(callerFor(db), URL), state, isViewing: false, isReceiptsOn: true })
  expect(out.state.pending.length).toBe(1)
  expect(out.state.failures).toBe(1)
})

test('a send whose reply was lost is not sent twice: the next tick settles it as delivered', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  db.isReplyLost = true
  const first = await tick({ relay, state: enqueue(initialSync(ME), human(A, 10)), isViewing: false, isReceiptsOn: true })
  expect(first.state.pending.map(m => m.id)).toEqual([A])
  const second = await tick({ relay, state: first.state, isViewing: false, isReceiptsOn: true })
  expect(second.state.pending.length).toBe(0)
  expect(second.state.failures).toBe(0)
  expect(second.state.ownHead.head).toBe(A)
})

test('queued messages go out in order and stop at the first failure', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  const state = enqueue(enqueue(initialSync(ME), human(A, 1)), human(B, 2))
  db.isReplyLost = true
  const out = await tick({ relay, state, isViewing: false, isReceiptsOn: true })
  expect(out.state.pending.map(m => m.id)).toEqual([A, B])
  expect(db.docs.has(`outbox/${ME}/msgs/${B}`)).toBe(false)
})

test('unapproved writes keep messages queued but still pull what peers sent', async () => {
  const peer = fakeDb(PEER)
  await tick({ relay: relayOf(callerFor(peer), PEER_URL), state: enqueue(initialSync(PEER), human(A, 1)), isViewing: false, isReceiptsOn: true })
  const db = fakeDb(ME)
  db.isWriteDenied = true
  const boxes = [relayOf(callerAs(peer, ME), PEER_URL)]
  const out = await tick({ relay: relayOf(callerFor(db), URL), boxes, state: enqueue(initialSync(ME), human(B, 2)), isViewing: true, isReceiptsOn: true })
  expect(out.isDenied).toBe(true)
  expect(out.state.pending.map(m => m.id)).toEqual([B])
  expect(out.fresh.map(e => e.message.id)).toEqual([A])
  expect(out.state.failures).toBe(0)
})

test('read receipts off: readUpTo is never written', async () => {
  const db = fakeDb(ME)
  await tick({ relay: relayOf(callerFor(db), URL), state: enqueue(initialSync(ME), human(A, 1)), isViewing: false, isReceiptsOn: true })
  const out = await tick({ ...asPeer({ mine: db, theirs: fakeDb(PEER) }), state: initialSync(PEER), isViewing: true, isReceiptsOn: false })
  expect(out.state.ownHead.readUpTo).toBe('')
  expect(out.state.ownHead.seenUpTo).toBe(A)
})

test('opening the room later marks what was only seen as read', async () => {
  const db = fakeDb(ME)
  await tick({ relay: relayOf(callerFor(db), URL), state: enqueue(initialSync(ME), human(A, 1)), isViewing: false, isReceiptsOn: true })
  const peer = asPeer({ mine: db, theirs: fakeDb(PEER) })
  const closed = await tick({ ...peer, state: initialSync(PEER), isViewing: false, isReceiptsOn: true })
  expect(closed.state.ownHead.readUpTo).toBe('')
  const opened = await tick({ ...peer, state: closed.state, isViewing: true, isReceiptsOn: true })
  expect(opened.fresh.length).toBe(0)
  expect(opened.state.ownHead.readUpTo).toBe(A)
})

test('acks and sends keep a gh name another session wrote to the same head', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  const sent = await tick({ relay, state: enqueue(initialSync(ME), human(A, 1)), isViewing: false, isReceiptsOn: true })
  await relayOf(callerFor(db), URL).writeHead({ uid: ME, patch: { gh: 'partalemre' } })
  const out = await tick({ relay, state: enqueue(sent.state, human(C, 3)), isViewing: true, isReceiptsOn: true })
  expect(out.state.ownHead.gh).toBe('partalemre')
  expect(db.docs.get(`outbox/${ME}`)?.data.gh).toBe('partalemre')
})

test('a peer message that does not parse still moves the cursor, so it is not fetched forever', async () => {
  const peer = fakeDb(PEER)
  peer.docs.set(`outbox/${PEER}/msgs/${A}`, { data: { v: 9, id: A, ts: 5 }, version: 1 })
  peer.docs.set(`outbox/${PEER}`, { data: { v: 1, head: A, headTs: 5, seenUpTo: '', readUpTo: '', readTs: 0 }, version: 1 })
  const relay = relayOf(callerFor(fakeDb(ME)), URL)
  const boxes = [relayOf(callerAs(peer, ME), PEER_URL)]
  const first = await tick({ relay, boxes, state: initialSync(ME), isViewing: false, isReceiptsOn: true })
  expect(first.fresh.length).toBe(1)
  expect(first.state.cursors[PEER_KEY]).toBe(5)
  const queries = peer.calls.filter(c => c.action === 'query').length
  await tick({ relay, boxes, state: first.state, isViewing: false, isReceiptsOn: true })
  expect(peer.calls.filter(c => c.action === 'query').length).toBe(queries)
})

test('delay: 1s open, 5s closed, doubling on failure up to 30s', () => {
  expect(nextDelay({ isPaneOpen: true, failures: 0 })).toBe(1_000)
  expect(nextDelay({ isPaneOpen: false, failures: 0 })).toBe(5_000)
  expect(nextDelay({ isPaneOpen: true, failures: 2 })).toBe(4_000)
  expect(nextDelay({ isPaneOpen: false, failures: 9 })).toBe(30_000)
})
