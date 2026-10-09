import { expect, test } from 'claude-code/testing'
import { dayOf } from '../hooks/compact'
import type { CallResult } from '../hooks/host'
import { COMPACT_AFTER_MS, RETENTION_RETRY_MS, ROLLOVER_DOCS } from '../hooks/limits'
import type { Message } from '../hooks/protocol'
import { wireRetention } from '../hooks/retention'
import { enqueueMessage, startLoop, stopRoom } from '../hooks/room-loop'
import { loadRooms, saveRooms, type RoomRecord } from '../hooks/rooms'
import { newId } from '../hooks/ulid'
import { fakeAgent, type FakeAgent } from './fake-agent'
import { callerFor, fakeDb, type FakeDb } from './fake-db'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const SECRET_TEXT = 'gizli-metin'

type World = { host: FakeAgent; db: FakeDb; dbs: Map<string, FakeDb>; room: RoomRecord; stop: () => Promise<void> }

function router(w: { dbs: Map<string, FakeDb>; publishes: number; isPublishDenied?: boolean }) {
  return async (input: Record<string, unknown>): Promise<CallResult> => {
    if (input.tool === 'Artifact' && input.action === 'publish') {
      if (w.isPublishDenied === true) return { deny: 'Claude wants to publish an artifact' }
      w.publishes += 1
      const url = `https://claude.ai/artifact/NEXT${w.publishes}`
      w.dbs.set(url, fakeDb(ME))
      return { result: { url }, text: `Published at ${url}` }
    }
    if (input.tool === 'Artifact') return { result: { artifacts: [] }, text: '' }
    const db = w.dbs.get(String(input.url)) ?? fakeDb(ME)
    return callerFor(db)(input)
  }
}

async function world(opts: { id: string; isOwner?: boolean; old?: number; isPublishDenied?: boolean }): Promise<World & { net: { publishes: number; isPublishDenied?: boolean } }> {
  const url = `https://claude.ai/artifact/${opts.id}`
  const db = fakeDb(ME)
  const net = { dbs: new Map([[url, db]]), publishes: 0, isPublishDenied: opts.isPublishDenied }
  const host = fakeAgent(router(net))
  const old = host.clock.now - COMPACT_AFTER_MS - 60_000
  for (let i = 0; i < (opts.old ?? 0); i++) {
    const id = newId(old + i)
    db.docs.set(`outbox/${ME}/msgs/${id}`, { data: { v: 1, id, ts: old + i, kind: 'human', text: SECRET_TEXT }, version: 1 })
  }
  const room: RoomRecord = {
    id: opts.id, url, kind: 'project', repo: 'partalemre/eliti', title: 'Transceiver · partalemre/eliti', status: 'active',
    isLive: true, isOwner: opts.isOwner ?? true, peers: [{ uid: PEER, gh: 'alperenx', isGhConfirmed: true }], joinedAt: 0,
  }
  await saveRooms(host, [room])
  const off = wireRetention(host)
  await startLoop(host)
  const stop = async () => { off(); for (const r of await loadRooms(host)) stopRoom(r.id) }
  return { host, db, dbs: net.dbs, room, stop, net }
}

const olderQueries = (db: FakeDb) => db.calls.filter(c => c.action === 'query' && JSON.stringify(c.query).includes('"<"')).length
const dayDocs = (db: FakeDb) => [...db.docs.keys()].filter(k => k.startsWith(`outbox/${ME}/days/`))
const say = (host: FakeAgent, text: string): Message => {
  const now = host.clock.now
  return { v: 1, id: newId(now), ts: now, kind: 'human', text }
}

test('compaction waits for the connection, then runs once a day', async () => {
  const w = await world({ id: 'RET1', old: 3 })
  w.host.isOn = false
  await w.host.advance(10_000)
  expect(dayDocs(w.db)).toEqual([])
  w.host.isOn = true
  await w.host.advance(5_000)
  expect(dayDocs(w.db).length).toBe(1)
  expect(await w.host.storeGet('tx.compacted.RET1')).toBe(dayOf(w.host.clock.now))
  const runs = olderQueries(w.db)
  await w.host.advance(60_000)
  expect(olderQueries(w.db)).toBe(runs)
  await w.host.advance(24 * 60 * 60_000)
  expect(olderQueries(w.db)).toBe(runs + 1)
  await w.stop()
})

test('a failing compaction logs the room title and error name only, and waits before trying again', async () => {
  const w = await world({ id: 'RET2', old: 2 })
  // Every batch meets a day doc another session just created.
  const day = `outbox/${ME}/days/${dayOf(w.host.clock.now - COMPACT_AFTER_MS - 60_000)}`
  w.db.beforeWrite = input => {
    if (input.action !== 'batch' || !JSON.stringify(input.writes).includes('/days')) return
    w.db.docs.set(day, { data: { v: 1, ts: 1, msgs: [] }, version: (w.db.docs.get(day)?.version ?? 0) + 1 })
  }
  await w.host.advance(5_000)
  expect(w.host.logs).toContain('transceiver: Transceiver · partalemre/eliti: compaction RelayError')
  expect(w.host.logs.some(l => l.includes(SECRET_TEXT) || l.includes('outbox'))).toBe(false)
  const runs = olderQueries(w.db)
  await w.host.advance(60_000)
  expect(olderQueries(w.db)).toBe(runs)
  await w.host.advance(RETENTION_RETRY_MS)
  expect(olderQueries(w.db)).toBe(runs + 1)
  await w.stop()
})

test('a full room of mine moves to a new room: notice in the old one, peers kept, old one stops', async () => {
  const w = await world({ id: 'RET3' })
  await w.host.advance(2_000)
  w.db.extraUsed = ROLLOVER_DOCS
  expect(enqueueMessage({ host: w.host, room: w.room, message: say(w.host, 'selam') })).toBe(true)
  await w.host.advance(2_000)
  expect(w.net.publishes).toBe(1)
  const rooms = await loadRooms(w.host)
  const next = rooms.find(r => r.id !== 'RET3')
  expect(rooms.find(r => r.id === 'RET3')?.status).toBe('left')
  expect(next?.status).toBe('active')
  expect(next?.peers).toEqual(w.room.peers)
  expect(next?.isLive).toBe(true)
  const notices = [...w.db.docs.values()].filter(d => d.data.kind === 'system').map(d => d.data.text)
  expect(notices).toEqual([`Oda doldu, yeni oda: ${next?.url}`])
  expect(w.dbs.get(next?.url ?? '')?.docs.has('meta/room')).toBe(true)
  expect(w.host.toasts).toContain('Transceiver: oda doldu; yeni odayı Paylaş ile tekrar davet et.')
  const calls = w.db.calls.length
  await w.host.advance(60_000)
  expect(w.db.calls.length).toBe(calls)
  expect(w.net.publishes).toBe(1)
  await w.stop()
})

test('a guest never rolls a room over', async () => {
  const w = await world({ id: 'RET4', isOwner: false })
  await w.host.advance(2_000)
  w.db.extraUsed = ROLLOVER_DOCS
  enqueueMessage({ host: w.host, room: w.room, message: say(w.host, 'selam') })
  await w.host.advance(5_000)
  expect(w.net.publishes).toBe(0)
  expect((await loadRooms(w.host)).map(r => r.status)).toEqual(['active'])
  await w.stop()
})

test('a refused publish warns once and is tried again later, not on every poll', async () => {
  const w = await world({ id: 'RET5', isPublishDenied: true })
  await w.host.advance(2_000)
  w.db.extraUsed = ROLLOVER_DOCS
  enqueueMessage({ host: w.host, room: w.room, message: say(w.host, 'a') })
  await w.host.advance(30_000)
  const tries = w.host.tools.filter(t => t.tool === 'Artifact' && t.action === 'publish').length
  expect(tries).toBe(1)
  await w.host.advance(RETENTION_RETRY_MS)
  expect(w.host.tools.filter(t => t.tool === 'Artifact' && t.action === 'publish').length).toBe(2)
  expect(w.host.toasts.filter(t => t.includes('açılamadı')).length).toBe(1)
  w.net.isPublishDenied = false
  await w.host.advance(RETENTION_RETRY_MS)
  expect(w.net.publishes).toBe(1)
  expect(w.host.toasts.filter(t => t.includes('açılamadı')).length).toBe(1)
  await w.stop()
})

test('a notice whose reply was lost is settled on the retry: one new room, one notice', async () => {
  const w = await world({ id: 'RET6' })
  await w.host.advance(2_000)
  w.db.extraUsed = ROLLOVER_DOCS
  w.db.beforeWrite = input => { if (JSON.stringify(input.writes ?? '').includes('"system"')) { w.db.isReplyLost = true; w.db.beforeWrite = undefined } }
  enqueueMessage({ host: w.host, room: w.room, message: say(w.host, 'a') })
  await w.host.advance(5_000)
  expect((await loadRooms(w.host)).find(r => r.id === 'RET6')?.status).toBe('active')
  await w.host.advance(RETENTION_RETRY_MS + 5_000)
  expect(w.net.publishes).toBe(1)
  expect([...w.db.docs.values()].filter(d => d.data.kind === 'system').length).toBe(1)
  expect((await loadRooms(w.host)).find(r => r.id === 'RET6')?.status).toBe('left')
  await w.stop()
})
