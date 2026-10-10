// The pane in English, the default with no MODZ_LANG: every screen on the desktop and in the terminal says the
// film's words, and no word of the interface itself is Turkish (the people's own messages and names may be).
import { expect, test } from 'claude-code/testing'

import { localDay } from '../hooks/budget'
import type { RoomRecord } from '../hooks/rooms'
import type { RoomSync } from '../hooks/sync'
import { ALPEREN, dmAlperen, dmZeynep, idAt, NAMES, NOW, projectEliti, room, ROOMS } from './pane-fixtures'
import { mountPane, paneWorld, startSession, type WorldOpts } from './pane-world'

const NARROW = 55
const WIDE = 140
const REMOTE = 'git@github.com:partalemre/eliti.git'
const ELSEWHERE = 'git@github.com:partalemre/other.git'
const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
const syncs = (o: { isPending?: boolean } = {}): Record<string, RoomSync> =>
  ({ ra: dmAlperen(o), re: projectEliti({ isDenied: false }), rz: dmZeynep() })
const DRAFT = { 'tx.budget': { day: localDay(NOW), byRoom: { re: 10 } }, 'tx.drafts': [{ roomId: 're', qid: idAt(2), question: 'Why is the refresh token written twice?', asker: ALPEREN }] }
const OPEN_DIFF = `open-tx-${idAt(18)}`
const TURKISH = /[çğıöşüİ]/

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
  // What both surfaces say, then what only the desktop or only the terminal says.
  sees: string[]
  desk?: string[]
  term?: string[]
}

const SHOTS: Shot[] = [
  { label: 'rooms', isBypass: true, sees: ['Chats', '+ New', 'PROJECTS', 'PEOPLE', 'Settings'] },
  { label: 'empty', rooms: [], syncs: {}, isBypass: true, sees: ['Message your friends from here', 'Add a friend', 'I have a link'], desk: ['Project room'] },
  { label: 'connect', syncs: syncs({ isPending: true }), sees: ['Your messages are waiting. Allow this session once to send them.', 'Connect', 'Not now'] },
  { label: 'invite', rooms: [ROOMS.alperen, room({ id: 'ri', status: 'invited' }), { ...ROOMS.eliti, peers: [] }], isBypass: true, sees: ['Someone wants to message you', 'Accept', 'Decline'] },
  { label: 'dm', isBypass: true, presses: ['open-ra'], sees: ['2 new messages', 'here · read 1m ago'], desk: ['Message Alperen...', 'Send', 'TODAY'], term: ['today', '‹ rooms'] },
  { label: 'dm-waiting', syncs: syncs({ isPending: true }), presses: ['connect-later', 'open-ra'], sees: ['waiting for connection'] },
  {
    label: 'project', isBypass: true, presses: ['open-re'],
    sees: ['Project room · you and Alperen', 'Alperen\'s agent asked · diff · answered · 0 tokens', 'Alperen\'s agent wanted .env · no access'],
    desk: ['View diff', 'ask Alperen\'s agent', 'Message the room...', 'Details'], term: ['view diff', 'details'],
  },
  { label: 'project-open', isBypass: true, presses: ['open-re', OPEN_DIFF], sees: ['3 files +41 -12'], desk: ['Answered on this machine', ' · 0 tokens', ' · 0.4s', 'Hide'], term: ['answered on this machine'] },
  { label: 'project-info', isBypass: true, presses: ['open-re', 'info-re'], sees: ['This session\'s repo', 'Ask budget 0/10 today', 'Live mode off', 'Turn on'] },
  { label: 'project-closed', isBypass: true, remote: ELSEWHERE, presses: ['open-re'], sees: ['Agents are off: this session is in another repo.'] },
  { label: 'project-draft', isBypass: true, presses: ['open-re'], extra: DRAFT, sees: ['Alperen\'s agent is asking · waiting for your approval', 'Send', 'Cancel'] },
  { label: 'project-sheet', isBypass: true, presses: ['open-re', 'ask-more-re'], sees: ['Search text in the repo', 'Uncommitted changes'], desk: ['Ask Alperen\'s agent', '12 ready queries · 0 tokens', '10 a day'] },
  { label: 'project-mode', isBypass: true, presses: ['open-re', 'ask-more-re', 'sheet-grep'], sees: ['Text to find'] },
  { label: 'error', isBypass: true, presses: ['open-add', 'add-dm'], artifact: () => ({ deny: 'not now' }), sees: ['The room could not be opened. Check the claude.ai connection and try again.'] },
  { label: 'created', isBypass: true, presses: ['open-add', 'add-dm'], sees: ['Your mailbox is ready.', 'Copy link', 'Done'] },
  { label: 'add', isBypass: true, presses: ['open-add'], sees: ['New chat', 'Add a friend', 'Project room', 'owner/repo', 'I have a link', 'Join', '‹ Rooms'] },
  { label: 'settings', presses: ['open-settings'], sees: ['Settings', 'Read receipts', 'Notifications', 'Status line', 'This session', 'How sharing works'] },
  { label: 'wide-rooms', isBypass: true, columns: WIDE, sees: ['Pick a chat', 'Open a room from the list on the left.'] },
]

// The people's own words, from the fixtures: a drawn word that is (the start of) one of them is theirs.
const fixtureWords = (data: unknown): string[] => {
  if (typeof data === 'string') return data.split(/[\s,.;:!?()"'…·]+/).filter(w => w !== '')
  if (Array.isArray(data)) return data.flatMap(fixtureWords)
  return data !== null && typeof data === 'object' ? Object.values(data).flatMap(fixtureWords) : []
}

type Tree = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const nodes = (n: unknown): Tree[] => {
  if (n === null || typeof n !== 'object') return []
  const t = n as Tree
  return [t, ...(t.children ?? []).flatMap(nodes)]
}
// Every word the interface draws as words: text, button labels, placeholders, submit labels.
function drawnTexts(tree: unknown): string[] {
  return nodes(tree).flatMap(n => [
    ...(n.children ?? []).filter((c): c is string => typeof c === 'string'),
    ...['label', 'placeholder', 'submitLabel'].map(k => n.props?.[k]).filter((v): v is string => typeof v === 'string'),
  ])
}

function turkishWords(tree: unknown, theirs: readonly string[]): string[] {
  const words = drawnTexts(tree).flatMap(t => t.split(/[\s,.;:!?()"'…·]+/))
  return words.filter(w => TURKISH.test(w) && !theirs.some(f => f.startsWith(w.replace(/…$/, ''))))
}

for (const surface of ['desktop', 'terminal'] as const) {
  for (const s of SHOTS) {
    test(`english ${surface}: ${s.label}`, async ($: any, on: any) => {
      const o = { rooms: s.rooms ?? ALL, syncs: s.syncs ?? syncs(), artifact: s.artifact, extra: s.extra, remote: s.remote ?? REMOTE }
      const world = paneWorld(on, { ...o, isEnglish: true })
      await startSession($, world, { isBypass: s.isBypass, surface })
      const ui = await mountPane($, { surface, columns: s.columns ?? NARROW })
      for (const key of s.presses ?? []) await ui.press({ key })
      await world.clock.settle()
      const drawn = await ui.drawn()
      const tree = JSON.stringify(drawn)
      for (const text of [...s.sees, ...((surface === 'desktop' ? s.desk : s.term) ?? [])]) expect([text, tree.includes(text)]).toEqual([text, true])
      expect(turkishWords(drawn, fixtureWords([o.rooms, o.syncs, o.extra ?? {}, NAMES]))).toEqual([])
      await ui.unmount()
    })
  }
}
