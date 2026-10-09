import { expect, test } from 'claude-code/testing'
import { dayOf } from '../hooks/compact'
import type { CallResult } from '../hooks/host'
import { COMPACT_AFTER_MS, RETENTION_RETRY_MS, ROLLOVER_DOCS } from '../hooks/limits'
import type { Message } from '../hooks/protocol'
import { emptyHead } from '../hooks/protocol'
import { MOVED, wireRetention } from '../hooks/retention'
import { enqueueMessage, setViewing, startLoop, stopRoom, syncOf } from '../hooks/room-loop'
import { loadRooms, saveRooms, type RoomRecord } from '../hooks/rooms'
import { newId } from '../hooks/ulid'
import { fakeAgent, type FakeAgent } from './fake-agent'
import { callerFor, fakeDb, type FakeDb } from './fake-db'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const THIRD = 'u_CCCCCCCCCCCCCCCCCCCCCC'
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

async function world(opts: { id: string; boxes?: Map<string, FakeDb>; later?: Map<string, FakeDb>; old?: number; isPublishDenied?: boolean }): Promise<World & { net: { publishes: number; isPublishDenied?: boolean } }> {
  const url = `https://claude.ai/artifact/${opts.id}`
  const db = fakeDb(ME)
  const net = { dbs: new Map([[url, db], ...(opts.boxes ?? []), ...(opts.later ?? [])]), publishes: 0, isPublishDenied: opts.isPublishDenied }
  const host = fakeAgent(router(net))
  const old = host.clock.now - COMPACT_AFTER_MS - 60_000
  for (let i = 0; i < (opts.old ?? 0); i++) {
    const id = newId(old + i)
    db.docs.set(`outbox/${ME}/msgs/${id}`, { data: { v: 1, id, ts: old + i, kind: 'human', text: SECRET_TEXT }, version: 1 })
  }
  const room: RoomRecord = {
    id: opts.id, url, kind: 'project', repo: 'partalemre/eliti', title: 'Transceiver · partalemre/eliti', status: 'active',
    isLive: true, room: 'R0000000000000000000000000', boxes: [...(opts.boxes?.keys() ?? [])], peers: [{ uid: PEER, gh: 'alperenx', isGhConfirmed: true }], joinedAt: 0,
  }
  await saveRooms(host, [room])
  // Module state other test files may leave behind: the pane counts as closed here (5 s polls).
  setViewing(null, false)
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
  // The next day (the marker names another day): one more run.
  await w.host.storeSet('tx.compacted.RET1', '2000-01-01')
  await w.host.advance(5_000)
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

test('a full mailbox of mine moves to a new one: notice in the old one, peers kept, old one stops', async () => {
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
  expect([next?.room, next?.boxes]).toEqual([w.room.room, w.room.boxes])
  const notices = [...w.db.docs.values()].filter(d => d.data.kind === 'system').map(d => d.data.text)
  expect(notices).toEqual([`${MOVED}${next?.url}`])
  expect(w.dbs.get(next?.url ?? '')?.docs.has('meta/room')).toBe(true)
  expect(w.host.toasts).toContain('Transceiver: kutun doldu; yeni kutunu Paylaş ile odadakilere tekrar aç.')
  const calls = w.db.calls.length
  await w.host.advance(60_000)
  expect(w.db.calls.length).toBe(calls)
  expect(w.net.publishes).toBe(1)
  await w.stop()
})

const PEER_BOX = 'https://claude.ai/artifact/PEER1'
const THIRD_BOX = 'https://claude.ai/artifact/THIRD1'
const PEER_NEXT = 'https://claude.ai/artifact/PEER2'

function says(db: FakeDb, uid: string, message: Message): void {
  db.docs.set(`outbox/${uid}/msgs/${message.id}`, { data: message, version: 1 })
  const prev = db.docs.get(`outbox/${uid}`)
  db.docs.set(`outbox/${uid}`, { data: { ...emptyHead(), head: message.id, headTs: message.ts }, version: (prev?.version ?? 0) + 1 })
}

test('a member\'s move notice swaps their mailbox; one forged into another mailbox moves nothing', async () => {
  const [peer, third, next] = [fakeDb(PEER), fakeDb(THIRD), fakeDb(PEER)]
  const w = await world({ id: 'RET4', boxes: new Map([[PEER_BOX, peer], [THIRD_BOX, third]]), later: new Map([[PEER_NEXT, next]]) })
  await w.host.advance(2_000)
  says(third, THIRD, say(w.host, 'selam'))
  says(third, PEER, { ...say(w.host, ''), kind: 'system', text: `${MOVED}https://claude.ai/artifact/EVIL1` })
  says(peer, PEER, { ...say(w.host, ''), kind: 'system', text: `${MOVED}${PEER_NEXT}` })
  await w.host.advance(5_000)
  expect((await loadRooms(w.host)).find(r => r.id === 'RET4')?.boxes).toEqual([PEER_NEXT, THIRD_BOX])
  expect(w.net.publishes).toBe(0)
  says(next, PEER, say(w.host, 'yeni kutudan'))
  await w.host.advance(5_000)
  expect((syncOf('RET4')?.entries ?? []).some(e => 'text' in e.message && e.message.text === 'yeni kutudan')).toBe(true)
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
