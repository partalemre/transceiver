// Draws every state of the pane through the real plugin, for bin/preview: dark and light, a docked pane (narrow,
// 440 px) and a wide one (1120 px), desktop and terminal. Each test prints `@@TREE@@<label>@@<json>`; render.py
// makes the PNGs. The pane's root Box is as wide as the pane, so a PNG shows the true layout.
import { expect, test } from 'claude-code/testing'

import { localDay } from '../hooks/budget'
import type { RoomRecord } from '../hooks/rooms'
import type { RoomSync } from '../hooks/sync'
import { ALPEREN, dmAlperen, dmZeynep, idAt, NOW, projectEliti, room, ROOMS } from './pane-fixtures'
import { mountPane, paneWorld, startSession, type WorldOpts } from './pane-world'

// The test runner prints console output; the hooks environment's typings have no console.
declare const console: { log(text: string): void }

// 440 px and 1120 px at 8 px a cell, as the V2 boards.
const NARROW = 55
const WIDE = 140
const REMOTE = 'git@github.com:partalemre/eliti.git'
const ELSEWHERE = 'git@github.com:partalemre/other.git'

const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
// The project's .env query is left for the responder, so the gate really asks GitHub (the world's gh says yes).
const syncs = (o: { isPending?: boolean } = {}): Record<string, RoomSync> =>
  ({ ra: dmAlperen(o), re: projectEliti({ isDenied: false }), rz: dmZeynep() })
// A draft means the day's asks are spent: the budget says 10/10.
const DRAFT = { 'tx.budget': { day: localDay(NOW), byRoom: { re: 10 } }, 'tx.drafts': [{ roomId: 're', qid: idAt(2), question: 'Refresh token neden iki kez yazılıyor?', asker: ALPEREN }] }
// The diff Alperen's agent asked for: an exchange's key is its query's id.
const OPEN_DIFF = `open-tx-${idAt(18)}`
const EMPTY_TITLE = 'Arkadaşlarınla buradan yazış'
const EMPTY_BODY = 'Bir arkadaşını ekle; o kabul edince Claude\'dan çıkmadan yazışırsınız.'

// Engine 2.1.293 (the desktop app's) refuses a Button without a string label: the whole pane then goes undrawn.
type Node = { type?: string; props?: { label?: unknown }; children?: unknown[] }
function unlabeledButtons(node: unknown): string[] {
  if (node === null || typeof node !== 'object') return []
  const n = node as Node
  const kids = n.children ?? []
  const isBad = n.type === 'Button' && (typeof n.props?.label !== 'string' || kids.some(k => typeof k === 'object' && k !== null))
  return [...(isBad ? [JSON.stringify(n).slice(0, 120)] : []), ...kids.flatMap(unlabeledButtons)]
}

type Tree = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const nodes = (n: unknown): Tree[] => {
  if (n === null || typeof n !== 'object') return []
  const t = n as Tree
  return [t, ...(t.children ?? []).flatMap(nodes)]
}
const textOf = (n: Tree): string => (n.children ?? []).map(c => (typeof c === 'string' ? c : textOf(c as Tree))).join('')
// Words drawn inside any Svg: Svg takes the OS's colour scheme, not Claude's, so only a face's initials may be there.
const MAX_SVG_WORD = 2
function svgWords(tree: unknown): string[] {
  const sources = nodes(tree).filter(n => n.type === 'Svg').map(n => String(n.props?.source ?? ''))
  const words = sources.flatMap(src => [...src.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => (m[1] ?? '').replace(/<[^>]+>/g, '').trim()))
  return words.filter(w => w.length > MAX_SVG_WORD)
}
// Each reading text is a native Text element's own words.
const isInText = (tree: unknown, text: string): boolean => nodes(tree).some(n => n.type === 'Text' && textOf(n).includes(text))

type Shot = {
  label: string
  rooms?: RoomRecord[]
  syncs?: Record<string, RoomSync>
  isBypass?: boolean
  presses?: string[]
  columns?: number
  remote?: string
  artifact?: WorldOpts['artifact']
  extra?: WorldOpts['extra']
  // A text the drawing must hold, and one it must not: what a screen keeps out of the default view.
  sees: string
  hides?: string
  // Titles and sentences that must be native Text, which the host draws in Claude's theme.
  texts?: string[]
}

const SHOTS: Shot[] = [
  { label: 'rooms', isBypass: true, sees: 'Sohbetler', hides: 'yoklama', texts: ['Sohbetler', 'Teşekkürler, okudum, çok iyi olmuş.'] },
  { label: 'empty', rooms: [], syncs: {}, isBypass: true, sees: 'Proje odası', hides: 'join-link', texts: [EMPTY_TITLE, EMPTY_BODY] },
  { label: 'empty-join', rooms: [], syncs: {}, isBypass: true, presses: ['open-join'], sees: 'join-link' },
  { label: 'empty-project', rooms: [], syncs: {}, isBypass: true, presses: ['open-project'], sees: 'partalemre/eliti' },
  { label: 'connect', syncs: syncs({ isPending: true }), sees: 'bu oturumda bir kez izin ver', texts: ['Yazdıkların bekliyor; göndermek için bu oturumda bir kez izin ver.'] },
  { label: 'invite', rooms: [ROOMS.alperen, room({ id: 'ri', status: 'invited' }), { ...ROOMS.eliti, peers: [] }], isBypass: true, sees: 'seninle yazışmak' },
  { label: 'dm', isBypass: true, presses: ['open-ra'], sees: '2 yeni mesaj', hides: 'okundu bilgisi açık' },
  { label: 'dm-waiting', syncs: syncs({ isPending: true }), presses: ['connect-later', 'open-ra'], sees: 'bağlantı bekleniyor' },
  { label: 'project', isBypass: true, presses: ['open-re'], sees: 'diff sordu · cevaplandı · 0 token', hides: 'Bu oturumun reposu' },
  { label: 'project-open', isBypass: true, presses: ['open-re', OPEN_DIFF], sees: 'makine' },
  { label: 'project-info', isBypass: true, presses: ['open-re', 'info-re'], sees: 'Bu oturumun reposu' },
  { label: 'project-closed', isBypass: true, remote: ELSEWHERE, presses: ['open-re'], sees: 'Agent\'lar kapalı' },
  { label: 'project-draft', isBypass: true, presses: ['open-re'], extra: DRAFT, sees: 'onayını bekliyor' },
  { label: 'project-sheet', isBypass: true, presses: ['open-re', 'ask-more-re'], sees: 'sheet-grep' },
  { label: 'project-mode', isBypass: true, presses: ['open-re', 'ask-more-re', 'sheet-grep'], sees: 'Aranacak metin' },
  { label: 'error', isBypass: true, presses: ['open-add', 'add-dm'], artifact: () => ({ deny: 'not now' }), sees: 'Oda açılamadı' },
  { label: 'created', isBypass: true, presses: ['open-add', 'add-dm'], sees: 'Linki kopyala', texts: ['Kutun hazır.', 'https://claude.ai/artifact/NEWROOM1x'] },
  { label: 'add', isBypass: true, presses: ['open-add'], sees: 'Linkim var' },
  { label: 'settings', presses: ['open-settings'], sees: 'Nasıl paylaşılır' },
  { label: 'wide', isBypass: true, presses: ['open-ra'], columns: WIDE, sees: 'Gelirim! Saat kaçta?' },
  { label: 'wide-project', isBypass: true, presses: ['open-re'], columns: WIDE, sees: 'diff sordu', hides: 'Bu oturumun reposu' },
  { label: 'wide-project-info', isBypass: true, presses: ['open-re', 'info-re'], columns: WIDE, extra: DRAFT, sees: 'Bu oturumun reposu' },
  { label: 'wide-empty', rooms: [], syncs: {}, columns: WIDE, sees: 'Arkadaşlarınla buradan yazış' },
  { label: 'wide-rooms', isBypass: true, columns: WIDE, sees: 'Bir sohbet seç' },
]

for (const isLight of [false, true]) {
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const s of SHOTS) {
      const label = `${s.label}${surface === 'terminal' ? '-terminal' : ''}${isLight ? '-light' : ''}`
      test(`preview: ${label}`, async ($: any, on: any) => {
        const world = paneWorld(on, { rooms: s.rooms ?? ALL, syncs: s.syncs ?? syncs(), isLight, artifact: s.artifact, extra: s.extra, remote: s.remote ?? REMOTE })
        await startSession($, world, { isBypass: s.isBypass, surface })
        const ui = await mountPane($, { surface, columns: s.columns ?? NARROW })
        for (const key of s.presses ?? []) await ui.press({ key })
        await world.clock.settle()
        const tree = JSON.stringify(await ui.drawn())
        console.log(`@@TREE@@${label}@@${tree}`)
        expect(tree.includes(s.sees)).toBe(true)
        if (s.hides !== undefined) expect(tree.includes(s.hides)).toBe(false)
        expect(unlabeledButtons(JSON.parse(tree))).toEqual([])
        expect(svgWords(JSON.parse(tree))).toEqual([])
        for (const text of s.texts ?? []) expect(isInText(JSON.parse(tree), text)).toBe(true)
        await ui.unmount()
      })
    }
  }
}
