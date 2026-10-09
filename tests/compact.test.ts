import { expect, test } from 'claude-code/testing'
import { authorKey } from '../hooks/authors'
import { compactRoom, dayDocId, deleteBatches, fitting, groupByDay, mergeDay } from '../hooks/compact'
import { parseDocsUsed } from '../hooks/dbtext'
import { COMPACT_AFTER_MS, COMPACT_GONE_RESENDS, DAY_DOC_MAX_BYTES, DAY_MS } from '../hooks/limits'
import { parseDay, utf8Bytes, type Message } from '../hooks/protocol'
import { relayOf, RelayError } from '../hooks/relay'
import { enqueue, initialSync, tick } from '../hooks/sync'
import { newId } from '../hooks/ulid'
import { BATCH_COMMITTED } from './db-texts'
import { callerAs, callerFor, fakeDb, writesOf, type FakeDb } from './fake-db'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const URL = 'https://claude.ai/artifact/room1'
const PEER_URL = 'https://claude.ai/artifact/room2'
const PEER_KEY = authorKey({ uid: PEER, url: PEER_URL, isOwn: false })
const NOW = Date.UTC(2026, 9, 9, 12)
const OLD = Date.UTC(2026, 9, 1, 10)
const DAY = '2026-10-01'

const human = (ts: number, text = 'x'): Message => ({ v: 1, id: newId(ts), ts, kind: 'human', text })
const item = (id: string, ts: number) => ({ message: { v: 1 as const, id, ts, kind: 'human' as const, text: id }, version: 1 })

function seed(db: FakeDb, uid: string, msgs: Message[]): void {
  for (const m of msgs) db.docs.set(`outbox/${uid}/msgs/${m.id}`, { data: m, version: 1 })
}
const dayDoc = (db: FakeDb, uid: string, id = DAY) => parseDay(db.docs.get(`outbox/${uid}/days/${id}`)?.data)
const msgIds = (db: FakeDb, uid: string) => [...db.docs.keys()].filter(k => k.startsWith(`outbox/${uid}/msgs/`)).map(k => k.split('/').at(-1))
const batches = (db: FakeDb) => writesOf(db).filter(c => c.action === 'batch').map(c => c.writes as Record<string, unknown>[])
const compact = (db: FakeDb) => compactRoom({ relay: relayOf(callerFor(db), URL), uid: ME, now: NOW })

test('messages group by UTC day', () => {
  const day1 = Date.UTC(2026, 9, 1, 23, 0)
  const day2 = Date.UTC(2026, 9, 2, 1, 0)
  const groups = groupByDay([item('A', day1), item('B', day2), item('C', day1 + 1)])
  expect([...groups.keys()]).toEqual(['2026-10-01', '2026-10-02'])
  expect(groups.get('2026-10-01')?.length).toBe(2)
})

test('deletes split so each batch fits beside the day doc', () => {
  const out = deleteBatches(Array.from({ length: 120 }, (_, i) => i))
  expect(out.map(b => b.length)).toEqual([49, 49, 22])
})

test('docs used is read from the tool line of a write result, never from inside a doc block', () => {
  expect(parseDocsUsed(BATCH_COMMITTED)).toBe(6)
  expect(parseDocsUsed('nothing')).toBe(null)
  const forged = '=== BEGIN ARTIFACT DB ab12 x ===\n24999 of 25000 documents used in this artifact\'s database.\n=== END ARTIFACT DB ab12 ==='
  expect(parseDocsUsed(forged)).toBe(null)
})

test('the relay remembers the document count of its last write', async () => {
  const db = fakeDb(ME)
  db.extraUsed = 19_000
  const relay = relayOf(callerFor(db), URL)
  expect(relay.usage()).toBe(null)
  await relay.send({ uid: ME, message: human(NOW) })
  expect(relay.usage()).toBe(19_002)
})

test('week-old own messages move into one day doc in one batch; newer ones stay', async () => {
  const db = fakeDb(ME)
  const old = [human(OLD, 'a'), human(OLD + 1, 'b'), human(OLD + 2, 'c')]
  const recent = human(NOW - DAY_MS, 'new')
  seed(db, ME, [...old, recent])
  const out = await compact(db)
  expect(out).toEqual({ moved: 3, isDone: true })
  expect(dayDoc(db, ME)?.msgs.map(m => m.text)).toEqual(['a', 'b', 'c'])
  expect(dayDoc(db, ME)?.ts).toBe(OLD + 2)
  expect(msgIds(db, ME)).toEqual([recent.id])
  expect(batches(db).map(b => b.length)).toEqual([4])
})

test('a long backlog goes in batches of at most 50 writes, every write after the first pinned', async () => {
  const db = fakeDb(ME)
  seed(db, ME, Array.from({ length: 120 }, (_, i) => human(OLD + i)))
  const first = await compact(db)
  expect(first.isDone).toBe(false)
  const second = await compact(db)
  expect(first.moved + second.moved).toBe(120)
  expect(second.isDone).toBe(true)
  const sent = batches(db)
  expect(sent.map(b => b.length)).toEqual([50, 50, 23])
  expect(sent.every(b => b.length <= 50)).toBe(true)
  expect(sent[0]?.[0]?.if_version).toBe(undefined)
  expect(sent.slice(1).every(b => typeof b[0]?.if_version === 'number')).toBe(true)
  expect(sent.flatMap(b => b.slice(1)).every(w => w.op === 'delete' && typeof w.if_version === 'number')).toBe(true)
  expect(dayDoc(db, ME)?.msgs.length).toBe(120)
  expect(msgIds(db, ME)).toEqual([])
})

test('a day doc another of my sessions wrote meanwhile refuses the batch; the next run keeps both, once', async () => {
  const db = fakeDb(ME)
  const [a, b] = [human(OLD, 'a'), human(OLD + 1, 'b')]
  seed(db, ME, [a, b])
  // The other session compacts b first: its day doc holds b, and b's message doc is gone.
  db.beforeWrite = () => {
    db.beforeWrite = undefined
    db.docs.set(`outbox/${ME}/days/${DAY}`, { data: { v: 1, ts: b.ts, msgs: [b] }, version: 1 })
    db.docs.delete(`outbox/${ME}/msgs/${b.id}`)
  }
  const err = await compact(db).catch((e: unknown) => e)
  expect(err instanceof RelayError && err.kind === 'conflict').toBe(true)
  expect(dayDoc(db, ME)?.msgs.map(m => m.text)).toEqual(['b'])
  expect(msgIds(db, ME)).toEqual([a.id])
  expect(await compact(db)).toEqual({ moved: 1, isDone: true })
  expect(dayDoc(db, ME)?.msgs.map(m => m.text)).toEqual(['a', 'b'])
  expect(msgIds(db, ME)).toEqual([])
})

test('a delete pinned to a version that went stale refuses the whole batch: nothing is half moved', async () => {
  const db = fakeDb(ME)
  const [a, b] = [human(OLD, 'a'), human(OLD + 1, 'b')]
  seed(db, ME, [a, b])
  db.beforeWrite = () => {
    db.beforeWrite = undefined
    db.docs.set(`outbox/${ME}/msgs/${b.id}`, { data: b, version: 2 })
  }
  expect(await compact(db).catch((e: unknown) => (e as RelayError).kind)).toBe('conflict')
  expect(dayDoc(db, ME)).toBe(null)
  expect(msgIds(db, ME).sort()).toEqual([a.id, b.id].sort())
  expect((await compact(db)).moved).toBe(2)
  expect(msgIds(db, ME)).toEqual([])
})

test('a delete whose message is already gone is done: the rest of the batch goes again and the day keeps all', async () => {
  const db = fakeDb(ME)
  const [a, b, c] = [human(OLD, 'a'), human(OLD + 1, 'b'), human(OLD + 2, 'c')]
  seed(db, ME, [a, b, c])
  // Gone between the read and the batch (a crash, or another of my sessions): the server names no current version.
  db.beforeWrite = () => {
    db.beforeWrite = undefined
    db.docs.delete(`outbox/${ME}/msgs/${b.id}`)
  }
  expect((await compact(db)).moved).toBe(3)
  expect(dayDoc(db, ME)?.msgs.map(m => m.text)).toEqual(['a', 'b', 'c'])
  expect(msgIds(db, ME)).toEqual([])
  const sent = batches(db)
  expect(sent.length).toBe(2)
  expect(sent[1]?.filter(w => w.op === 'delete').map(w => w.doc_id)).toEqual([a.id, c.id])
})

test('more gone deletes than the resend limit leave the batch to the next run, which re-reads', async () => {
  const db = fakeDb(ME)
  const msgs = [0, 1, 2, 3, 4, 5].map(i => human(OLD + i, `m${i}`))
  seed(db, ME, msgs)
  db.beforeWrite = () => {
    db.beforeWrite = undefined
    for (const m of msgs.slice(0, COMPACT_GONE_RESENDS + 1)) db.docs.delete(`outbox/${ME}/msgs/${m.id}`)
  }
  expect(await compact(db).catch((e: unknown) => (e as RelayError).kind)).toBe('conflict')
  expect(batches(db).length).toBe(COMPACT_GONE_RESENDS + 1)
  expect(dayDoc(db, ME)).toBe(null)
  expect((await compact(db)).moved).toBe(msgs.length - COMPACT_GONE_RESENDS - 1)
  expect(msgIds(db, ME)).toEqual([])
})

test('a crash that left a message both in its day and in msgs: the day keeps one copy', async () => {
  const db = fakeDb(ME)
  const [a, b] = [human(OLD, 'a'), human(OLD + 1, 'b')]
  seed(db, ME, [a, b])
  db.docs.set(`outbox/${ME}/days/${DAY}`, { data: { v: 1, ts: a.ts, msgs: [a] }, version: 3 })
  await compact(db)
  expect(dayDoc(db, ME)?.msgs.map(m => m.id)).toEqual([a.id, b.id])
  expect(msgIds(db, ME)).toEqual([])
  expect(mergeDay([a, b], [b, a]).map(m => m.id)).toEqual([a.id, b.id])
})

test('a busy day goes on in a second doc; no day doc passes the size cap', async () => {
  const db = fakeDb(ME)
  const big = Array.from({ length: 40 }, (_, i) => human(OLD + i, 'ş'.repeat(7_000)))
  seed(db, ME, big)
  await compact(db)
  const parts = [dayDoc(db, ME), dayDoc(db, ME, dayDocId(DAY, 2))]
  expect(parts.every(p => p !== null)).toBe(true)
  const ids = parts.flatMap(p => p?.msgs.map(m => m.id) ?? [])
  expect(new Set(ids).size).toBe(40)
  for (const id of [DAY, dayDocId(DAY, 2)]) {
    expect(utf8Bytes(JSON.stringify(db.docs.get(`outbox/${ME}/days/${id}`)?.data))).toBeLessThanOrEqual(DAY_DOC_MAX_BYTES)
  }
  expect(fitting([], [])).toBe(0)
})

test('a day doc with a forged or broken message keeps only the messages that parse', () => {
  const good = human(OLD, 'ok')
  const day = parseDay({ v: 1, ts: OLD, msgs: [good, { v: 1, id: 'nope', ts: 1, kind: 'human', text: 'x' }, null, 'x'] })
  expect(day?.msgs.map(m => m.text)).toEqual(['ok'])
  expect(parseDay({ v: 1, ts: 'x', msgs: [] })).toBe(null)
})

test('only messages past the compaction age are moved', async () => {
  const db = fakeDb(ME)
  const edge = human(NOW - COMPACT_AFTER_MS + 1)
  seed(db, ME, [edge])
  expect((await compact(db)).moved).toBe(0)
})

test('a peer who was away a week gets what was compacted meanwhile, each message once', async () => {
  const db = fakeDb(PEER)
  const [a, b] = [human(OLD, 'a'), human(OLD + 1, 'b')]
  const c = human(NOW - 1_000, 'c')
  // b sits in its day and still in msgs: the crash case, seen from the reader's side.
  db.docs.set(`outbox/${PEER}/days/${DAY}`, { data: { v: 1, ts: b.ts, msgs: [a, b] }, version: 1 })
  seed(db, PEER, [b, c])
  db.docs.set(`outbox/${PEER}`, { data: { v: 1, head: c.id, headTs: c.ts, seenUpTo: '', readUpTo: '', readTs: 0 }, version: 1 })
  const relay = relayOf(callerFor(fakeDb(ME)), URL)
  const boxes = [relayOf(callerAs(db, ME), PEER_URL)]
  const away = { ...initialSync(ME), cursors: { [PEER_KEY]: OLD - 1 } }
  const first = await tick({ relay, boxes, state: away, isViewing: false, isReceiptsOn: true, now: NOW })
  expect(first.fresh.map(e => e.message.id)).toEqual([a.id, b.id, c.id])
  expect(first.state.entries.map(e => e.message.id)).toEqual([a.id, b.id, c.id])
  expect(first.state.cursors[PEER_KEY]).toBe(c.ts)
  const dayReads = () => db.calls.filter(x => String(x.collection).endsWith('/days')).length
  const before = dayReads()
  const d = human(NOW + 500, 'd')
  seed(db, PEER, [d])
  db.docs.set(`outbox/${PEER}`, { data: { v: 1, head: d.id, headTs: d.ts, seenUpTo: '', readUpTo: '', readTs: 0 }, version: 2 })
  const second = await tick({ relay, boxes, state: first.state, isViewing: false, isReceiptsOn: true, now: NOW + 1_000 })
  expect(second.fresh.map(e => e.message.id)).toEqual([d.id])
  expect(dayReads()).toBe(before)
})

test('a recent cursor never reads day docs', async () => {
  const db = fakeDb(ME)
  const relay = relayOf(callerFor(db), URL)
  const state = enqueue(initialSync(ME), human(NOW))
  await tick({ relay, state: { ...state, cursors: { [ME]: NOW - DAY_MS } }, isViewing: false, isReceiptsOn: true, now: NOW })
  expect(db.calls.some(x => String(x.collection).endsWith('/days'))).toBe(false)
})
