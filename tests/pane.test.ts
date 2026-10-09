// The pane through the engine, on the terminal and the desktop: opening, adding a room, the session's first write
// raised by "Bağlan", sending, invites, the GitHub question and the switches.
import { expect, test } from 'claude-code/testing'

import { paths } from '../hooks/protocol'
import type { RoomRecord } from '../hooks/rooms'
import { ALPEREN, dmAlperen, dmZeynep, idAt, ME, projectEliti, room, ROOMS } from './pane-fixtures'
import { mountPane, paneWorld, startSession, type World } from './pane-world'

const SURFACES = ['terminal', 'desktop'] as const
const NARROW = 58
const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
const SYNCS = () => ({ ra: dmAlperen(), re: projectEliti(), rz: dmZeynep() })

const drawn = async (ui: any) => JSON.stringify(await ui.drawn())
const roomsIn = (w: World): RoomRecord[] => (w.store['tx.rooms'] ?? []) as RoomRecord[]
const composerKey = async (ui: any): Promise<string> => (await ui.findAll({ type: 'Input' }))[0]?.key ?? ''

for (const surface of SURFACES) {
  test(`${surface}: /transceiver opens the pane on the empty state; "Arkadaş ekle" publishes from inside the repo`, async ($: any, on: any) => {
    const w = paneWorld(on, { rooms: [], syncs: {} })
    await startSession($, w, { surface })
    await $.command.run({ command: 'transceiver', args: '' })
    expect(w.opens).toHaveLength(1)
    const ui = await mountPane($, { surface, columns: NARROW })
    expect(await drawn(ui)).toContain('Arkadaş ekle')
    await ui.press({ key: 'add-dm' })
    const publish = w.calls.find(c => c.tool === 'Artifact' && c.action === 'publish') as { file_path: string; consent: string }
    expect(publish.file_path.startsWith('/w/.git/transceiver/room-')).toBe(true)
    expect(publish.consent).toBe('The user pressed "Arkadaş ekle" on the Transceiver pane')
    expect(w.runs.some(argv => argv.join(' ') === `rm -f -- ${publish.file_path}`)).toBe(true)
    expect((roomsIn(w)).map(r => r.status)).toEqual(['active'])
    expect(await drawn(ui)).toContain('Linki kopyala')
    await ui.press({ key: 'copy-link' })
    expect(w.copies).toEqual(['https://claude.ai/artifact/NEWROOM1x'])
  })

  test(`${surface}: the empty state offers every first step; the project form starts with the session's repo`, async ($: any, on: any) => {
    const w = paneWorld(on, { rooms: [], syncs: {}, remote: 'git@github.com:partalemre/eliti.git' })
    await startSession($, w, { surface, isBypass: true })
    await $.command.run({ command: 'transceiver', args: '' })
    const ui = await mountPane($, { surface, columns: NARROW })
    for (const key of ['add-dm', 'open-add', 'open-join', 'open-settings']) expect(await ui.findAll({ type: 'Button', key })).toHaveLength(1)
    await ui.press({ key: 'open-settings' })
    expect(await drawn(ui)).toContain('Okundu bilgisi')
    await ui.press({ key: 'back' })
    await ui.press({ key: 'open-add' })
    expect(await ui.findAll({ type: 'Input', key: 'add-repo', text: 'partalemre/eliti' })).toHaveLength(1)
    await ui.input({ key: 'add-repo', text: 'partalemre/eliti' })
    expect(roomsIn(w).map(r => [r.kind, r.repo])).toEqual([['project', 'partalemre/eliti']])
  })

  test(`${surface}: outside a GitHub repo the project form starts empty`, async ($: any, on: any) => {
    const w = paneWorld(on, { rooms: [], syncs: {}, remote: 'git@gitlab.com:someone/thing.git' })
    await startSession($, w, { surface, isBypass: true })
    const ui = await mountPane($, { surface, columns: NARROW })
    await ui.press({ key: 'open-join' })
    const [field] = await ui.findAll({ type: 'Input', key: 'add-repo' })
    expect(field).toBeDefined()
    expect(await ui.findAll({ type: 'Input', key: 'add-repo', text: /\w/ })).toHaveLength(0)
  })

  test(`${surface}: until "Bağlan" a message waits on screen and nothing is written`, async ($: any, on: any) => {
    const w = paneWorld(on, { rooms: ALL, syncs: SYNCS() })
    await startSession($, w, { surface })
    const ui = await mountPane($, { surface, columns: NARROW })
    expect(await drawn(ui)).toContain('Bağlan')
    await ui.press({ key: 'open-ra' })
    await ui.input({ key: await composerKey(ui), text: 'Sekizde stadyumda.' })
    await w.clock.advance(5_000)
    const db = w.dbOf(ROOMS.alperen.url)
    expect(db.calls.some(c => ['set', 'batch'].includes(String(c.action)))).toBe(false)
    expect(await drawn(ui)).toContain('bağlantı bekleniyor')
    await ui.press({ key: 'connect-inline' })
    const connect = db.calls.find(c => c.action === 'set') as Record<string, unknown>
    expect(connect).toMatchObject({ collection: paths.heads, doc_id: ME, consent: 'The user pressed "Bağlan" on the Transceiver pane to send messages from this session.' })
    await w.clock.advance(1_000)
    const sent = [...db.docs.keys()].filter(k => k.startsWith(`${paths.msgs(ME)}/`))
    expect(sent).toHaveLength(1)
    expect(await drawn(ui)).not.toContain('bağlantı bekleniyor')
  })

  test(`${surface}: a refused "Bağlan" says so and keeps the card`, async ($: any, on: any) => {
    const w = paneWorld(on, { rooms: ALL, syncs: SYNCS() })
    for (const r of ALL) w.dbOf(r.url).isWriteDenied = true
    await startSession($, w, { surface })
    const ui = await mountPane($, { surface, columns: NARROW })
    await ui.press({ key: 'connect' })
    const tree = await drawn(ui)
    expect(tree).toContain('Onay verilmedi')
    expect(tree).toContain('Okumak serbest')
  })

  test(`${surface}: invites are accepted or refused, and the GitHub question is answered once`, async ($: any, on: any) => {
    const invited = room({ id: 'ri', status: 'invited', isOwner: false })
    const w = paneWorld(on, { rooms: [invited, room({ id: 'rx', status: 'invited' }), { ...ROOMS.eliti, peers: [] }], syncs: { re: projectEliti() } })
    await startSession($, w, { surface, isBypass: true })
    const ui = await mountPane($, { surface, columns: NARROW })
    await ui.press({ key: 'reject-rx' })
    await ui.press({ key: 'accept-ri' })
    expect((roomsIn(w)).map(r => [r.id, r.status])).toEqual([['ri', 'active'], ['rx', 'left'], ['re', 'active']])
    await ui.press({ key: 'back' })
    expect(await drawn(ui)).toContain('alperenx')
    await ui.press({ key: 'gh-no' })
    expect((roomsIn(w)).find(r => r.id === 're')?.peers).toEqual([{ uid: ALPEREN, gh: 'alperenx', isGhConfirmed: false }])
    expect(await drawn(ui)).not.toContain('GitHub\'da alperenx mi')
  })

  test(`${surface}: live mode is per project room and off until switched; receipts switch off from settings`, async ($: any, on: any) => {
    const w = paneWorld(on, { rooms: ALL, syncs: SYNCS() })
    await startSession($, w, { surface, isBypass: true })
    const ui = await mountPane($, { surface, columns: NARROW })
    await ui.press({ key: 'open-re' })
    expect((roomsIn(w)).find(r => r.id === 're')?.isLive).toBe(false)
    await ui.press({ key: 'live-re' })
    expect((roomsIn(w)).find(r => r.id === 're')?.isLive).toBe(true)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'open-settings' })
    await ui.press({ key: 'set-isReceiptsOn' })
    expect((w.store['tx.settings'] as { isReceiptsOn: boolean }).isReceiptsOn).toBe(false)
  })
}

test('a session started with permissions bypassed is connected: no card, writes go out', async ($: any, on: any) => {
  const w = paneWorld(on, { rooms: ALL, syncs: SYNCS() })
  await startSession($, w, { isBypass: true })
  const ui = await mountPane($, { surface: 'desktop', columns: NARROW })
  expect(await drawn(ui)).not.toContain('Okumak serbest')
  await ui.press({ key: 'open-ra' })
  await w.clock.advance(1_000)
  const head = w.dbOf(ROOMS.alperen.url).docs.get(`outbox/${ME}`)?.data as { readUpTo: string }
  expect(head.readUpTo).toBe(idAt(11))
})

test('/transceiver ayarlar opens the settings; a bad link or repo is answered in the pane', async ($: any, on: any) => {
  const w = paneWorld(on, { rooms: ALL, syncs: SYNCS() })
  await startSession($, w, { isBypass: true })
  await $.command.run({ command: 'transceiver', args: 'ayarlar' })
  const ui = await mountPane($, { surface: 'desktop', columns: NARROW })
  expect(await drawn(ui)).toContain('Okundu bilgisi')
  await ui.press({ key: 'back' })
  await ui.press({ key: 'open-add' })
  await ui.input({ key: 'join-link', text: 'https://example.com/x' })
  expect(await drawn(ui)).toContain('claude.ai/artifact/… biçiminde')
  await ui.press({ key: 'error-ok' })
  await ui.input({ key: 'add-repo', text: 'eliti' })
  expect(await drawn(ui)).toContain('sahip/repo biçiminde')
})
