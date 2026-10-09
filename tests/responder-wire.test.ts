import { expect, test } from 'claude-code/testing'
import { forgetRepo } from '../hooks/here'
import { localDay } from '../hooks/budget'
import { loadDrafts } from '../hooks/drafts'
import { ASK_DAILY_LIMIT, MAX_DRAFTS_PER_ROOM } from '../hooks/limits'
import { DENIED } from '../hooks/protocol'
import { wireResponder } from '../hooks/responder-wire'
import { startLoop, stopRoom } from '../hooks/room-loop'
import { saveRooms, type RoomRecord } from '../hooks/rooms'
import type { Run } from '../hooks/run'
import { newId } from '../hooks/ulid'
import { fakeAgent, gitIn, type FakeAgent } from './fake-agent'
import { callerFor, fakeDb, type FakeDb } from './fake-db'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const SECOND_MS = 1_000

// git answers status; gh says alperenx is a collaborator of partalemre/eliti and nobody else is.
const run: Run = gitIn('partalemre/eliti', async argv => {
  if (argv.includes('status')) return { exitCode: 0, stdout: '## main\n M lib/a.dart\n', stderr: '' }
  const isYes = argv[0] === 'gh' && argv[2]?.toLowerCase() === 'repos/partalemre/eliti/collaborators/alperenx'
  return { exitCode: argv[0] === 'gh' && !isYes ? 1 : 0, stdout: '', stderr: '' }
})

type World = { db: FakeDb; host: FakeAgent; qid: string; stop: () => void }

async function world(opts: { id: string; headGh?: string; isOn?: boolean; preClaimed?: boolean }): Promise<World> {
  forgetRepo()
  const db = fakeDb(ME)
  const host = fakeAgent(callerFor(db), run)
  host.isOn = opts.isOn ?? true
  const ts = host.clock.now - 1_000
  const qid = newId(ts)
  const query = { v: 1, id: qid, ts, kind: 'query', text: 'status', query: { type: 'status', repo: 'PartalEmre/eliti' } }
  db.docs.set(`outbox/${PEER}/msgs/${qid}`, { data: query, version: 1 })
  const head = { v: 1, head: qid, headTs: ts, seenUpTo: '', readUpTo: '', readTs: 0, gh: opts.headGh ?? 'AlperenX' }
  db.docs.set(`outbox/${PEER}`, { data: head, version: 1 })
  if (opts.preClaimed === true) db.docs.set(`outbox/${ME}/claims/${qid}`, { data: { v: 1, at: 1 }, version: 1 })
  const room: RoomRecord = {
    id: opts.id, url: `https://claude.ai/artifact/${opts.id}`, kind: 'project', repo: 'partalemre/eliti', title: 't',
    status: 'active', isLive: false, isOwner: true, peers: [{ uid: PEER, gh: 'alperenx', isGhConfirmed: true }], joinedAt: 0,
  }
  await saveRooms(host, [room])
  const stop = wireResponder(host)
  await startLoop(host)
  await host.advance(0)
  return { db, host, qid, stop: () => { stop(); stopRoom(opts.id) } }
}

const answersIn = (db: FakeDb) =>
  [...db.docs].filter(([k, d]) => k.startsWith(`outbox/${ME}/msgs/`) && d.data.kind === 'answer').map(([, d]) => d.data.answer as { ok: boolean })

test('a peer query is claimed in my outbox, gated and answered once, with no model', async () => {
  const w = await world({ id: 'RW1' })
  await w.host.advance(0)
  expect(w.db.docs.has(`outbox/${ME}/claims/${w.qid}`)).toBe(true)
  expect(answersIn(w.db)).toEqual([{ qid: w.qid, ok: true, body: 'main · 1 değişen dosya', tokens: 0 }])
  await w.host.advance(30_000)
  expect(answersIn(w.db).length).toBe(1)
  expect(w.host.asked.length).toBe(0)
  w.stop()
})

test('a query another session already claimed is left alone', async () => {
  const w = await world({ id: 'RW2', preClaimed: true })
  await w.host.advance(10_000)
  expect(answersIn(w.db)).toEqual([])
  w.stop()
})

test('a peer head announcing a login other than the confirmed one gets exactly the denial', async () => {
  const w = await world({ id: 'RW3', headGh: 'torvalds' })
  await w.host.advance(0)
  expect(answersIn(w.db)).toEqual([{ qid: w.qid, ok: false, body: DENIED, tokens: 0 }])
  w.stop()
})

test('before connecting nothing is written; once connected the waiting query is answered', async () => {
  const w = await world({ id: 'RW4', isOn: false })
  w.db.isWriteDenied = true
  await w.host.advance(10_000)
  expect(w.db.calls.some(c => String(c.collection).includes('/claims'))).toBe(false)
  w.host.isOn = true
  w.db.isWriteDenied = false
  await w.host.advance(10_000)
  expect(answersIn(w.db).map(a => a?.ok)).toEqual([true])
  w.stop()
})

// Second by second: one long jump would pass the toast's quiet before a tick's claims have settled.
async function tick(w: World, ms: number): Promise<void> {
  for (let at = 0; at < ms; at += SECOND_MS) await w.host.advance(SECOND_MS)
}

// Spends the room's day, then puts `n` asks in the peer's outbox, newest last, and names the newest the head.
async function asksPastLimit(w: World, opts: { roomId: string; n: number }): Promise<void> {
  await w.host.storeSet('tx.budget', { day: localDay(w.host.clock.now), byRoom: { [opts.roomId]: ASK_DAILY_LIMIT } })
  let head = ''
  for (let i = 0; i < opts.n; i++) {
    const ts = w.host.clock.now + i
    head = newId(ts)
    const ask = { v: 1, id: head, ts, kind: 'query', text: `soru ${i}?`, query: { type: 'ask', repo: 'partalemre/eliti', question: `soru ${i}?` } }
    w.db.docs.set(`outbox/${PEER}/msgs/${head}`, { data: ask, version: 1 })
  }
  const headTs = w.host.clock.now + opts.n - 1
  w.db.docs.set(`outbox/${PEER}`, { data: { v: 1, head, headTs, seenUpTo: '', readUpTo: '', readTs: 0, gh: 'AlperenX' }, version: 2 })
}

test('a burst of asks past the day limit is told in one toast that says how many wait', async () => {
  const w = await world({ id: 'RW5' })
  await asksPastLimit(w, { roomId: 'RW5', n: 3 })
  await tick(w, 30_000)
  expect((await loadDrafts(w.host)).length).toBe(3)
  expect(w.host.toasts.filter(t => t.includes('sınırı doldu'))).toEqual(['Transceiver: günlük soru sınırı doldu, 3 soru onayını bekliyor'])
  w.stop()
})

test('asks the drafts cannot hold are not told again', async () => {
  const w = await world({ id: 'RW6' })
  await asksPastLimit(w, { roomId: 'RW6', n: MAX_DRAFTS_PER_ROOM + 4 })
  await tick(w, 60_000)
  const toasts = w.host.toasts.filter(t => t.includes('sınırı doldu'))
  expect((await loadDrafts(w.host)).length).toBe(MAX_DRAFTS_PER_ROOM)
  expect(toasts).toEqual([`Transceiver: günlük soru sınırı doldu, ${MAX_DRAFTS_PER_ROOM} soru onayını bekliyor`])
  await tick(w, 60_000)
  expect(w.host.toasts.filter(t => t.includes('sınırı doldu')).length).toBe(1)
  w.stop()
})
