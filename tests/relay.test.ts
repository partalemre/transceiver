import { expect, test } from 'claude-code/testing'
import { emptyHead, type Message } from '../hooks/protocol'
import { RelayError, relayOf } from '../hooks/relay'
import { callerFor, fakeDb } from './fake-db'

const URL = 'https://claude.ai/artifact/room1'
const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const msg = (id: string, ts: number): Message => ({ v: 1, id, ts, kind: 'human', text: `m${ts}` })
const ID1 = '01K7A0000000000000000000A1'
const ID2 = '01K7A0000000000000000000A2'

test('whoami resolves the caller uid', async () => {
  const db = fakeDb(ME)
  expect(await relayOf(callerFor(db), URL).whoami()).toBe(ME)
})

test('send writes message and head together, then since reads only newer messages', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  const v1 = await relay.send({ uid: ME, message: msg(ID1, 10), nextHead: h => ({ ...h, head: ID1, headTs: 10 }) })
  await relay.send({ uid: ME, message: msg(ID2, 20), version: v1, nextHead: h => ({ ...h, head: ID2, headTs: 20 }) })
  const after = await relay.since(ME, 10)
  expect(after.map(m => m.id)).toEqual([ID2])
  const heads = await relay.heads()
  expect(heads[0].head.head).toBe(ID2)
})

test('a stale head version is re-read and retried once, merging through nextHead', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  await relay.send({ uid: ME, message: msg(ID1, 10), nextHead: h => ({ ...h, head: ID1, headTs: 10 }) })
  const v = await relay.send({ uid: ME, message: msg(ID2, 20), version: 99, nextHead: h => ({ ...h, head: ID2, headTs: 20 }) })
  expect(v).toBe(2)
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
  expect(err instanceof RelayError && err.kind === 'failed').toBe(true)
})

test('a write the session has not approved surfaces as a denied RelayError', async () => {
  const db = fakeDb(ME)
  db.isWriteDenied = true
  const err = await relayOf(callerFor(db), URL).send({ uid: ME, message: msg(ID1, 1), version: 1, nextHead: h => h }).catch(e => e)
  expect(err instanceof RelayError && err.kind === 'denied').toBe(true)
})

test('heads ignore docs whose id is not a uid', async () => {
  const db = fakeDb(ME)
  db.docs.set('outbox/not-a-uid', { data: { ...emptyHead() }, version: 1 })
  expect((await relayOf(callerFor(db), URL).heads()).length).toBe(0)
})
