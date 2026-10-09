import { expect, test } from 'claude-code/testing'
import { emptyHead, type Message } from '../hooks/protocol'
import { RelayError, relayOf } from '../hooks/relay'
import { callerFor, fakeDb, writesOf } from './fake-db'

const URL = 'https://claude.ai/artifact/room1'
const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const msg = (id: string, ts: number): Message => ({ v: 1, id, ts, kind: 'human', text: `m${ts}` })
const ID1 = '01K7A0000000000000000000A1'
const ID2 = '01K7A0000000000000000000A2'
const ID3 = '01K7A0000000000000000000A3'
const PEER_MSG = '01K7A0000000000000000000P1'
const storedHead = (db: ReturnType<typeof fakeDb>) => db.docs.get(`outbox/${ME}`)

test('whoami resolves the caller uid', async () => {
  const db = fakeDb(ME)
  expect(await relayOf(callerFor(db), URL).whoami()).toBe(ME)
})

test('whoami prefers the structured me_id when the tool gives one', async () => {
  const call = async () => ({ text: 'no note', result: { db_read: { me_id: ME } } })
  expect(await relayOf(call, URL).whoami()).toBe(ME)
})

test('send writes message and head together, then since reads only newer messages', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  const first = await relay.send({ uid: ME, message: msg(ID1, 10) })
  expect(first).toEqual({ head: { ...emptyHead(), head: ID1, headTs: 10 }, version: 1 })
  await relay.send({ uid: ME, message: msg(ID2, 20), known: first })
  expect((await relay.since(ME, 10)).map(m => m.id)).toEqual([ID2])
  expect((await relay.heads())[0]?.head.head).toBe(ID2)
})

test('a stale cached head is re-read and merged once, keeping the fields it did not own', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  const v1 = await relay.send({ uid: ME, message: msg(ID1, 10) })
  await relay.writeHead({ uid: ME, patch: { gh: 'partalemre' }, known: v1 })
  const out = await relay.send({ uid: ME, message: msg(ID2, 20), known: v1 })
  expect(out.version).toBe(3)
  expect(out.head).toEqual({ ...emptyHead(), head: ID2, headTs: 20, gh: 'partalemre' })
})

test('send, markRead and a gh write never drop each other\'s fields, also when two sessions race', async () => {
  const db = fakeDb(ME)
  const a = relayOf(callerFor(db), URL)
  const b = relayOf(callerFor(db), URL)
  const start = await a.send({ uid: ME, message: msg(ID1, 10) })
  const read = await b.markRead({ uid: ME, seenUpTo: PEER_MSG, readUpTo: PEER_MSG, readTs: 77, known: start })
  const gh = await b.writeHead({ uid: ME, patch: { gh: 'partalemre', label: 'Emre' }, known: read })
  // Session a still holds the version from its first send: every write below hits a stale pin.
  await a.send({ uid: ME, message: msg(ID2, 20), known: start })
  await a.markRead({ uid: ME, seenUpTo: PEER_MSG, known: start })
  await b.writeHead({ uid: ME, patch: { label: 'Emre P.' }, known: gh })
  expect(storedHead(db)?.data).toEqual({
    v: 1, head: ID2, headTs: 20, seenUpTo: PEER_MSG, readUpTo: PEER_MSG, readTs: 77, gh: 'partalemre', label: 'Emre P.',
  })
})

test('read cursors only move forward and an unchanged mark is not written', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  const marked = await relay.markRead({ uid: ME, seenUpTo: ID3, readUpTo: ID3, readTs: 5 })
  const writes = writesOf(db).length
  const again = await relay.markRead({ uid: ME, seenUpTo: ID1, readUpTo: ID1, readTs: 9, known: marked })
  expect(again).toEqual(marked)
  expect(writesOf(db).length).toBe(writes)
})

test('a send whose reply was lost is delivered on retry: the head is not written again', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  db.isReplyLost = true
  const lost = await relay.send({ uid: ME, message: msg(ID1, 10) }).catch(e => e)
  expect(lost instanceof RelayError && lost.kind === 'failed').toBe(true)
  const writes = writesOf(db).length
  const out = await relay.send({ uid: ME, message: msg(ID1, 10) })
  expect(out).toEqual({ head: { ...emptyHead(), head: ID1, headTs: 10 }, version: 1 })
  expect(writesOf(db).length).toBe(writes + 1)
})

test('a stored message whose head never moved gets its head written once', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  const v1 = await relay.send({ uid: ME, message: msg(ID1, 10) })
  db.docs.set(`outbox/${ME}/msgs/${ID2}`, { data: { ...msg(ID2, 20) }, version: 1 })
  const out = await relay.send({ uid: ME, message: msg(ID2, 20), known: v1 })
  expect(out.head.head).toBe(ID2)
  expect(storedHead(db)).toEqual({ data: { ...emptyHead(), head: ID2, headTs: 20 }, version: 2 })
})

test('a retried older message never moves the head back', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  const v1 = await relay.send({ uid: ME, message: msg(ID1, 10) })
  await relay.send({ uid: ME, message: msg(ID2, 20), known: v1 })
  const again = await relay.send({ uid: ME, message: msg(ID1, 10), known: v1 })
  expect(again.head.head).toBe(ID2)
  expect(storedHead(db)?.version).toBe(2)
})

test('a stale pin is a conflict to merge, not a delivered message', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  await relay.send({ uid: ME, message: msg(ID1, 10) })
  const out = await relay.send({ uid: ME, message: msg(ID2, 20), known: { head: emptyHead(), version: 99 } })
  expect(out.version).toBe(2)
  expect(db.docs.has(`outbox/${ME}/msgs/${ID2}`)).toBe(true)
})

test('claim is create-only: the second claim of the same query loses', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  expect(await relay.claim({ uid: ME, qid: ID1, now: 1 })).toBe(true)
  expect(await relay.claim({ uid: ME, qid: ID1, now: 2 })).toBe(false)
})

test('an offline caller surfaces as a failed RelayError with the cause kept', async () => {
  const db = fakeDb(ME)
  db.isDown = true
  const err = await relayOf(callerFor(db), URL).heads().catch(e => e)
  expect(err instanceof RelayError && err.kind === 'failed' && err.cause instanceof Error).toBe(true)
})

test('a write the session has not approved surfaces as a denied RelayError', async () => {
  const db = fakeDb(ME)
  db.isWriteDenied = true
  const known = { head: emptyHead(), version: 1 }
  const err = await relayOf(callerFor(db), URL).send({ uid: ME, message: msg(ID1, 1), known }).catch(e => e)
  expect(err instanceof RelayError && err.kind === 'denied').toBe(true)
})

test('heads ignore docs whose id is not a uid', async () => {
  const db = fakeDb(ME)
  db.docs.set('outbox/not-a-uid', { data: { ...emptyHead() }, version: 1 })
  expect((await relayOf(callerFor(db), URL).heads()).length).toBe(0)
})

test('meta is null for a room without one and round-trips once written', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  expect(await relay.meta()).toBe(null)
  const meta = { v: 1 as const, kind: 'project' as const, repo: 'partalemre/eliti', room: '01K7A0000000000000000000R1', createdAt: 1 }
  await relay.writeMeta(meta)
  expect(await relay.meta()).toEqual(meta)
})
