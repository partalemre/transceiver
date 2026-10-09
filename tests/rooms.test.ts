import { expect, mock, test } from 'claude-code/testing'
import { enqueueMessage, startLoop, stopRoom, syncOf } from '../hooks/room-loop'
import { roomPageHtml } from '../hooks/room-page'
import { createRoom, discoverInvites, invitedFrom, loadRooms, loadSettings, placeFound, roomTitle, saveRooms, type RoomRecord } from '../hooks/rooms'
import type { RoomMeta } from '../hooks/protocol'
import { NOT_ROOM_RETRY_MS } from '../hooks/limits'
import { callerFor, fakeDb, type FakeDb } from './fake-db'
import { fakeHost, type FakeHost } from './fake-host'
import type { CallResult } from '../hooks/host'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const ROOM = 'https://claude.ai/artifact/AAA111'
const ROOM_ID = '01K7A0000000000000000000R1'

test('room titles carry the prefix discovery looks for', () => {
  expect(roomTitle({ kind: 'dm' })).toBe('Transceiver · DM')
  expect(roomTitle({ kind: 'project', repo: 'partalemre/eliti' })).toBe('Transceiver · partalemre/eliti')
})

test('only unknown Transceiver urls from the shared list become invites', () => {
  const result = { artifacts: [
    { title: 'Transceiver · DM', url: 'https://claude.ai/artifact/AAA111', rel: 'shared' },
    { title: 'Quarterly plan', url: 'https://claude.ai/artifact/BBB222', rel: 'shared' },
    { title: 'Transceiver · DM', url: 'https://claude.ai/artifact/CCC333', rel: 'shared' },
    { title: 'Transceiver · DM', url: 'https://evil.example/artifact/DDD444', rel: 'shared' },
  ] }
  expect(invitedFrom({ result, text: '', knownUrls: ['https://claude.ai/artifact/CCC333'] })).toEqual(['https://claude.ai/artifact/AAA111'])
})

test('without a structured result the text lines are read', () => {
  const text = '- (shared) Transceiver · DM — https://claude.ai/artifact/AAA111\n- (shared) Brain Vault — https://claude.ai/artifact/BBB222'
  expect(invitedFrom({ result: undefined, text, knownUrls: [] })).toEqual(['https://claude.ai/artifact/AAA111'])
})

test('the room page declares its title first and never embeds data', () => {
  const html = roomPageHtml({ title: 'Transceiver · DM' })
  expect(html.startsWith('<title>Transceiver · DM</title>')).toBe(true)
  expect(['<script', 'claude.', 'u_', '<form'].filter(bit => html.includes(bit))).toEqual([])
})

test('a title with markup is escaped', () => {
  const html = roomPageHtml({ title: 'Transceiver · <b>x</b>' })
  expect(html.includes('<b>')).toBe(false)
  expect(html.startsWith('<title>Transceiver · &#60;b&#62;x&#60;/b&#62;</title>')).toBe(true)
})

test('the room page tells how to join with its link', () => {
  const html = roomPageHtml({ title: 'Transceiver · DM' })
  expect(html.includes('<code>/transceiver katıl &lt;link&gt;</code>')).toBe(true)
  expect(html.includes('<code>/plugin install transceiver')).toBe(true)
})

// A test's tool.call hook answers as core does: `{ result, text, isError? }`, or `{ deny }`.
const asToolResult = (out: CallResult) =>
  (out.deny !== undefined ? { deny: out.deny } : { result: out.result ?? {}, text: out.text ?? '', ...(out.isError === true ? { isError: true } : {}) }) as never

type World = { db: FakeDb; host: FakeHost }

function world(): World {
  const db = fakeDb(ME)
  const host = fakeHost(async input => {
    if (input.tool === 'ArtifactData') return callerFor(db)(input)
    if (input.action === 'publish') return { result: {}, text: `Published at ${ROOM} (Version 1)` }
    return { result: { artifacts: [{ title: 'Transceiver · DM', url: ROOM, rel: 'shared' }] }, text: '' }
  })
  return { db, host }
}

test('creating a room publishes its page with db and profile rules, then writes meta with the press as consent', async () => {
  const { db, host } = world()
  const room = await createRoom({ host, kind: 'project', repo: 'partalemre/eliti', consent: 'The user ran "/transceiver proje"' })
  expect(room).toMatchObject({ url: ROOM, kind: 'project', repo: 'partalemre/eliti', status: 'active' })
  const publish = host.tools.find(t => t.tool === 'Artifact') as { file_path: string; consent: string; capabilities: { user: unknown } }
  expect(publish.capabilities.user).toEqual({ scopes: ['profile'] })
  expect(publish.consent).toBe('The user ran "/transceiver proje"')
  expect(host.written[publish.file_path]?.startsWith('<title>Transceiver · partalemre/eliti</title>')).toBe(true)
  expect(db.docs.get('meta/room')?.data).toEqual({ v: 1, kind: 'project', repo: 'partalemre/eliti', room: room.room, createdAt: host.clock.now })
  expect(room.boxes).toEqual([])
  expect(host.tools.filter(t => t.tool === 'ArtifactData').every(t => typeof t.consent === 'string')).toBe(true)
})

test('a refused publish surfaces as an error and writes no meta', async () => {
  const db = fakeDb(ME)
  const host = fakeHost(async input => (input.tool === 'Artifact' ? { deny: 'not now' } : callerFor(db)(input)))
  const err = await createRoom({ host, kind: 'dm' }).catch(e => e)
  expect(err instanceof Error && err.message.includes('not now')).toBe(true)
  expect(db.docs.size).toBe(0)
})

test('discovery finds a shared mailbox only once its meta doc parses, reading a non-room again only later', async () => {
  const { db, host } = world()
  expect(await discoverInvites({ host, known: [] })).toEqual([])
  const meta = { v: 1, kind: 'dm', room: ROOM_ID, createdAt: 1 }
  db.docs.set('meta/room', { data: meta, version: 1 })
  expect(await discoverInvites({ host, known: [] })).toEqual([])
  host.clock.now += NOT_ROOM_RETRY_MS
  const found = await discoverInvites({ host, known: [] })
  expect(found).toEqual([{ url: ROOM, meta }])
  const placed = placeFound({ rooms: [], found, now: 1 })
  expect(placed.map(r => [r.url, r.boxes, r.status, r.title, r.room])).toEqual([['', [ROOM], 'invited', 'Transceiver · DM', ROOM_ID]])
  expect(await discoverInvites({ host, known: placed })).toEqual([])
})

const OTHER = 'https://claude.ai/artifact/OTHER222'
const mine = (o: Partial<RoomRecord>): RoomRecord => ({
  id: 'r9', room: ROOM_ID, url: ROOM, boxes: [], kind: 'dm', title: 'Transceiver · DM', status: 'active', isLive: false, peers: [], joinedAt: 1, ...o,
})
const found = (o: Partial<RoomMeta> = {}) => ({ url: OTHER, meta: { v: 1 as const, kind: 'dm' as const, room: ROOM_ID, createdAt: 1, ...o } })

test('a found mailbox of a room this person is in joins that room instead of becoming an invite', () => {
  expect(placeFound({ rooms: [mine({})], found: [found()], now: 1 }).map(r => r.boxes)).toEqual([[OTHER]])
})

test('a DM takes one other mailbox; a second, a left room or a mismatched kind is not merged', () => {
  const full = mine({ boxes: ['https://claude.ai/artifact/FIRST'] })
  expect(placeFound({ rooms: [full], found: [found()], now: 1 })).toEqual([full])
  expect(placeFound({ rooms: [mine({})], found: [found({ kind: 'project', repo: 'a/b' })], now: 1 })).toEqual([mine({})])
  const left = mine({ status: 'left' })
  expect(placeFound({ rooms: [left], found: [found()], now: 1 }).map(r => r.status)).toEqual(['left', 'invited'])
})

test('a mailbox held anywhere already is not placed again', () => {
  const rooms = [mine({ boxes: [OTHER] })]
  expect(placeFound({ rooms, found: [found()], now: 1 })).toBe(rooms)
})

test('rooms and settings round-trip through the store with defaults', async () => {
  const { host } = world()
  expect(await loadRooms(host)).toEqual([])
  expect((await loadSettings(host)).isReceiptsOn).toBe(true)
  const room = await createRoom({ host, kind: 'dm' })
  await saveRooms(host, [room])
  expect((await loadRooms(host)).map(r => r.url)).toEqual([ROOM])
})

test('the loop polls an active room, sends what is queued, and keeps the state in the store', async () => {
  const { db, host } = world()
  const room = { ...(await createRoom({ host, kind: 'dm' })), id: 'r1' }
  await saveRooms(host, [room])
  await startLoop(host)
  await host.advance(0)
  expect(db.calls.some(c => c.action === 'list' && c.collection === 'outbox')).toBe(true)
  const message = { v: 1 as const, id: '01K7A0000000000000000000A1', ts: 5, kind: 'human' as const, text: 'selam' }
  expect(enqueueMessage({ host, room, message })).toBe(true)
  expect(syncOf('r1')?.entries.at(-1)?.isPending).toBe(true)
  await host.advance(0)
  expect(db.docs.has(`outbox/${ME}/msgs/${message.id}`)).toBe(true)
  expect(syncOf('r1')?.pending.length).toBe(0)
  expect((host.store.get('tx.sync.r1') as { ownHead: { head: string } }).ownHead.head).toBe(message.id)
  stopRoom('r1')
})

test('a failing room logs its title and the error name only, and tries again later', async () => {
  const { db, host } = world()
  const room = { ...(await createRoom({ host, kind: 'dm' })), id: 'r2' }
  await saveRooms(host, [room])
  db.isDown = true
  await startLoop(host)
  await host.advance(0)
  expect(host.logs).toEqual(['transceiver: Transceiver · DM: RelayError'])
  db.isDown = false
  await host.advance(10_000)
  expect(syncOf('r2')?.selfUid).toBe(ME)
  stopRoom('r2')
})

test('session start runs the loop through the engine, reading rooms from the store', async ($, on) => {
  const db = fakeDb(ME)
  const room = { id: 'r3', url: ROOM, kind: 'dm', title: 'Transceiver · DM', status: 'active', isLive: false, room: 'R0000000000000000000000000', boxes: [], peers: [], joinedAt: 1 }
  mock.store(on, { 'tx.rooms': [room] })
  const clock = mock.clock(on, { now: 1_791_545_100_000 })
  mock.env(on, { HOME: '/home/u' })
  on('tool.call', async (_$, e) => asToolResult(await callerFor(db)(e as unknown as Record<string, unknown>)))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/w' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' } as never)
  await clock.settle()
  expect(db.calls.some(c => c.action === 'list' && c.collection === 'outbox' && c.url === ROOM)).toBe(true)
})
