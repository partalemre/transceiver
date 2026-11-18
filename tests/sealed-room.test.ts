import { expect, test } from 'claude-code/testing'
import { openHead } from '../hooks/heads'
import { isUnreadable, openStored, parseMessage, type Message } from '../hooks/protocol'
import { relayOf } from '../hooks/relay'
import { audienceKeys, initialSync, tick } from '../hooks/sync'
import { audienceOf, newKeyring, ownKey, setAudience, setKeyring } from '../hooks/seal'
import { callerFor, fakeDb, type FakeDb } from './fake-db'

const URL = 'https://claude.ai/artifact/sealed1'
const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const ID1 = '01K7A0000000000000000000A1'
const QID = '01K7A0000000000000000000A2'
const AID = '01K7A0000000000000000000A3'
const SECRET = 'launch-code-4471'
const QUESTION = 'what is in the vault plan'
const ANSWER = 'the vault answer body'
const GH = 'secret-login-x'

const say: Message = { v: 1, id: ID1, ts: 10, kind: 'human', text: SECRET }
const query: Message = { v: 1, id: QID, ts: 11, kind: 'query', text: QUESTION, query: { type: 'ask', repo: 'o/r', question: QUESTION } }
const answer: Message = { v: 1, id: AID, ts: 12, kind: 'answer', text: ANSWER, replyTo: QID, answer: { qid: QID, ok: true, body: ANSWER, tokens: 3 } }

const ringWithKey = () => {
  const ring = newKeyring()
  setKeyring(ring)
  return { ring, key: ownKey() }
}

// Alice writes a line, a question, an answer, a compacted day and her head into a room whose only other member is Bob.
async function room(): Promise<{ db: FakeDb; bob: ReturnType<typeof ringWithKey>; alice: ReturnType<typeof ringWithKey> }> {
  const bob = ringWithKey()
  const alice = ringWithKey()
  const db = fakeDb(ME)
  setAudience(URL, [bob.key])
  const relay = relayOf(callerFor(db), URL)
  let known = await relay.send({ uid: ME, message: say })
  known = await relay.send({ uid: ME, message: query, known })
  known = await relay.send({ uid: ME, message: answer, known })
  await relay.writeHead({ uid: ME, patch: { gh: GH, label: 'Alice', branch: 'fix/vault' }, known })
  await relay.compactDay({ uid: ME, docId: '1970-01-01', msgs: (await relay.older(ME, 11)).items.map(i => i.doc), deletes: [] })
  return { db, bob, alice }
}

const everyByte = (db: FakeDb) => JSON.stringify([...db.docs])

test('nothing a room stores reads in clear: line, question, answer, login, name and branch', async () => {
  const { db } = await room()
  const bytes = everyByte(db)
  for (const word of [SECRET, QUESTION, ANSWER, GH, 'Alice', 'fix/vault', 'vault']) expect(bytes.includes(word)).toBe(false)
})

test('a non-member holding every stored byte opens nothing, as an old client neither', async () => {
  const { db } = await room()
  ringWithKey()
  const relay = relayOf(callerFor(db), URL)
  const got = await relay.since(ME, 0)
  expect(got.length).toBe(3)
  expect(got.every(isUnreadable)).toBe(true)
  expect(await relay.days(ME, 0)).toEqual([])
  const head = (await relay.heads())[0]?.head
  expect([head?.gh, head?.label, head?.branch]).toEqual([undefined, undefined, undefined])
  // A client from before sealing reads only the version it knows.
  for (const [, doc] of db.docs) if (doc.data.v === 2) expect(isUnreadable(parseMessage(String(doc.data.id), doc.data))).toBe(true)
})

test('the member reads every line, the question and the answer, and the head', async () => {
  const { db, bob } = await room()
  setKeyring(bob.ring)
  const relay = relayOf(callerFor(db), URL)
  expect(await relay.since(ME, 0)).toEqual([say, query, answer])
  expect((await relay.days(ME, 0)).map(m => m.id)).toEqual([ID1])
  expect((await relay.heads())[0]?.head.gh).toBe(GH)
})

test('a sealed message moved to another id or time does not open', async () => {
  const { db, bob } = await room()
  setKeyring(bob.ring)
  const stored = db.docs.get(`outbox/${ME}/msgs/${QID}`)?.data ?? {}
  expect(isUnreadable(openStored(QID, { ...stored, ts: 99 }))).toBe(true)
  expect(isUnreadable(openStored(AID, { ...stored, id: AID }))).toBe(true)
  expect(isUnreadable(openStored(QID, { ...stored, author: 'u_BBBBBBBBBBBBBBBBBBBBBB' }))).toBe(true)
  expect(openStored(QID, stored)).toEqual(query)
})

test('a head stored before sealing still reads, and a member key list is checked', () => {
  expect(openHead({ v: 1, head: '', headTs: 0, seenUpTo: '', readUpTo: '', readTs: 0, gh: 'old' })?.gh).toBe('old')
  expect(openHead({ v: 1, head: '', headTs: 0, seenUpTo: '', readUpTo: '', readTs: 0, keys: ['not a key'] })).toBe(null)
})

test('a member whose head is gone from the room (ref deleted) gets nothing written after', async () => {
  const peer = 'u_BBBBBBBBBBBBBBBBBBBBBB'
  const gone = ringWithKey()
  const me = ringWithKey()
  const db = fakeDb(ME)
  const peerDb = fakeDb(peer)
  const head = (keys: string[]) => ({ data: { v: 1, head: '', headTs: 0, seenUpTo: '', readUpTo: '', readTs: 0, keys }, version: 1 })
  db.docs.set(`outbox/${ME}`, head([me.key]))
  peerDb.docs.set(`outbox/${peer}`, head([gone.key]))
  const relay = relayOf(callerFor(db), URL)
  const boxes = [relayOf(callerFor(peerDb), 'git:o/r#u_BBBBBBBBBBBBBBBBBBBBBB')]
  const first = await tick({ relay, boxes, state: initialSync(ME), isViewing: false, isReceiptsOn: false })
  expect(audienceOf(URL).sort()).toEqual([gone.key, me.key].sort())
  // A git room reads a deleted ref as an empty mailbox.
  peerDb.docs.delete(`outbox/${peer}`)
  const second = await tick({ relay, boxes, state: first.state, isViewing: false, isReceiptsOn: false })
  // The peer is still remembered for names, but no longer sealed to.
  expect(Object.keys(second.state.peers).length).toBe(1)
  expect(audienceKeys(second.state)).toEqual([me.key])
  await relay.send({ uid: ME, message: say })
  setKeyring(gone.ring)
  expect(isUnreadable((await relay.since(ME, 0))[0] ?? say)).toBe(true)
})
