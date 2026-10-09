// The pane's default views say one thing each and keep the rest one press away, on the terminal and the desktop:
// a project room hides its gate and budget while all is well and explains in one line when not; an agent exchange
// is one line that opens on press; the empty state's link field and project room appear on request, the project
// room only inside a GitHub repo; "Bağlan" and "Şimdi değil"; the rooms list heads its kinds only when mixed.
import { expect, test } from 'claude-code/testing'

import { localDay } from '../hooks/budget'
import { ASK_DAILY_LIMIT } from '../hooks/limits'
import { paths } from '../hooks/protocol'
import type { RoomRecord } from '../hooks/rooms'
import { dmAlperen, dmZeynep, idAt, ME, NOW, projectEliti, ROOMS } from './pane-fixtures'
import { mountPane, paneWorld, startSession, type WorldOpts } from './pane-world'

const SURFACES = ['terminal', 'desktop'] as const
const NARROW = 55
const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
const GITHUB = 'git@github.com:partalemre/eliti.git'
const ELSEWHERE = 'git@github.com:partalemre/other.git'
// The .env query is left for the responder, so the gate really asks GitHub (the world's gh says yes).
const SYNCS = () => ({ ra: dmAlperen(), re: projectEliti({ isDenied: false }), rz: dmZeynep() })
const DIFF = idAt(18)
const ENV = idAt(9)

type Surface = (typeof SURFACES)[number]
type Open = { surface: Surface; isBypass?: boolean } & WorldOpts

const drawn = async (ui: any): Promise<string> => JSON.stringify(await ui.drawn())
const buttons = async (ui: any, key: string): Promise<number> => (await ui.findAll({ type: 'Button', key })).length
const inputs = async (ui: any, key: string): Promise<number> => (await ui.findAll({ type: 'Input', key })).length

async function open($: any, on: any, o: Open) {
  const w = paneWorld(on, { rooms: ALL, syncs: SYNCS(), remote: GITHUB, ...o })
  await startSession($, w, { surface: o.surface, isBypass: o.isBypass ?? true })
  const ui = await mountPane($, { surface: o.surface, columns: NARROW })
  return { w, ui }
}

for (const surface of SURFACES) {
  test(`${surface}: an open gate and a spare budget stay out of the project room; its details are one press away`, async ($: any, on: any) => {
    const { ui } = await open($, on, { surface })
    await ui.press({ key: 'open-re' })
    const tree = await drawn(ui)
    for (const hidden of ['Kapı açık', 'Ask bütçesi', 'Agent\'lar kapalı', 'Bu oturumun reposu']) expect(tree).not.toContain(hidden)
    expect(await buttons(ui, 'why-re')).toBe(0)
    expect(await buttons(ui, 'live-re')).toBe(0)
    await ui.press({ key: 'info-re' })
    const info = await drawn(ui)
    expect(info).toContain('Kapı açık · 4/4')
    expect(await buttons(ui, 'live-re')).toBe(1)
    await ui.press({ key: 'info-re' })
    expect(await drawn(ui)).not.toContain('Kapı açık')
  })

  test(`${surface}: a closed gate is one line saying why, and "Neden?" opens the checks`, async ($: any, on: any) => {
    const { ui } = await open($, on, { surface, remote: ELSEWHERE })
    await ui.press({ key: 'open-re' })
    const tree = await drawn(ui)
    expect(tree).toContain('Agent\'lar kapalı: bu oturum başka bir repoda.')
    expect(tree).not.toContain('Bu oturumun reposu')
    await ui.press({ key: 'why-re' })
    expect(await drawn(ui)).toContain('Bu oturumun reposu')
    expect(await buttons(ui, 'why-re')).toBe(0)
  })

  test(`${surface}: a spent day's budget is the project room's one line`, async ($: any, on: any) => {
    const { ui } = await open($, on, { surface, extra: { 'tx.budget': { day: localDay(NOW), byRoom: { re: ASK_DAILY_LIMIT } } } })
    await ui.press({ key: 'open-re' })
    expect(await drawn(ui)).toContain(`Agent'ının bugünkü ${ASK_DAILY_LIMIT} cevap hakkı doldu`)
  })

  test(`${surface}: a member's unshared mailbox is the DM's one line, and its row says so`, async ($: any, on: any) => {
    const peerBox = 'https://claude.ai/artifact/PEERx'
    const rooms: RoomRecord[] = [{ ...ROOMS.alperen, boxes: [peerBox] }, ROOMS.eliti, ROOMS.zeynep]
    const { w, ui } = await open($, on, { surface, rooms })
    w.dbOf(peerBox).isDown = true
    await w.clock.advance(5_000)
    expect(await drawn(ui)).toContain('kutusu henüz seninle paylaşılmadı')
    await ui.press({ key: 'open-ra' })
    expect(await drawn(ui)).toContain('Alperen kutusunu henüz seninle paylaşmadı')
  })

  test(`${surface}: an agent exchange is one line until pressed; a refusal stays a line with nothing behind it`, async ($: any, on: any) => {
    const { w, ui } = await open($, on, { surface, syncs: { ...SYNCS(), re: projectEliti() } })
    await ui.press({ key: 'open-re' })
    const before = await drawn(ui)
    expect(before).toContain('Alperen\'in agent\'ı diff sordu · cevaplandı · 0 token')
    expect(before).toContain('Alperen\'in agent\'ı .env istedi · erişim yok')
    expect(before).not.toContain('makine')
    expect(await buttons(ui, `open-tx-${ENV}`)).toBe(0)
    await ui.press({ key: `open-tx-${DIFF}` })
    await w.clock.settle()
    expect(await drawn(ui)).toContain('makine')
    await ui.press({ key: `open-tx-${DIFF}` })
    expect(await drawn(ui)).not.toContain('makine')
  })

  test(`${surface}: "Linkim var" opens the link field in place and "Vazgeç" closes it`, async ($: any, on: any) => {
    const { ui } = await open($, on, { surface, rooms: [], syncs: {} })
    expect(await inputs(ui, 'join-link')).toBe(0)
    await ui.press({ key: 'open-join' })
    expect(await inputs(ui, 'join-link')).toBe(1)
    await ui.input({ key: 'join-link', text: 'https://example.com/x' })
    expect(await drawn(ui)).toContain('claude.ai/artifact/… biçiminde')
    await ui.press({ key: 'open-join' })
    expect(await inputs(ui, 'join-link')).toBe(0)
  })

  for (const remote of [GITHUB, 'git@gitlab.com:someone/thing.git', undefined]) {
    const where = remote === GITHUB ? 'inside a GitHub repo' : `outside one (${remote ?? 'no remote'})`
    test(`${surface}: "Proje odası" is on the empty state ${where} only as the repo allows`, async ($: any, on: any) => {
      const { ui } = await open($, on, { surface, rooms: [], syncs: {}, remote })
      expect(await buttons(ui, 'add-dm')).toBe(1)
      expect(await buttons(ui, 'open-project')).toBe(remote === GITHUB ? 1 : 0)
    })
  }

  test(`${surface}: "Şimdi değil" puts the card away and the foot says the session waits; "Bağlan" connects`, async ($: any, on: any) => {
    const { w, ui } = await open($, on, { surface, isBypass: false })
    const card = await drawn(ui)
    expect(card).toContain('Yazmak için bu oturumda bir kez izin ver.')
    expect(card).not.toContain('bağlantı bekleniyor')
    await ui.press({ key: 'connect-later' })
    const later = await drawn(ui)
    expect(later).not.toContain('bir kez izin ver')
    expect(later).toContain('bağlantı bekleniyor')
    await ui.press({ key: 'open-settings' })
    await ui.press({ key: 'connect-settings' })
    const set = w.dbOf(ROOMS.alperen.url).calls.find(c => c.action === 'set') ?? w.dbOf(ROOMS.eliti.url).calls.find(c => c.action === 'set')
    expect(set).toMatchObject({ collection: paths.heads, doc_id: ME })
    await ui.press({ key: 'back' })
    expect(await drawn(ui)).not.toContain('bağlantı bekleniyor')
  })

  test(`${surface}: the rooms list heads its kinds when both are there, and says nothing of a healthy link`, async ($: any, on: any) => {
    const { ui } = await open($, on, { surface })
    const tree = await drawn(ui)
    expect(tree.toLocaleLowerCase('tr')).toContain('projeler')
    expect(tree).not.toContain('yoklama')
    expect(tree).not.toContain('bağlantı bekleniyor')
  })

  test(`${surface}: a list of one kind is one plain list`, async ($: any, on: any) => {
    const { ui } = await open($, on, { surface, rooms: [ROOMS.alperen, ROOMS.zeynep] })
    const list = await drawn(ui)
    expect(list.toLocaleLowerCase('tr')).not.toContain('projeler')
    expect(list.toLocaleLowerCase('tr')).not.toContain('kişiler')
    expect(list).toContain('Zeynep')
  })
}
