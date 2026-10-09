import { expect, mock, test } from 'claude-code/testing'
import { enqueueMessage, startLoop, stopRoom, syncOf } from '../hooks/room-loop'
import { roomPageHtml } from '../hooks/room-page'
import { createRoom, discoverInvites, invitedFrom, loadRooms, loadSettings, roomTitle, saveRooms } from '../hooks/rooms'
import { callerFor, fakeDb, type FakeDb } from './fake-db'
import { fakeHost, type FakeHost } from './fake-host'
import type { CallResult } from '../hooks/host'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const ROOM = 'https://claude.ai/artifact/AAA111'

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
  expect(html.includes('claude.use("db")')).toBe(true)
  expect(html.includes('u_')).toBe(false)
})

test('a title with markup is escaped', () => {
  expect(roomPageHtml({ title: 'Transceiver · <b>x</b>' }).includes('<b>')).toBe(false)
})

test('the room page only ever moves its head forward and merges into it', () => {
  const html = roomPageHtml({ title: 'Transceiver · DM' })
  expect(html.includes('.update({ head: id, headTs: ts })')).toBe(true)
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
  expect(room).toMatchObject({ url: ROOM, kind: 'project', repo: 'partalemre/eliti', status: 'active', isOwner: true })
  const publish = host.tools.find(t => t.tool === 'Artifact') as { file_path: string; consent: string; capabilities: { user: unknown } }
  expect(publish.capabilities.user).toEqual({ scopes: ['profile'] })
  expect(publish.consent).toBe('The user ran "/transceiver proje"')
  expect(host.written[publish.file_path]?.startsWith('<title>Transceiver · partalemre/eliti</title>')).toBe(true)
  expect(db.docs.get('meta/room')?.data).toEqual({ v: 1, kind: 'project', repo: 'partalemre/eliti', createdAt: host.clock.now })
  expect(host.tools.filter(t => t.tool === 'ArtifactData').every(t => typeof t.consent === 'string')).toBe(true)
})

test('a refused publish surfaces as an error and writes no meta', async () => {
  const db = fakeDb(ME)
  const host = fakeHost(async input => (input.tool === 'Artifact' ? { deny: 'not now' } : callerFor(db)(input)))
  const err = await createRoom({ host, kind: 'dm' }).catch(e => e)
  expect(err instanceof Error && err.message.includes('not now')).toBe(true)
  expect(db.docs.size).toBe(0)
})

test('discovery offers a shared room only once its meta doc parses', async () => {
  const { db, host } = world()
  expect(await discoverInvites({ host, known: [] })).toEqual([])
  db.docs.set('meta/room', { data: { v: 1, kind: 'dm', createdAt: 1 }, version: 1 })
  const found = await discoverInvites({ host, known: [] })
  expect(found.map(r => [r.url, r.status, r.title])).toEqual([[ROOM, 'invited', 'Transceiver · DM']])
  expect(await discoverInvites({ host, known: found })).toEqual([])
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
  const room = { id: 'r3', url: ROOM, kind: 'dm', title: 'Transceiver · DM', status: 'active', isLive: false, isOwner: true, peers: [], joinedAt: 1 }
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
