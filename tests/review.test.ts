// Findings of the whole-repo review (docs/progress.md, "Review pass"), one test each.
import { expect, test } from 'claude-code/testing'
import { askModel } from '../hooks/ask'
import { parseCommand, runCommand } from '../hooks/commands'
import { setConnected } from '../hooks/connection'
import { addDraft, loadDrafts } from '../hooks/drafts'
import type { CallResult } from '../hooks/host'
import { joinRoom } from '../hooks/join'
import { DISCOVER_MS, MAX_DRAFTS_PER_ROOM } from '../hooks/limits'
import type { Message } from '../hooks/protocol'
import { enqueueMessage, startLoop, stopRoom, syncOf } from '../hooks/room-loop'
import { loadRooms, saveRooms, type RoomRecord } from '../hooks/rooms'
import { mergeEntries } from '../hooks/timeline'
import { newId } from '../hooks/ulid'
import { answered, fakeAgent, gitIn } from './fake-agent'
import { callerFor, fakeDb, writesOf } from './fake-db'
import { fakeHost } from './fake-host'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const room = (id: string): RoomRecord => ({
  id, url: `https://claude.ai/artifact/${id}`, kind: 'dm', title: 'Transceiver · DM',
  status: 'active', isLive: false, room: 'R0000000000000000000000000', boxes: [], peers: [], joinedAt: 0,
})
const human = (ts: number, text: string): Message => ({ v: 1, id: newId(ts), ts, kind: 'human', text })

// A gate the test opens by hand: a call waits on it while `isShut`.
function gate() {
  const g = { isShut: false, waiting: [] as Array<() => void>, inFlight: 0, most: 0 }
  const pass = async () => {
    g.inFlight += 1
    g.most = Math.max(g.most, g.inFlight)
    if (g.isShut) await new Promise<void>(resolve => g.waiting.push(resolve))
    g.inFlight -= 1
  }
  const open = () => { g.isShut = false; for (const r of g.waiting.splice(0)) r() }
  return { g, pass, open }
}

test('a poke while a poll is in flight never starts a second poll of the same room', async () => {
  setConnected(true)
  const db = fakeDb(ME)
  const call = callerFor(db)
  const { g, pass, open } = gate()
  const host = fakeHost(async input => {
    if (input.action === 'list' && input.collection === 'outbox') await pass()
    return call(input)
  })
  const r = room('REV1')
  await saveRooms(host, [r])
  g.isShut = true
  await startLoop(host)
  await host.advance(0)
  const message = human(host.clock.now, 'selam')
  expect(enqueueMessage({ host, room: r, message })).toBe(true)
  await host.advance(0)
  await host.advance(500)
  expect(g.most).toBe(1)
  open()
  await host.advance(0)
  await host.advance(0)
  expect(g.most).toBe(1)
  const sends = writesOf(db).filter(w => JSON.stringify(w.writes ?? '').includes(message.id))
  expect(sends.length).toBe(1)
  expect(syncOf('REV1')?.pending.length).toBe(0)
  stopRoom('REV1')
})

test('discovery never overlaps itself and reads a shared artifact that is not a room only once', async () => {
  const db = fakeDb(ME)
  const call = callerFor(db)
  const { g, pass, open } = gate()
  const lists: number[] = []
  const notRoom = 'https://claude.ai/artifact/NOTAROOM1'
  const host = fakeHost(async (input): Promise<CallResult> => {
    if (input.tool === 'Artifact') {
      lists.push(host.clock.now)
      return { result: { artifacts: [{ title: 'Transceiver · fake', url: notRoom }] }, text: '' }
    }
    if (input.action === 'get') await pass()
    return call(input)
  })
  await startLoop(host)
  g.isShut = true
  await host.advance(DISCOVER_MS)
  await host.advance(DISCOVER_MS)
  expect(lists.length).toBe(1)
  open()
  await host.advance(DISCOVER_MS)
  await host.advance(DISCOVER_MS)
  const metaReads = db.calls.filter(c => c.action === 'get' && c.url === notRoom).length
  expect(metaReads).toBe(1)
})

test('a room joined by link while discovery runs is not saved twice', async () => {
  const [db, mine] = [fakeDb(ME), fakeDb(ME)]
  const url = 'https://claude.ai/artifact/JOINED1'
  const own = 'https://claude.ai/artifact/MINE1'
  db.docs.set('meta/room', { data: { v: 1, kind: 'dm', room: newId(1), createdAt: 1 }, version: 1 })
  const { g, pass, open } = gate()
  const host = fakeHost(async (input): Promise<CallResult> => {
    if (input.tool === 'Artifact' && input.action === 'publish') return { result: { url: own }, text: `Published at ${own}` }
    if (input.tool === 'Artifact') return { result: { artifacts: [{ title: 'Transceiver · DM', url }] }, text: '' }
    if (input.action === 'get' && g.isShut) await pass()
    return callerFor(input.url === own ? mine : db)(input)
  })
  await startLoop(host)
  g.isShut = true
  await host.advance(DISCOVER_MS)
  g.isShut = false
  const joined = await joinRoom(host, url)
  expect([joined.text.startsWith('Transceiver · DM odasına katıldın.'), joined.isNew]).toEqual([true, true])
  open()
  await host.advance(0)
  const rooms = await loadRooms(host)
  expect(rooms.map(r => [r.url, r.boxes, r.status])).toEqual([[own, [url], 'active']])
  for (const r of rooms) stopRoom(r.id)
})

test('leaving a room frees its stored sync state', async () => {
  const host = fakeHost(callerFor(fakeDb(ME)))
  const r = room('REV4')
  await saveRooms(host, [r])
  await startLoop(host)
  await host.advance(0)
  expect(await host.storeGet('tx.sync.REV4')).not.toBe(undefined)
  const said = await runCommand({ host, openPane: async () => undefined, cmd: parseCommand('çık DM') })
  expect(said).toBe('Transceiver · DM odasından çıkıldı.')
  expect(await host.storeGet('tx.sync.REV4')).toBe(null)
  expect(syncOf('REV4')).toBe(undefined)
})

test('a peer reusing my message id in their own outbox neither hides mine nor is dropped', () => {
  const mine = human(10, 'benim')
  const theirs = { ...mine, text: 'onların' }
  const merged = mergeEntries([{ author: ME, message: mine }], [{ author: PEER, message: theirs }])
  expect(merged.map(e => [e.author, 'text' in e.message ? e.message.text : ''])).toEqual([[ME, 'benim'], [PEER, 'onların']])
  // One author's copy in a day doc and in msgs is still one entry.
  expect(mergeEntries([{ author: PEER, message: theirs }], [{ author: PEER, message: theirs }]).length).toBe(1)
})

test('drafts past the ask limit are capped per room, so a flood of asks cannot grow the store', async () => {
  const host = fakeHost(async () => ({}))
  for (let i = 0; i < MAX_DRAFTS_PER_ROOM + 5; i++) {
    await addDraft(host, { roomId: 'A', qid: newId(i), question: `q${i}`, asker: PEER })
  }
  expect(await addDraft(host, { roomId: 'A', qid: newId(MAX_DRAFTS_PER_ROOM + 5), question: 'q', asker: PEER })).toBe(false)
  await addDraft(host, { roomId: 'B', qid: newId(1), question: 'q', asker: PEER })
  const drafts = await loadDrafts(host)
  expect(drafts.filter(d => d.roomId === 'A').length).toBe(MAX_DRAFTS_PER_ROOM)
  expect(drafts.filter(d => d.roomId === 'B').length).toBe(1)
})

test('a staged rename onto a secret file does not name it to the model', async () => {
  const host = fakeAgent(async () => ({}), gitIn('partalemre/eliti', async argv => {
    if (argv.includes('status')) return { exitCode: 0, stdout: '## main\nR  notes.txt -> .env\nR  .env.local -> old.txt\n M lib/a.dart\n', stderr: '' }
    return { exitCode: 0, stdout: '', stderr: '' }
  }))
  host.reply = () => answered('tamam')
  await askModel(host, { root: '/w', question: 'ne değişti?', nonce: 'N0NCE0000000000X' })
  const prompt = host.asked[0]?.prompt ?? ''
  expect(prompt).toContain('lib/a.dart')
  expect(prompt).not.toContain('.env')
})
