# Phase 3 · Pane

The pane matches the design canvas (https://claude.ai/artifact/QJAYV1gwXXsEhX9cYopTU8): the "DM · masaüstü pane", "Proje odası", "Terminal pane" and "Davet ve kapı durumları" boards. On both terminal and desktop it is drawn from `Box`, `Text`, `Button` and `Input`, with hex colors from `hooks/theme.ts`. On mobile there is no `Input`, so the pane is read-only there and shows a note pointing to the room's web page.

### Task 8: Pane model, actions, and drawing

**Files:**
- Create: `hooks/theme.ts`, `hooks/state.ts`, `hooks/view.ts`, `hooks/actions.ts`, `hooks/pane.tsx`, `hooks/pane-list.tsx`, `hooks/pane-chat.tsx`, `hooks/pane-cards.tsx`
- Modify: `hooks/room-loop.ts` (time each tick), `hooks/register.tsx`
- Test: `tests/view.test.ts`, `tests/pane.test.tsx`

**Interfaces:**
- Consumes: `PaneModel`, `EMPTY_PANE`, `Line`, `RoomView` (T1). `RoomSync` (T5). `receiptOf`, `unreadCount` (T5). `RoomRecord`, `Settings`, `loadRooms`, `saveRooms`, `loadSettings`, `saveSettings` (T6). `pokeRoom`, `onTick`, `setViewing`, `syncOf`, `putSync` (T6). `enqueue` (T5). `newId` (T2). `relayOf`, `callerOf` (T4). `resolveLight` from `hooks/kit/tokens` (T1).
- Produces:
  - `paneAtom`, `refreshPane($)` (`state.ts`)
  - `buildModel(opts)` (`view.ts`, pure)
  - `colors(isLight)` (`theme.ts`)
  - actions: `sendText`, `selectRoom`, `acceptInvite`, `rejectInvite`, `confirmGh`, `connectSession`, `toggleLive`, `approveDraft`, `dropDraft`
  - `wirePane(on)`

- [ ] **Step 1: Theme tokens from the canvas**

`hooks/theme.ts`:
```ts
export type Colors = {
  signal: string; mineBg: string; mineLine: string; peerBg: string; line: string
  fg: string; mid: string; lo: string; agent: string; read: string; ok: string; warn: string; danger: string
}

const DARK: Colors = {
  signal: '#5CC8B8', mineBg: '#1A2E2B', mineLine: '#2E5650', peerBg: '#1F1F1C', line: '#2E2E2A',
  fg: '#F0EEE8', mid: '#C2BEB4', lo: '#8E8A80', agent: '#B19CF3', read: '#7FB6E8', ok: '#6FC593', warn: '#E9B949', danger: '#F2727F',
}

const LIGHT: Colors = {
  signal: '#0E6F66', mineBg: '#E3F3F0', mineLine: '#A9D8CF', peerBg: '#FFFFFF', line: '#E4E0D6',
  fg: '#1C1B19', mid: '#4F4B44', lo: '#77726A', agent: '#6243C4', read: '#2464A0', ok: '#1F6E43', warn: '#8A6000', danger: '#C0263A',
}

export const colors = (isLight: boolean): Colors => (isLight ? LIGHT : DARK)
```

- [ ] **Step 2: Failing model test**

`tests/view.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { emptyHead } from '../hooks/protocol'
import type { RoomRecord } from '../hooks/rooms'
import { initialSync } from '../hooks/sync'
import { buildModel } from '../hooks/view'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const A = '01K7A0000000000000000000A1'
const B = '01K7A0000000000000000000A2'
const room: RoomRecord = {
  id: 'r1', url: 'https://claude.ai/artifact/r1', kind: 'dm', title: 'Transceiver · DM', status: 'active',
  isLive: false, isOwner: true, peers: [{ uid: PEER, isGhConfirmed: false }], joinedAt: 0,
}

test('rooms list unread and last text; the active room shows lines with names and receipts', () => {
  const sync = {
    ...initialSync(ME),
    peers: { [PEER]: { ...emptyHead(), seenUpTo: B } },
    entries: [
      { author: PEER, message: { v: 1 as const, id: A, ts: 1, kind: 'human' as const, text: 'selam' } },
      { author: ME, message: { v: 1 as const, id: B, ts: 2, kind: 'human' as const, text: 'naber' } },
    ],
  }
  const model = buildModel({
    rooms: [room], syncs: { r1: sync }, activeId: 'r1', names: { [PEER]: 'Alperen' },
    settings: { isReceiptsOn: true, isToastOn: true, isStatusOn: true }, latencyMs: 900,
  })
  expect(model.rooms[0].title).toBe('Alperen')
  expect(model.rooms[0].unread).toBe(1)
  expect(model.rooms[0].lastText).toBe('naber')
  expect(model.lines.map(l => [l.authorName, l.receipt])).toEqual([['Alperen', undefined], ['sen', 'delivered']])
})

test('invited rooms become invites, not rooms', () => {
  const model = buildModel({
    rooms: [{ ...room, status: 'invited' }], syncs: {}, activeId: null, names: {},
    settings: { isReceiptsOn: true, isToastOn: true, isStatusOn: true }, latencyMs: null,
  })
  expect(model.rooms.length).toBe(0)
  expect(model.invites).toEqual([{ id: 'r1', title: 'Transceiver · DM' }])
})

test('an unconfirmed GitHub login a peer published raises the confirm card', () => {
  const sync = { ...initialSync(ME), peers: { [PEER]: { ...emptyHead(), gh: 'alperenx' } } }
  const model = buildModel({
    rooms: [room], syncs: { r1: sync }, activeId: 'r1', names: { [PEER]: 'Alperen' },
    settings: { isReceiptsOn: true, isToastOn: true, isStatusOn: true }, latencyMs: null,
  })
  expect(model.ghAsk).toEqual({ roomId: 'r1', uid: PEER, gh: 'alperenx', name: 'Alperen' })
})
```

- [ ] **Step 3: Implement `hooks/view.ts`**

```ts
import { isUnreadable } from './protocol'
import type { RoomRecord, Settings } from './rooms'
import type { GhAsk, Line, PaneModel, RoomView } from './state-types'
import { EMPTY_PANE } from './state-types'
import type { RoomSync } from './sync'
import { receiptOf, unreadCount } from './timeline'

const SELF_NAME = 'sen'
const SOMEONE = 'Biri'
const PREVIEW_CHARS = 80

export type ModelInput = {
  rooms: RoomRecord[]
  syncs: Record<string, RoomSync>
  activeId: string | null
  names: Record<string, string>
  settings: Settings
  latencyMs: number | null
}

const nameOf = (names: Record<string, string>, uid: string) => names[uid] || SOMEONE

function roomTitle(room: RoomRecord, names: Record<string, string>): string {
  if (room.kind === 'project') return room.repo ?? room.title
  const peer = room.peers[0]
  return peer === undefined ? 'Davet bekleniyor' : nameOf(names, peer.uid)
}

function roomView(room: RoomRecord, sync: RoomSync | undefined, names: Record<string, string>): RoomView {
  const last = sync?.entries.at(-1)?.message
  const lastText = last === undefined || isUnreadable(last) ? '' : last.text.slice(0, PREVIEW_CHARS)
  return {
    id: room.id, title: roomTitle(room, names), kind: room.kind, isLive: room.isLive, gate: 'unknown',
    unread: sync === undefined ? 0 : unreadCount({ entries: sync.entries, selfUid: sync.selfUid, readUpTo: sync.ownHead.readUpTo }),
    lastText, lastTs: last === undefined || isUnreadable(last) ? 0 : last.ts,
  }
}

function linesOf(sync: RoomSync, names: Record<string, string>, isReceiptsOn: boolean): Line[] {
  const peers = Object.values(sync.peers)
  return sync.entries.map(entry => {
    const isMine = entry.author === sync.selfUid
    return {
      id: entry.message.id, message: entry.message, isMine,
      authorName: isMine ? SELF_NAME : nameOf(names, entry.author),
      receipt: isMine ? receiptOf({ entry, selfUid: sync.selfUid, peers, isReceiptsOn }) : undefined,
    }
  })
}

function ghAskOf(input: ModelInput): GhAsk | null {
  for (const room of input.rooms) {
    const sync = input.syncs[room.id]
    if (room.status !== 'active' || sync === undefined) continue
    for (const [uid, head] of Object.entries(sync.peers)) {
      const peer = room.peers.find(p => p.uid === uid)
      if (head.gh !== undefined && !(peer?.isGhConfirmed === true && peer.gh === head.gh)) {
        return { roomId: room.id, uid, gh: head.gh, name: nameOf(input.names, uid) }
      }
    }
  }
  return null
}

export function buildModel(input: ModelInput): PaneModel {
  const active = input.rooms.filter(r => r.status === 'active')
  const rooms = active.map(r => roomView(r, input.syncs[r.id], input.names)).sort((a, b) => b.lastTs - a.lastTs)
  const activeId = input.activeId ?? rooms[0]?.id ?? null
  const sync = activeId === null ? undefined : input.syncs[activeId]
  return {
    ...EMPTY_PANE,
    rooms, activeId, latencyMs: input.latencyMs, isReceiptsOn: input.settings.isReceiptsOn,
    lines: sync === undefined ? [] : linesOf(sync, input.names, input.settings.isReceiptsOn),
    invites: input.rooms.filter(r => r.status === 'invited').map(r => ({ id: r.id, title: r.title })),
    ghAsk: ghAskOf(input),
  }
}
```

- [ ] **Step 4: State, refresh and names (`hooks/state.ts`)**

```ts
import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { syncOf } from './room-loop'
import { loadRooms, loadSettings } from './rooms'
import { EMPTY_PANE } from './state-types'
import type { Draft } from './state-types'
import type { RoomSync } from './sync'
import { buildModel } from './view'

export const paneAtom = atom({ plugin: 'transceiver', key: 'pane' } as const, EMPTY_PANE)

const names: Record<string, string> = {}
const ui = { activeId: null as string | null, latencyMs: null as number | null, drafts: [] as Draft[], needsSetup: false, error: null as string | null }

export const setActive = (id: string | null) => { ui.activeId = id }
export const setLatency = (ms: number) => { ui.latencyMs = ms }
export const setDrafts = (drafts: Draft[]) => { ui.drafts = drafts }
export const draftsNow = () => ui.drafts
export const setNeedsSetup = (is: boolean) => { ui.needsSetup = is }
export const setError = (text: string | null) => { ui.error = text }

// Names come from the artifact's own profile lookup, are never stored, and are re-asked once per session per uid.
async function resolveNames($: EngineInterface, url: string, uids: string[]): Promise<void> {
  const missing = uids.filter(u => names[u] === undefined)
  if (missing.length === 0) return
  const out = (await $.tool.call({ tool: 'ArtifactData', action: 'profiles', url, ids: missing } as never)) as { text?: string }
  for (const uid of missing) {
    const match = new RegExp(`${uid}[^\\n]*?name[^"\\n]*"([^"\\n]{1,80})"`).exec(out.text ?? '')
    names[uid] = match?.[1] ?? ''
  }
}

export async function refreshPane($: EngineInterface): Promise<void> {
  const rooms = await loadRooms($)
  const syncs: Record<string, RoomSync> = {}
  for (const room of rooms) {
    const sync = syncOf(room.id)
    if (sync === undefined) continue
    syncs[room.id] = sync
    await resolveNames($, room.url, [...Object.keys(sync.peers)]).catch(() => undefined)
  }
  const model = buildModel({ rooms, syncs, activeId: ui.activeId, names, settings: await loadSettings($), latencyMs: ui.latencyMs })
  await update($, paneAtom, () => ({ ...model, drafts: ui.drafts, needsSetup: ui.needsSetup, error: ui.error }))
}
```

T0 confirms the `profiles` text shape. If names come back in a different layout, change only the regex in `resolveNames`. Add a test with the observed text to `tests/view.test.ts`.

- [ ] **Step 5: Actions (`hooks/actions.ts`)**

```ts
import type { EngineInterface } from 'claude-code'

import { MAX_TEXT_BYTES } from './limits'
import { isRepo, utf8Bytes, type Message } from './protocol'
import { pokeRoom, putSync, setViewing, syncOf } from './room-loop'
import { loadRooms, saveRooms, type RoomRecord } from './rooms'
import { callerOf, relayOf } from './relay'
import { draftsNow, refreshPane, setActive, setDrafts, setError, setNeedsSetup } from './state'
import { enqueue } from './sync'
import { newId } from './ulid'

const ASK_PREFIX = '/ask '

async function roomById($: EngineInterface, id: string): Promise<RoomRecord | undefined> {
  return (await loadRooms($)).find(r => r.id === id)
}

async function patchRoom($: EngineInterface, id: string, patch: Partial<RoomRecord>): Promise<void> {
  await saveRooms($, (await loadRooms($)).map(r => (r.id === id ? { ...r, ...patch } : r)))
}

function messageOf(opts: { text: string; now: number; room: RoomRecord }): Message | string {
  const id = newId(opts.now)
  const isAsk = opts.text.startsWith(ASK_PREFIX)
  if (!isAsk) return { v: 1, id, ts: opts.now, kind: 'human', text: opts.text }
  if (opts.room.kind !== 'project' || !isRepo(opts.room.repo)) return '/ask yalnızca proje odalarında çalışır.'
  const question = opts.text.slice(ASK_PREFIX.length).trim()
  return { v: 1, id, ts: opts.now, kind: 'query', text: question, query: { type: 'ask', repo: opts.room.repo, question } }
}

export async function sendText($: EngineInterface, opts: { roomId: string; text: string }): Promise<void> {
  const text = opts.text.trim()
  const room = await roomById($, opts.roomId)
  const sync = syncOf(opts.roomId)
  if (text === '' || room === undefined || sync === undefined) return
  if (utf8Bytes(text) > MAX_TEXT_BYTES) return void setError('Mesaj çok uzun (en fazla 16 KB).')
  const message = messageOf({ text, now: await $.clock.now(), room })
  if (typeof message === 'string') return void setError(message)
  setError(null)
  putSync(room.id, enqueue(sync, message))
  pokeRoom($, room)
  await refreshPane($)
}

export async function selectRoom($: EngineInterface, id: string): Promise<void> {
  setActive(id)
  setViewing(id, true)
  const room = await roomById($, id)
  if (room !== undefined) pokeRoom($, room)
  await refreshPane($)
}

export async function acceptInvite($: EngineInterface, id: string): Promise<void> {
  await patchRoom($, id, { status: 'active' })
  const room = await roomById($, id)
  if (room !== undefined) pokeRoom($, room)
  await selectRoom($, id)
}

export async function rejectInvite($: EngineInterface, id: string): Promise<void> {
  await patchRoom($, id, { status: 'left' })
  await refreshPane($)
}

export async function confirmGh($: EngineInterface, opts: { roomId: string; uid: string; gh: string; isYes: boolean }): Promise<void> {
  const room = await roomById($, opts.roomId)
  if (room === undefined) return
  const others = room.peers.filter(p => p.uid !== opts.uid)
  const peer = opts.isYes ? { uid: opts.uid, gh: opts.gh, isGhConfirmed: true } : { uid: opts.uid, isGhConfirmed: false }
  await patchRoom($, room.id, { peers: [...others, peer] })
  await refreshPane($)
}

const CONNECT_CONSENT = 'The user pressed "Bağlan" on the Transceiver pane to send messages from this session.'

// The first artifact write of a session needs the person's approval (spike R1). It is raised here, by their press,
// as a no-op rewrite of their own head in one active room; every later write in the session passes without asking.
export async function connectSession($: EngineInterface): Promise<void> {
  const room = (await loadRooms($)).find(r => r.status === 'active')
  const sync = room === undefined ? undefined : syncOf(room.id)
  if (room === undefined || sync === undefined) return
  try {
    const head = sync.ownHead
    const version = await relayOf(callerOf($, CONNECT_CONSENT), room.url).writeHead({
      uid: sync.selfUid, version: sync.ownVersion || undefined, nextHead: prev => (prev.head === '' ? head : prev),
    })
    putSync(room.id, { ...sync, ownVersion: version })
    setNeedsSetup(false)
    setError(null)
  } catch {
    // Declined or offline: the card stays, and nothing was written.
    setError('Bağlanılamadı; onay verilmedi ya da bağlantı yok.')
  }
  for (const r of await loadRooms($)) if (r.status === 'active') pokeRoom($, r)
  await refreshPane($)
}

export async function toggleLive($: EngineInterface, id: string): Promise<void> {
  const room = await roomById($, id)
  if (room !== undefined) await patchRoom($, id, { isLive: !room.isLive })
  await refreshPane($)
}

export async function dropDraft($: EngineInterface, qid: string): Promise<void> {
  setDrafts(draftsNow().filter(d => d.qid !== qid))
  await refreshPane($)
}
```

`approveDraft` is added in T13 with the responder. Approving runs the `ask` once, outside the budget, and sends the answer.

- [ ] **Step 6: Drawing**

`hooks/pane-list.tsx` (the left column, or the top row when narrow):
```tsx
import type { ElementTable, RenderElement } from 'claude-code'

import type { Colors } from './theme'
import type { RoomView } from './state-types'

export type ListOpts = { ui: ElementTable; c: Colors; rooms: RoomView[]; activeId: string | null; onSelect: (id: string) => void; isNarrow: boolean }

const badge = (room: RoomView) => (room.unread > 0 ? ` ${room.unread}` : '')
const kindGlyph = (room: RoomView) => (room.kind === 'project' ? '⌥ ' : '')

export function RoomList(o: ListOpts): RenderElement {
  const { Box, Button, Text } = o.ui
  if (o.rooms.length === 0) return <Text color={o.c.lo}>Henüz oda yok. /transceiver ekle ile başla.</Text>
  return (
    <Box flexDirection={o.isNarrow ? 'row' : 'column'} gap={o.isNarrow ? 1 : 0} flexWrap="wrap">
      {o.rooms.map(room => (
        <Button key={`room-${room.id}`} variant={room.id === o.activeId ? 'primary' : 'secondary'} onPress={() => o.onSelect(room.id)}>
          {`${kindGlyph(room)}${room.title}${badge(room)}`}
        </Button>
      ))}
    </Box>
  )
}
```

`hooks/pane-chat.tsx` (messages and composer):
```tsx
import type { ElementTable, RenderElement } from 'claude-code'

import { isUnreadable } from './protocol'
import type { Line, Receipt } from './state-types'
import type { Colors } from './theme'

const TICKS: Record<Receipt, string> = { pending: '…', sent: '✓', delivered: '✓✓', read: '✓✓' }
const clock = (ts: number) => new Date(ts).toISOString().slice(11, 16)

export type ChatOpts = {
  ui: ElementTable; c: Colors; lines: Line[]; canType: boolean; error: string | null
  onSend: (text: string) => void
}

function LineRow(ui: ElementTable, c: Colors, line: Line): RenderElement {
  const { Box, Text } = ui
  const m = line.message
  if (isUnreadable(m)) return <Text key={line.id} color={c.lo} italic>okunamayan mesaj</Text>
  const isAgent = m.kind !== 'human'
  const tick = line.receipt === undefined ? '' : ` ${TICKS[line.receipt]}`
  const tickColor = line.receipt === 'read' ? c.read : c.lo
  return (
    <Box key={line.id} flexDirection="column" alignSelf={line.isMine ? 'flex-end' : 'flex-start'}
      borderStyle={isAgent ? undefined : 'round'} borderColor={line.isMine ? c.mineLine : c.line} paddingX={1}>
      <Text color={isAgent ? c.agent : c.lo}>{`${clock(m.ts)} ${line.authorName}${isAgent ? ` · ${m.kind}` : ''}`}</Text>
      <Text color={c.fg} wrap="wrap">{m.text}</Text>
      {tick === '' ? null : <Text color={tickColor}>{tick}</Text>}
    </Box>
  )
}

export function Chat(o: ChatOpts): RenderElement {
  const { Box, Input, Text } = o.ui
  return (
    <Box flexDirection="column" gap={1} flexGrow={1}>
      {o.lines.length === 0 ? <Text color={o.c.lo}>Henüz mesaj yok. İlk mesajı aşağıdan yaz.</Text> : null}
      {o.lines.map(line => LineRow(o.ui, o.c, line))}
      {o.error === null ? null : <Text color={o.c.danger}>{o.error}</Text>}
      {o.canType && Input !== undefined
        ? <Input key="composer" placeholder="Mesaj yaz…  (/ask ile agent'a sor)" submitLabel="Gönder" autoFocus onSubmit={value => o.onSend(value)} />
        : <Text color={o.c.lo}>Bu yüzeyde yazılamıyor; odanın web sayfasını aç.</Text>}
    </Box>
  )
}
```

`hooks/pane-cards.tsx` (invite, GitHub confirm, setup, and draft cards, which follow the Gate board):
```tsx
import type { ElementTable, RenderElement } from 'claude-code'

import type { Draft, GhAsk, Invite } from './state-types'
import type { Colors } from './theme'

type Card = { ui: ElementTable; c: Colors; title: string; body: string; yes: string; no: string; onYes: () => void; onNo: () => void; key: string }

function CardBox(o: Card): RenderElement {
  const { Box, Button, Text } = o.ui
  return (
    <Box key={o.key} flexDirection="column" borderStyle="round" borderColor={o.c.mineLine} paddingX={1} gap={0}>
      <Text bold color={o.c.fg}>{o.title}</Text>
      <Text color={o.c.mid} wrap="wrap">{o.body}</Text>
      <Box flexDirection="row" gap={1}>
        <Button key={`${o.key}-yes`} variant="primary" onPress={o.onYes}>{o.yes}</Button>
        <Button key={`${o.key}-no`} variant="secondary" onPress={o.onNo}>{o.no}</Button>
      </Box>
    </Box>
  )
}

export type CardsOpts = {
  ui: ElementTable; c: Colors; invites: Invite[]; ghAsk: GhAsk | null; drafts: Draft[]; needsSetup: boolean
  on: {
    accept: (id: string) => void; reject: (id: string) => void
    gh: (isYes: boolean) => void; setup: (isYes: boolean) => void
    approve: (qid: string) => void; drop: (qid: string) => void
  }
}

export function Cards(o: CardsOpts): RenderElement[] {
  const { ui, c } = o
  const cards: RenderElement[] = []
  if (o.needsSetup) cards.push(CardBox({ ui, c, key: 'setup', title: 'Bu oturumda bağlan', body: 'Mesaj göndermek için Claude bu oturumda bir kez onay ister. Okuma onaysız çalışır; gönderilenler onaya kadar sırada bekler.', yes: 'Bağlan', no: 'Şimdi değil', onYes: () => o.on.setup(true), onNo: () => o.on.setup(false) }))
  for (const inv of o.invites) cards.push(CardBox({ ui, c, key: `inv-${inv.id}`, title: 'Seni Transceiver\'a eklediler', body: `${inv.title}. Kabul edersen yazışabilirsiniz; projelerin ve oturumların hakkında hiçbir bilgi paylaşılmaz.`, yes: 'Kabul et', no: 'Reddet', onYes: () => o.on.accept(inv.id), onNo: () => o.on.reject(inv.id) }))
  if (o.ghAsk !== null) cards.push(CardBox({ ui, c, key: 'gh', title: `${o.ghAsk.name} GitHub'da ${o.ghAsk.gh} mı?`, body: 'Onaylarsan ortak repolarınızda agent\'larınız konuşabilir. Collaborator olmadığı repolar kapalı kalır.', yes: 'Evet, o', no: 'Hayır', onYes: () => o.on.gh(true), onNo: () => o.on.gh(false) }))
  // Past the daily limit nothing is generated until the person says so: the card holds the question, not a paid-for answer.
  for (const d of o.drafts) cards.push(CardBox({ ui, c, key: `draft-${d.qid}`, title: 'Soru onayını bekliyor (günlük limit doldu)', body: `Soru: ${d.question}`, yes: 'Cevapla', no: 'Vazgeç', onYes: () => o.on.approve(d.qid), onNo: () => o.on.drop(d.qid) }))
  return cards
}
```

`hooks/pane.tsx`:
```tsx
import { read } from 'claude-code'
import type { ElementTable, EngineInterface, On, RenderElement } from 'claude-code'

import { acceptInvite, connectSession, confirmGh, dropDraft, rejectInvite, selectRoom, sendText, toggleLive } from './actions'
import { resolveLight } from './kit/tokens'
import { PANE_ID } from './limits'
import { Cards } from './pane-cards'
import { Chat } from './pane-chat'
import { RoomList } from './pane-list'
import { setViewing } from './room-loop'
import { paneAtom, refreshPane, setNeedsSetup } from './state'
import type { RoomView } from './state-types'
import { colors, type Colors } from './theme'

const NARROW_COLUMNS = 90
const LIST_WIDTH = 30

export function wirePane(on: On, approve: ($: EngineInterface, qid: string) => Promise<void>): void {
  on('ui.close', { requestId: PANE_ID } as never, async ($: EngineInterface, e: unknown, next: (e: unknown) => Promise<unknown>) => {
    setViewing(null, false)
    return next(e)
  })
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const model = await read($, paneAtom)
    const c = colors(resolveLight(await $.env.get('MODZ_THEME')))
    const columns = Number((e.props as { bodyColumns?: number }).bodyColumns ?? NARROW_COLUMNS)
    const isNarrow = columns < NARROW_COLUMNS
    const run = (fn: () => Promise<void>) => () => { void fn() }
    const cards = Cards({
      ui, c, invites: model.invites, ghAsk: model.ghAsk, drafts: model.drafts, needsSetup: model.needsSetup,
      on: {
        accept: id => run(() => acceptInvite($, id))(), reject: id => run(() => rejectInvite($, id))(),
        gh: isYes => run(() => (model.ghAsk === null ? Promise.resolve() : confirmGh($, { ...model.ghAsk, isYes })))(),
        setup: isYes => run(() => (isYes ? connectSession($) : (setNeedsSetup(false), refreshPane($))))(),
        approve: qid => run(() => approve($, qid))(), drop: qid => run(() => dropDraft($, qid))(),
      },
    })
    const latency = model.latencyMs === null ? '' : `sinyal ${(model.latencyMs / 1000).toFixed(1)} s`
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={c.signal}>((·)) Transceiver</Text>
          <Text color={c.lo}>{latency}</Text>
        </Box>
        {cards}
        <Box flexDirection={isNarrow ? 'column' : 'row'} gap={2}>
          <Box flexDirection="column" width={isNarrow ? undefined : LIST_WIDTH}>
            {RoomList({ ui, c, rooms: model.rooms, activeId: model.activeId, isNarrow, onSelect: id => run(() => selectRoom($, id))() })}
          </Box>
          {model.activeId === null ? null : Chat({
            ui, c, lines: model.lines, error: model.error, canType: e.surface !== 'mobile',
            onSend: text => run(() => sendText($, { roomId: model.activeId as string, text }))(),
          })}
        </Box>
        {LiveToggle({ ui, c, room: model.rooms.find(r => r.id === model.activeId), onToggle: id => run(() => toggleLive($, id))() })}
      </Box>
    )
  })
}

// Only project rooms can wake a session; a DM never shows the switch.
function LiveToggle(o: { ui: ElementTable; c: Colors; room: RoomView | undefined; onToggle: (id: string) => void }): RenderElement | null {
  const { Box, Button, Text } = o.ui
  const room = o.room
  if (room === undefined || room.kind !== 'project') return null
  return (
    <Box flexDirection="column">
      <Button key="live" variant="secondary" onPress={() => o.onToggle(room.id)}>{room.isLive ? 'Canlı: açık' : 'Canlı: kapalı'}</Button>
      <Text color={o.c.lo} wrap="wrap">Açıkken gelen agent mesajları bu repodaki boşta oturumu uyandırır. Her uyanış token harcar.</Text>
    </Box>
  )
}
```

- [ ] **Step 7: Time ticks and refresh the pane (`room-loop.ts` change)**

In `step()`, wrap the `tick` call:
```ts
  const startedAt = await $.clock.now()
  const out = await tick({ relay, state, isViewing: isPaneOpen && viewing === room.id, isReceiptsOn: settings.isReceiptsOn })
  const tookMs = (await $.clock.now()) - startedAt
```
After the listeners run, add `latency(tookMs)`, where `room-loop.ts` exports `export const onLatency = (fn: (ms: number) => void) => { latencyListeners.push(fn) }` and keeps `const latencyListeners: Array<(ms: number) => void> = []`. In `register.tsx`, call `onLatency(setLatency)` and `onTick(() => refreshPane($))`. Register them inside `session.start` so that `$` is in scope.

- [ ] **Step 8: Pane render test**

`tests/pane.test.tsx`:
```tsx
import { expect, mock, test } from 'claude-code/testing'
import { register } from '../hooks/register'

test('the pane opens from the command and draws the empty state', { plugins: [{ name: 'transceiver', register }] } as never, async ($: any, on: any) => {
  mock.store(on, {})
  mock.env(on, { HOME: '/Users/test' })
  await $.command.run({ command: 'transceiver', args: '' })
  const tree = await $.ui.render({ component: 'Pane', requestId: 'transceiver', surface: 'terminal', props: { bodyColumns: 120 } })
  expect(JSON.stringify(tree)).toContain('Henüz oda yok')
})
```

The harness surface for `$.command.run` and `$.ui.render` in tests is defined in `claude-code/testing`. Before running, grep `/private/tmp/claude-501/bundled-skills/*/plugin-authoring/types/claude-code.d.ts` for `export function test` and `TestContext`. If the call names differ, use the names it declares. MODZ `mods/modz/tests/hub.test.ts:49` shows a working plugin-level test to copy from.

- [ ] **Step 9: Register, test, preview, commit**

`hooks/register.tsx`:
```tsx
import type { Register } from 'claude-code'

import { wireCommands } from './commands'
import { wirePane } from './pane'
import { onLatency, onTick, startLoop } from './room-loop'
import { refreshPane, setLatency, setNeedsSetup } from './state'

export const register: Register = on => {
  wireCommands(on)
  wirePane(on, async () => undefined)
  on('session.start', async ($, e, next) => {
    onLatency(setLatency)
    onTick(async ({ isDenied }) => {
      if (isDenied) setNeedsSetup(true)
      await refreshPane($)
    })
    await startLoop($)
    await refreshPane($)
    return next(e)
  })
}
```
Run: `claude plugin test . && claude plugin validate . && tsc -p .`
Expected: PASS, with no type errors.
Then run `/Users/partalle/Projects/MODZ/bin/preview transceiver` if MODZ's preview supports outside folders. If it does not, take a screenshot of the pane in the desktop app and compare it against the canvas boards.
```bash
git add hooks tests
git commit -m "feat(pane): draw rooms, chat, receipts and cards" -m "Matches the design canvas boards; mobile is read-only and points to the room page." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Status entry and toast

**Files:**
- Create: `hooks/notify.ts`
- Modify: `hooks/register.tsx`
- Test: `tests/notify.test.ts`

**Interfaces:**
- Consumes: `onTick` (T6). `loadSettings` (T6). `RoomView` (T1). `Entry` (T5). `paneAtom` (T8).
- Produces: `statusText(rooms: RoomView[], isPaneOpen: boolean): string | undefined` and `toastText(opts: { name: string; entry: Entry }): string | null` (both pure), plus `wireNotify(on)`.

- [ ] **Step 1: Failing tests**

`tests/notify.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { statusText, toastText } from '../hooks/notify'

const room = (unread: number) => ({ id: 'r', title: 'Alperen', kind: 'dm' as const, unread, lastText: '', lastTs: 0, gate: 'unknown' as const, isLive: false })

test('status shows the unread total only while the pane is closed', () => {
  expect(statusText([room(2), room(1)], false)).toBe('((·)) 3')
  expect(statusText([room(2)], true)).toBe(undefined)
  expect(statusText([room(0)], false)).toBe(undefined)
})

test('toast for a human message, never for agent traffic, clipped to one line', () => {
  const human = { author: 'u', message: { v: 1 as const, id: 'X', ts: 1, kind: 'human' as const, text: 'satır bir\nsatır iki' } }
  expect(toastText({ name: 'Alperen', entry: human })).toBe('Alperen: satır bir')
  expect(toastText({ name: 'Alperen', entry: { ...human, message: { ...human.message, kind: 'query' as const } } })).toBe(null)
})
```

- [ ] **Step 2: Implement `hooks/notify.ts`**

```ts
import { read } from 'claude-code'
import type { On } from 'claude-code'

import { isUnreadable } from './protocol'
import { onTick } from './room-loop'
import { loadSettings } from './rooms'
import { paneAtom } from './state'
import type { RoomView } from './state-types'
import type { Entry } from './timeline'

const TOAST_CHARS = 60
let isPaneOpen = false

export const setPaneOpen = (is: boolean) => { isPaneOpen = is }

export function statusText(rooms: RoomView[], isOpen: boolean): string | undefined {
  const total = rooms.reduce((n, r) => n + r.unread, 0)
  return isOpen || total === 0 ? undefined : `((·)) ${total}`
}

export function toastText(opts: { name: string; entry: Entry }): string | null {
  const m = opts.entry.message
  if (isUnreadable(m) || m.kind !== 'human') return null
  return `${opts.name}: ${m.text.split('\n')[0].slice(0, TOAST_CHARS)}`
}

export function wireNotify(on: On): void {
  on('session.start', async ($, e, next) => {
    onTick(async ({ fresh }) => {
      const settings = await loadSettings($)
      const model = await read($, paneAtom)
      if (settings.isStatusOn) $.ui.status(statusText(model.rooms, isPaneOpen))
      if (!settings.isToastOn || isPaneOpen) return
      for (const entry of fresh) {
        const text = toastText({ name: model.lines.find(l => l.id === entry.message.id)?.authorName ?? 'Yeni mesaj', entry })
        if (text !== null) $.ui.toast(text)
      }
    })
    return next(e)
  })
}
```

In `pane.tsx`, call `setPaneOpen(true)` wherever the pane opens, which is the `command.run` path that calls `openPane` in `commands.ts`, and call `setPaneOpen(false)` in the `ui.close` hook. Add `wireNotify(on)` to `register.tsx` after `wirePane`.

- [ ] **Step 3: Test and commit**

Run: `claude plugin test .`
Expected: PASS.
```bash
git add hooks/notify.ts hooks/register.tsx hooks/pane.tsx hooks/commands.ts tests/notify.test.ts
git commit -m "feat(notify): unread status entry and message toasts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
