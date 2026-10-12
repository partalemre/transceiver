import { expect, mock, test } from 'claude-code/testing'
import type { CallResult } from '../hooks/host'
import { parseCommand, runCommand } from '../hooks/commands'
import { joinRoom, joinUrlOf, shareBack } from '../hooks/join'
import { stopRoom } from '../hooks/room-loop'
import { loadRooms, saveRooms, type RoomRecord } from '../hooks/rooms'
import { callerFor, fakeDb } from './fake-db'
import { fakeHost } from './fake-host'
import { setLang } from '../hooks/kit/lang'

// These tests read the Turkish interface (MODZ_LANG=tr); the English one has its own tests.
setLang('tr')

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const LINK = 'https://claude.ai/artifact/WY6LgKgyskkYWeg16kuUrb'
const NEW_ROOM = 'https://claude.ai/artifact/NEW111'
const ROOM_ID = '01K7A0000000000000000000R1'

test('no args opens the pane; Turkish verbs parse with or without diacritics', () => {
  expect(parseCommand('')).toEqual({ verb: 'open', arg: '' })
  expect(parseCommand('ekle')).toEqual({ verb: 'ekle', arg: '' })
  expect(parseCommand('çık DM')).toEqual({ verb: 'cik', arg: 'DM' })
  expect(parseCommand('Çık DM')).toEqual({ verb: 'cik', arg: 'DM' })
  expect(parseCommand('katıl https://claude.ai/artifact/AAA')).toEqual({ verb: 'katil', arg: 'https://claude.ai/artifact/AAA' })
  expect(parseCommand('katil https://claude.ai/artifact/AAA')).toEqual({ verb: 'katil', arg: 'https://claude.ai/artifact/AAA' })
  expect(parseCommand('proje partalemre/eliti')).toEqual({ verb: 'proje', arg: 'partalemre/eliti' })
  expect(parseCommand('bilinmeyen')).toEqual({ verb: 'yardim', arg: 'bilinmeyen' })
})

test('only a claude.ai artifact link is accepted for joining', () => {
  expect(joinUrlOf(` ${LINK} `)).toBe(LINK)
  expect(joinUrlOf('https://evil.example/artifact/AAA')).toBe(null)
  expect(joinUrlOf(`${LINK} ${LINK}x`)).toBe(null)
  expect(joinUrlOf('')).toBe(null)
})

// `db` is the linked mailbox; the person's own new mailbox has its own db.
function world() {
  const db = fakeDb(ME)
  const own = fakeDb(ME)
  const opened: string[] = []
  const host = fakeHost(async input => {
    if (input.tool === 'ArtifactData') return callerFor(input.url === NEW_ROOM ? own : db)(input)
    return { result: {}, text: `Published at ${NEW_ROOM} (Version 1)` }
  })
  const deps = { host, openPane: async () => { opened.push('pane') } }
  return { db, host, opened, deps }
}

const META = { v: 1, kind: 'project', repo: 'partalemre/eliti', room: ROOM_ID, createdAt: 1 }

test('joining by link checks the meta, opens the joiner\'s own mailbox with the command as consent, and polls both', async () => {
  const { db, host } = world()
  expect((await joinRoom(host, LINK)).text).toBe('Bu link bir Transceiver kutusu değil ya da sana paylaşılmamış.')
  db.docs.set('meta/room', { data: META, version: 1 })
  const joined = await joinRoom(host, LINK)
  expect(joined.text).toBe(`Transceiver · partalemre/eliti odasına katıldın. Kendi kutun: ${NEW_ROOM}\n${shareBack()}`)
  expect(joined.isNew).toBe(true)
  expect(host.tools.find(t => t.tool === 'Artifact')?.consent).toBe(`The user ran "/transceiver katıl ${LINK}"`)
  const [room] = await loadRooms(host)
  expect(room).toMatchObject({ url: NEW_ROOM, boxes: [LINK], room: ROOM_ID, status: 'active', kind: 'project' })
  expect((await joinRoom(host, LINK)).text).toBe('Bu odaya zaten katıldın.')
  await host.advance(0)
  expect(db.calls.some(c => c.action === 'list' && c.collection === 'outbox' && c.url === LINK)).toBe(true)
  if (room !== undefined) stopRoom(room.id)
})

test('a link to another member\'s mailbox of a room already joined adds it there and publishes nothing', async () => {
  const { db, host } = world()
  const own = { ...record('r1', 'Transceiver · partalemre/eliti', NEW_ROOM), kind: 'project' as const, repo: 'partalemre/eliti', room: ROOM_ID }
  await saveRooms(host, [own])
  db.docs.set('meta/room', { data: META, version: 1 })
  expect((await joinRoom(host, LINK)).text).toBe('Transceiver · partalemre/eliti: karşı tarafın kutusu eklendi.')
  expect((await loadRooms(host)).map(r => r.boxes)).toEqual([[LINK]])
  expect(host.tools.some(t => t.tool === 'Artifact')).toBe(false)
  stopRoom('r1')
})

test('a bad link gets the usage line and touches nothing', async () => {
  const { db, host } = world()
  expect((await joinRoom(host, 'https://evil.example/artifact/AAA')).text).toBe('Kullanım: /transceiver katıl <https://claude.ai/artifact/…>')
  expect(db.calls.length).toBe(0)
})

test('ekle publishes a DM room with the command as consent, opens the pane and says how to share it', async () => {
  const { host, opened, deps } = world()
  const text = await runCommand({ ...deps, cmd: parseCommand('ekle') })
  expect(text?.startsWith(`Oda hazır, kendi kutun: ${NEW_ROOM}`)).toBe(true)
  expect(opened).toEqual(['pane'])
  expect(host.tools.find(t => t.tool === 'Artifact')?.consent).toBe('The user ran "/transceiver ekle"')
  const rooms = await loadRooms(host)
  expect(rooms.map(r => [r.kind, r.status])).toEqual([['dm', 'active']])
  for (const r of rooms) stopRoom(r.id)
})

test('proje needs owner/repo', async () => {
  const { deps } = world()
  expect(await runCommand({ ...deps, cmd: parseCommand('proje ../x') })).toBe('Kullanım: /transceiver proje <sahip/repo>')
})

test('a refused publish is reported, not thrown', async () => {
  const { deps } = world()
  const host = fakeHost(async (): Promise<CallResult> => ({ deny: 'izin verilmedi' }))
  expect(await runCommand({ ...deps, host, cmd: parseCommand('ekle') })).toBe('Oda açılamadı: room publish failed: izin verilmedi')
})

const record = (id: string, title: string, url: string): RoomRecord => ({
  id, url, kind: 'dm', title, status: 'active', isLive: false, room: 'R0000000000000000000000000', boxes: [], peers: [], joinedAt: 1,
})

test('çık needs a name or link that picks exactly one active room', async () => {
  const { host, deps } = world()
  await saveRooms(host, [record('a', 'Transceiver · DM', 'https://claude.ai/artifact/A1'), record('b', 'Transceiver · DM', 'https://claude.ai/artifact/B2'), record('c', 'Transceiver · partalemre/eliti', 'https://claude.ai/artifact/C3')])
  expect(await runCommand({ ...deps, cmd: parseCommand('çık') })).toBe('Kullanım: /transceiver çık <oda adı | link>')
  expect(await runCommand({ ...deps, cmd: parseCommand('çık DM') })).toBe('Birden fazla oda eşleşti; odanın linkiyle dene.')
  expect(await runCommand({ ...deps, cmd: parseCommand('çık eliti') })).toBe('Transceiver · partalemre/eliti odasından çıkıldı.')
  expect(await runCommand({ ...deps, cmd: parseCommand('çık https://claude.ai/artifact/A1') })).toBe('Transceiver · DM odasından çıkıldı.')
  expect((await loadRooms(host)).map(r => r.status)).toEqual(['left', 'active', 'left'])
  expect(await runCommand({ ...deps, cmd: parseCommand('çık yok') })).toBe('Oda bulunamadı: yok')
})

test('open, kur and ayarlar open the pane with no text; anything else prints help', async () => {
  const { opened, deps } = world()
  for (const args of ['', 'kur', 'ayarlar']) expect(await runCommand({ ...deps, cmd: parseCommand(args) })).toBe(null)
  expect(opened.length).toBe(3)
  expect(await runCommand({ ...deps, cmd: parseCommand('nedir') })).toContain('/transceiver katıl <link>')
})

test('/transceiver is registered and answers through the engine', async ($, on) => {
  const db = fakeDb(ME)
  db.docs.set('meta/room', { data: { v: 1, kind: 'dm', room: ROOM_ID, createdAt: 1 }, version: 1 })
  const registered: string[] = []
  const hints: Array<string | undefined> = []
  mock.store(on, { 'tx.rooms': [{ ...record('r1', 'Transceiver · DM', NEW_ROOM), room: ROOM_ID }] })
  mock.clock(on, { now: 1_791_545_100_000 })
  mock.env(on, { HOME: '/home/u', MODZ_LANG: 'tr' })
  on('command.register', (_$, e) => { registered.push(e.name); hints.push(e.argumentHint); return { value: { command: e.name } } })
  on('tool.call', async (_$, e) => {
    const out = await callerFor(db)(e as unknown as Record<string, unknown>)
    return (out.deny !== undefined ? { deny: out.deny } : { result: {}, text: out.text ?? '', ...(out.isError === true ? { isError: true } : {}) }) as never
  })
  on('session.start', () => ({ cwd: '/w' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' } as never)
  expect(registered).toEqual(['transceiver'])
  // A bare /transceiver is the whole entry point: the menu shows no verbs to puzzle over.
  expect(hints).toEqual([undefined])
  const out = await $.command.run({ command: 'transceiver', args: `katıl ${LINK}` } as never)
  expect(out.text).toBe('Transceiver · DM: karşı tarafın kutusu eklendi.')
  stopRoom('r1')
})
