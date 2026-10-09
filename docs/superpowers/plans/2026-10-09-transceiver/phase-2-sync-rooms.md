# Phase 2 · Sync and rooms

### Task 5: Timeline and sync engine

**Files:**
- Create: `hooks/timeline.ts`, `hooks/sync.ts`
- Test: `tests/timeline.test.ts`, `tests/sync.test.ts`

**Interfaces:**
- Consumes: `Relay`, `RelayError`, `HeadEntry` (T4). `Head`, `Message`, `Unreadable`, `emptyHead`, `isUnreadable` (T2). `newId` (T1/T2). `POLL_*` (T1).
- Produces:
  ```ts
  // timeline.ts
  type Entry = { author: string; message: Message | Unreadable; isPending?: boolean }
  function mergeEntries(current: Entry[], incoming: Entry[], keep?: number): Entry[]
  function receiptOf(opts: { entry: Entry; selfUid: string; peers: Head[]; isReceiptsOn: boolean }): Receipt
  function unreadCount(opts: { entries: Entry[]; selfUid: string; readUpTo: string }): number
  // sync.ts
  type RoomSync = {
    selfUid: string; ownHead: Head; ownVersion: number; cursors: Record<string, number>
    peers: Record<string, Head>; entries: Entry[]; pending: Message[]; failures: number
  }
  function initialSync(selfUid: string): RoomSync
  function enqueue(state: RoomSync, message: Message): RoomSync
  type TickResult = { state: RoomSync; fresh: Entry[]; isDenied: boolean }
  function tick(opts: { relay: Relay; state: RoomSync; isViewing: boolean; isReceiptsOn: boolean }): Promise<TickResult>
  function nextDelay(opts: { isPaneOpen: boolean; failures: number }): number
  ```

- [ ] **Step 1: Write the failing timeline tests**

`tests/timeline.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { emptyHead, type Message } from '../hooks/protocol'
import { mergeEntries, receiptOf, unreadCount, type Entry } from '../hooks/timeline'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const m = (id: string, ts: number): Message => ({ v: 1, id, ts, kind: 'human', text: id })
const A = '01K7A0000000000000000000A1'
const B = '01K7A0000000000000000000A2'
const C = '01K7A0000000000000000000A3'

test('merge dedupes by id, prefers the stored copy over the pending one, and orders by ts then id', () => {
  const pending: Entry = { author: ME, message: m(B, 20), isPending: true }
  const stored: Entry = { author: ME, message: m(B, 20) }
  const out = mergeEntries([pending, { author: PEER, message: m(C, 30) }], [stored, { author: PEER, message: m(A, 10) }])
  expect(out.map(e => e.message.id)).toEqual([A, B, C])
  expect(out[1].isPending).toBe(undefined)
})

test('merge keeps only the newest entries when asked', () => {
  const many = [A, B, C].map((id, i) => ({ author: PEER, message: m(id, i) }))
  expect(mergeEntries([], many, 2).map(e => e.message.id)).toEqual([B, C])
})

test('receipts: pending, sent, delivered, read; read hidden when receipts are off', () => {
  const mine: Entry = { author: ME, message: m(B, 20) }
  const peerSaw = { ...emptyHead(), seenUpTo: B }
  const peerRead = { ...peerSaw, readUpTo: B }
  expect(receiptOf({ entry: { ...mine, isPending: true }, selfUid: ME, peers: [], isReceiptsOn: true })).toBe('pending')
  expect(receiptOf({ entry: mine, selfUid: ME, peers: [emptyHead()], isReceiptsOn: true })).toBe('sent')
  expect(receiptOf({ entry: mine, selfUid: ME, peers: [peerSaw], isReceiptsOn: true })).toBe('delivered')
  expect(receiptOf({ entry: mine, selfUid: ME, peers: [peerRead], isReceiptsOn: true })).toBe('read')
  expect(receiptOf({ entry: mine, selfUid: ME, peers: [peerRead], isReceiptsOn: false })).toBe('delivered')
})

test('unread counts only other authors after my read cursor', () => {
  const entries = [{ author: PEER, message: m(A, 1) }, { author: ME, message: m(B, 2) }, { author: PEER, message: m(C, 3) }]
  expect(unreadCount({ entries, selfUid: ME, readUpTo: A })).toBe(1)
})
```

- [ ] **Step 2: Implement `hooks/timeline.ts`**

```ts
import type { Receipt } from './state-types'
import type { Head, Message, Unreadable } from './protocol'

export type Entry = { author: string; message: Message | Unreadable; isPending?: boolean }

const tsOf = (e: Entry) => ('ts' in e.message ? e.message.ts : 0)
const order = (a: Entry, b: Entry) => tsOf(a) - tsOf(b) || (a.message.id < b.message.id ? -1 : 1)

export function mergeEntries(current: Entry[], incoming: Entry[], keep = Number.POSITIVE_INFINITY): Entry[] {
  const byId = new Map<string, Entry>()
  for (const e of current) byId.set(e.message.id, e)
  for (const e of incoming) {
    const prev = byId.get(e.message.id)
    // A pending copy never replaces a stored one; a stored copy always replaces a pending one.
    if (prev === undefined || prev.isPending === true) byId.set(e.message.id, e.isPending === true ? e : { author: e.author, message: e.message })
  }
  const sorted = [...byId.values()].sort(order)
  return sorted.slice(Math.max(0, sorted.length - keep))
}

export function receiptOf(opts: { entry: Entry; selfUid: string; peers: Head[]; isReceiptsOn: boolean }): Receipt {
  const { entry, peers } = opts
  if (entry.isPending === true) return 'pending'
  const id = entry.message.id
  const isRead = opts.isReceiptsOn && peers.length > 0 && peers.every(p => p.readUpTo >= id)
  if (isRead) return 'read'
  const isDelivered = peers.length > 0 && peers.every(p => p.seenUpTo >= id)
  return isDelivered ? 'delivered' : 'sent'
}

export function unreadCount(opts: { entries: Entry[]; selfUid: string; readUpTo: string }): number {
  return opts.entries.filter(e => e.author !== opts.selfUid && e.message.id > opts.readUpTo).length
}
```

- [ ] **Step 3: Write the failing sync tests**

`tests/sync.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { relayOf } from '../hooks/relay'
import { enqueue, initialSync, nextDelay, tick } from '../hooks/sync'
import { callerFor, fakeDb } from './fake-db'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const URL = 'https://claude.ai/artifact/room1'
const A = '01K7A0000000000000000000A1'
const B = '01K7A0000000000000000000A2'

test('a queued message is sent, then appears as stored for both sides', async () => {
  const db = fakeDb(ME)
  const mine = relayOf(callerFor(db), URL)
  let state = enqueue(initialSync(ME), { v: 1, id: A, ts: 10, kind: 'human', text: 'selam' })
  expect(state.entries[0].isPending).toBe(true)
  state = (await tick({ relay: mine, state, isViewing: true, isReceiptsOn: true })).state
  expect(state.pending.length).toBe(0)
  expect(state.entries[0].isPending).toBe(undefined)

  db.self = PEER
  const theirs = relayOf(callerFor(db), URL)
  const seen = await tick({ relay: theirs, state: initialSync(PEER), isViewing: true, isReceiptsOn: true })
  expect(seen.fresh.map(e => e.message.id)).toEqual([A])
  expect(seen.state.ownHead.seenUpTo).toBe(A)
  expect(seen.state.ownHead.readUpTo).toBe(A)
})

test('a failed send stays queued and counts a failure', async () => {
  const db = fakeDb(ME)
  db.isDown = true
  const state = enqueue(initialSync(ME), { v: 1, id: B, ts: 20, kind: 'human', text: 'x' })
  const out = await tick({ relay: relayOf(callerFor(db), URL), state, isViewing: false, isReceiptsOn: true })
  expect(out.state.pending.length).toBe(1)
  expect(out.state.failures).toBe(1)
})

test('unapproved writes keep messages queued but still pull what peers sent', async () => {
  const db = fakeDb(PEER)
  await tick({ relay: relayOf(callerFor(db), URL), state: enqueue(initialSync(PEER), { v: 1, id: A, ts: 1, kind: 'human', text: 'a' }), isViewing: false, isReceiptsOn: true })
  db.self = ME
  db.isWriteDenied = true
  const out = await tick({ relay: relayOf(callerFor(db), URL), state: enqueue(initialSync(ME), { v: 1, id: B, ts: 2, kind: 'human', text: 'b' }), isViewing: true, isReceiptsOn: true })
  expect(out.isDenied).toBe(true)
  expect(out.state.pending.map(m => m.id)).toEqual([B])
  expect(out.fresh.map(e => e.message.id)).toEqual([A])
  expect(out.state.failures).toBe(0)
})

test('read receipts off: readUpTo is never written', async () => {
  const db = fakeDb(ME)
  await tick({ relay: relayOf(callerFor(db), URL), state: enqueue(initialSync(ME), { v: 1, id: A, ts: 1, kind: 'human', text: 'a' }), isViewing: false, isReceiptsOn: true })
  db.self = PEER
  const out = await tick({ relay: relayOf(callerFor(db), URL), state: initialSync(PEER), isViewing: true, isReceiptsOn: false })
  expect(out.state.ownHead.readUpTo).toBe('')
})

test('delay: 1s open, 5s closed, doubling on failure up to 30s', () => {
  expect(nextDelay({ isPaneOpen: true, failures: 0 })).toBe(1_000)
  expect(nextDelay({ isPaneOpen: false, failures: 0 })).toBe(5_000)
  expect(nextDelay({ isPaneOpen: true, failures: 2 })).toBe(4_000)
  expect(nextDelay({ isPaneOpen: false, failures: 9 })).toBe(30_000)
})
```

- [ ] **Step 4: Implement `hooks/sync.ts`**

```ts
import { POLL_CLOSED_MS, POLL_MAX_MS, POLL_OPEN_MS } from './limits'
import { emptyHead, isUnreadable } from './protocol'
import type { Head, Message } from './protocol'
import { RelayError } from './relay'
import type { HeadEntry, Relay } from './relay'
import { mergeEntries, type Entry } from './timeline'

const KEEP_ENTRIES = 500
const BACKOFF = 2

export type RoomSync = {
  selfUid: string
  ownHead: Head
  ownVersion: number
  cursors: Record<string, number>
  peers: Record<string, Head>
  entries: Entry[]
  pending: Message[]
  failures: number
}

type TickOpts = { relay: Relay; state: RoomSync; isViewing: boolean; isReceiptsOn: boolean }

export const initialSync = (selfUid: string): RoomSync => ({
  selfUid, ownHead: emptyHead(), ownVersion: 0, cursors: {}, peers: {}, entries: [], pending: [], failures: 0,
})

export function enqueue(state: RoomSync, message: Message): RoomSync {
  const entry: Entry = { author: state.selfUid, message, isPending: true }
  return { ...state, pending: [...state.pending, message], entries: mergeEntries(state.entries, [entry], KEEP_ENTRIES) }
}

export function nextDelay(opts: { isPaneOpen: boolean; failures: number }): number {
  const base = opts.isPaneOpen ? POLL_OPEN_MS : POLL_CLOSED_MS
  return Math.min(POLL_MAX_MS, base * BACKOFF ** opts.failures)
}

async function flush(relay: Relay, state: RoomSync): Promise<RoomSync> {
  let s = state
  for (const message of state.pending) {
    const head: Head = { ...s.ownHead, head: message.id, headTs: message.ts }
    const version = await relay.send({
      uid: s.selfUid, message, version: s.ownVersion || undefined,
      nextHead: prev => (prev.head === '' ? head : { ...prev, head: message.id, headTs: message.ts }),
    })
    s = { ...s, ownHead: head, ownVersion: version, pending: s.pending.filter(p => p.id !== message.id) }
    s = { ...s, entries: mergeEntries(s.entries, [{ author: s.selfUid, message }], KEEP_ENTRIES) }
  }
  return s
}

async function pull(relay: Relay, state: RoomSync, heads: HeadEntry[]): Promise<{ state: RoomSync; fresh: Entry[] }> {
  let s = state
  const fresh: Entry[] = []
  for (const { uid, head, version } of heads) {
    if (uid === s.selfUid) {
      s = { ...s, ownHead: head, ownVersion: version }
    } else {
      s = { ...s, peers: { ...s.peers, [uid]: head } }
    }
    const cursor = s.cursors[uid] ?? 0
    if (head.head === '' || head.headTs <= cursor) continue
    const got = await relay.since(uid, cursor)
    const entries = got.map(message => ({ author: uid, message }))
    const lastTs = got.reduce((max, m) => (isUnreadable(m) ? max : Math.max(max, m.ts)), cursor)
    s = { ...s, cursors: { ...s.cursors, [uid]: lastTs }, entries: mergeEntries(s.entries, entries, KEEP_ENTRIES) }
    if (uid !== s.selfUid) fresh.push(...entries)
  }
  return { state: s, fresh }
}

async function acknowledge(opts: TickOpts & { fresh: Entry[] }): Promise<RoomSync> {
  const { relay, state, fresh } = opts
  const newest = fresh.reduce((max, e) => (e.message.id > max ? e.message.id : max), state.ownHead.seenUpTo)
  const readUpTo = opts.isViewing && opts.isReceiptsOn ? newest : state.ownHead.readUpTo
  const isUnchanged = newest === state.ownHead.seenUpTo && readUpTo === state.ownHead.readUpTo
  if (isUnchanged) return state
  const head: Head = { ...state.ownHead, seenUpTo: newest, readUpTo }
  const version = await relay.writeHead({
    uid: state.selfUid, version: state.ownVersion || undefined,
    nextHead: prev => (prev.head === '' && state.ownVersion > 0 ? head : { ...prev, seenUpTo: newest, readUpTo }),
  })
  return { ...state, ownHead: head, ownVersion: version }
}

export type TickResult = { state: RoomSync; fresh: Entry[]; isDenied: boolean }

// A write the session has not approved yet (spike R1) must not stop reading: pull still runs, sends wait.
export async function tick(opts: TickOpts): Promise<TickResult> {
  let isDenied = false
  const guard = async (fn: () => Promise<RoomSync>, fallback: RoomSync): Promise<RoomSync> => {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof RelayError && err.kind === 'denied')) throw err
      isDenied = true
      return fallback
    }
  }
  try {
    const sent = await guard(() => flush(opts.relay, opts.state), opts.state)
    const pulled = await pull(opts.relay, sent, await opts.relay.heads())
    const state = isDenied ? pulled.state : await guard(() => acknowledge({ ...opts, state: pulled.state, fresh: pulled.fresh }), pulled.state)
    return { state: { ...state, failures: 0 }, fresh: pulled.fresh, isDenied }
  } catch (err) {
    if (!(err instanceof RelayError)) throw err
    return { state: { ...opts.state, failures: opts.state.failures + 1 }, fresh: [], isDenied }
  }
}
```

The `acknowledge` test case where the peer's `readUpTo` is written relies on `isViewing: true`. The pane sets this for the room it shows (T8).

- [ ] **Step 5: Run the tests**

Run: `claude plugin test .`
Expected: the timeline and sync tests pass.

- [ ] **Step 6: Commit**

```bash
git add hooks/timeline.ts hooks/sync.ts tests/timeline.test.ts tests/sync.test.ts
git commit -m "feat(sync): poll heads, pull new messages, send queued ones" -m "One list call per tick; seen and read cursors ride on the author's own head." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rooms, invites, and the room page

**Files:**
- Create: `hooks/rooms.ts`, `hooks/room-page.ts`, `hooks/room-loop.ts`
- Modify: `hooks/register.tsx` (wire the loop)
- Test: `tests/rooms.test.ts`

**Interfaces:**
- Consumes: `relayOf`, `ToolCaller`, `RelayError` (T4). `RoomSync`, `tick`, `initialSync`, `nextDelay` (T5). `parseArtifactUrls` (T3). `TITLE_PREFIX`, `DISCOVER_MS` (T1).
- Produces:
  ```ts
  type Peer = { uid: string; gh?: string; isGhConfirmed: boolean }
  type RoomRecord = {
    id: string; url: string; kind: 'dm' | 'project'; repo?: string; title: string
    status: 'active' | 'invited' | 'left'; isLive: boolean; isOwner: boolean; peers: Peer[]; joinedAt: number
  }
  type Settings = { isReceiptsOn: boolean; isToastOn: boolean; isStatusOn: boolean; label?: string; gh?: string }
  function loadRooms($): Promise<RoomRecord[]>;  function saveRooms($, rooms): Promise<void>
  function loadSettings($): Promise<Settings>;   function saveSettings($, s): Promise<void>
  function createRoom(opts: { $; kind; repo?; title }): Promise<RoomRecord>
  function discoverInvites(opts: { $; known: RoomRecord[] }): Promise<RoomRecord[]>
  function roomPageHtml(opts: { title: string }): string
  function startLoop($): void   // room-loop.ts: per-room tick on its own timer
  ```

- [ ] **Step 1: Write the failing tests**

`tests/rooms.test.ts`:
```ts
import { expect, mock, test } from 'claude-code/testing'
import { invitedFrom, roomTitle } from '../hooks/rooms'
import { roomPageHtml } from '../hooks/room-page'

test('room titles carry the prefix discovery looks for', () => {
  expect(roomTitle({ kind: 'dm' })).toBe('Transceiver · DM')
  expect(roomTitle({ kind: 'project', repo: 'partalemre/eliti' })).toBe('Transceiver · partalemre/eliti')
})

test('only unknown Transceiver urls from the shared list become invites', () => {
  const result = { artifacts: [
    { title: 'Transceiver · DM', url: 'https://claude.ai/artifact/AAA111', rel: 'shared' },
    { title: 'Quarterly plan', url: 'https://claude.ai/artifact/BBB222', rel: 'shared' },
    { title: 'Transceiver · DM', url: 'https://claude.ai/artifact/CCC333', rel: 'shared' },
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
```

- [ ] **Step 2: Implement `hooks/rooms.ts`**

```ts
import type { EngineInterface } from 'claude-code'

import { parseArtifactUrls } from './dbtext'
import { TITLE_PREFIX } from './limits'
import { PROTOCOL_VERSION } from './limits'
import { callerOf, relayOf } from './relay'
import { roomPageHtml } from './room-page'
import { newId } from './ulid'

export type Peer = { uid: string; gh?: string; isGhConfirmed: boolean }
export type RoomRecord = {
  id: string; url: string; kind: 'dm' | 'project'; repo?: string; title: string
  status: 'active' | 'invited' | 'left'; isLive: boolean; isOwner: boolean; peers: Peer[]; joinedAt: number
}
export type Settings = { isReceiptsOn: boolean; isToastOn: boolean; isStatusOn: boolean; label?: string; gh?: string }

const ROOMS_KEY = 'tx.rooms'
const SETTINGS_KEY = 'tx.settings'
const DEFAULT_SETTINGS: Settings = { isReceiptsOn: true, isToastOn: true, isStatusOn: true }
const ROOM_CAPABILITIES = {
  db: { rules: [{ path: 'outbox', read: 'view', write: 'owner' }, { path: 'outbox/{self}', write: 'interact' }] },
  user: { scopes: ['profile'] },
}

export const roomTitle = (opts: { kind: 'dm' | 'project'; repo?: string }) =>
  `${TITLE_PREFIX}${opts.kind === 'dm' ? 'DM' : opts.repo ?? ''}`

export async function loadRooms($: EngineInterface): Promise<RoomRecord[]> {
  const raw = await $.store.get(ROOMS_KEY)
  return Array.isArray(raw) ? (raw as RoomRecord[]) : []
}

export const saveRooms = ($: EngineInterface, rooms: RoomRecord[]) => $.store.set(ROOMS_KEY, rooms)

export async function loadSettings($: EngineInterface): Promise<Settings> {
  const raw = await $.store.get(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...(typeof raw === 'object' && raw !== null ? (raw as Partial<Settings>) : {}) }
}

export const saveSettings = ($: EngineInterface, s: Settings) => $.store.set(SETTINGS_KEY, s)

async function pagePath($: EngineInterface, id: string): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  return `${home}/.claude/transceiver/rooms/${id}.html`
}

export async function createRoom(opts: { $: EngineInterface; kind: 'dm' | 'project'; repo?: string }): Promise<RoomRecord> {
  const { $ } = opts
  const now = await $.clock.now()
  const id = newId(now)
  const title = roomTitle(opts)
  const file = await pagePath($, id)
  await $.fs.write(file, roomPageHtml({ title }))
  const out = (await $.tool.call({
    tool: 'Artifact', action: 'publish', file_path: file, icon: 'radio',
    description: 'Transceiver odası', capabilities: ROOM_CAPABILITIES,
  } as never)) as { text?: string; isError?: boolean; deny?: string }
  const url = parseArtifactUrls(out.text ?? '')[0]
  if (out.deny !== undefined || out.isError === true || url === undefined) {
    throw new Error(`room publish failed: ${(out.deny ?? out.text ?? '').split('\n')[0]}`)
  }
  await relayOf(callerOf($), url).writeMeta({ v: PROTOCOL_VERSION as 1, kind: opts.kind, repo: opts.repo, createdAt: now })
  return { id, url, kind: opts.kind, repo: opts.repo, title, status: 'active', isLive: false, isOwner: true, peers: [], joinedAt: now }
}

type Listed = { title?: unknown; url?: unknown }

// The tool's structured result lists `{ title, url }` (spike R3); the text is only a fallback.
export function invitedFrom(opts: { result: unknown; text: string; knownUrls: string[] }): string[] {
  const known = new Set(opts.knownUrls)
  const listed = (opts.result as { artifacts?: Listed[] } | undefined)?.artifacts
  const urls = Array.isArray(listed)
    ? listed.filter(a => typeof a.title === 'string' && a.title.startsWith(TITLE_PREFIX) && typeof a.url === 'string').map(a => a.url as string)
    : opts.text.split('\n').filter(line => line.includes(TITLE_PREFIX.trim())).flatMap(parseArtifactUrls)
  return [...new Set(urls)].filter(url => !known.has(url))
}

// A listed title is a hint only; a room is real once its meta doc parses.
export async function discoverInvites(opts: { $: EngineInterface; known: RoomRecord[] }): Promise<RoomRecord[]> {
  const { $ } = opts
  const out = (await $.tool.call({ tool: 'Artifact', action: 'list', scope: 'shared', limit: 100 } as never)) as { text?: string; result?: unknown }
  const urls = invitedFrom({ result: out.result, text: out.text ?? '', knownUrls: opts.known.map(r => r.url) })
  const now = await $.clock.now()
  const found: RoomRecord[] = []
  for (const url of urls) {
    const meta = await relayOf(callerOf($), url).meta().catch(() => null)
    if (meta === null) continue
    found.push({
      id: newId(now), url, kind: meta.kind, repo: meta.repo, title: roomTitle(meta),
      status: 'invited', isLive: false, isOwner: false, peers: [], joinedAt: now,
    })
  }
  return found
}
```

- [ ] **Step 3: Implement `hooks/room-page.ts`**

The page uses the design tokens from the canvas. `db` `onSnapshot` gives the real-time view on the web and phone, and it writes only to the viewer's own `outbox/{uid}`. It uses the same batch shape as the mod: message plus head, through `doc.set`. The page cannot batch, so it writes the message first and the head second. A crash between the two leaves the message stored but unannounced. The next send repairs this, because the head always points at the newest message.

```ts
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

const STYLE = `
:root{--bg:#F4F2EC;--card:#FFFFFF;--line:#E4E0D6;--fg:#1C1B19;--muted:#77726A;--signal:#0E6F66;--mine:#E3F3F0;--mine-line:#A9D8CF;--agent:#6243C4;--read:#2464A0;--font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#191917;--card:#1F1F1C;--line:#2E2E2A;--fg:#F0EEE8;--muted:#8E8A80;--signal:#5CC8B8;--mine:#1A2E2B;--mine-line:#2E5650;--agent:#B19CF3;--read:#7FB6E8;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#191917;--card:#1F1F1C;--line:#2E2E2A;--fg:#F0EEE8;--muted:#8E8A80;--signal:#5CC8B8;--mine:#1A2E2B;--mine-line:#2E5650;--agent:#B19CF3;--read:#7FB6E8;color-scheme:dark}
html,body{height:100%}body{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:15px;margin:0}
.app{height:100%;display:flex;flex-direction:column;max-width:760px;margin:0 auto;padding-inline:16px}
header{padding-block:14px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:baseline}
header h1{font-size:16px;margin:0}header span{color:var(--muted);font-size:12px}
ol{list-style:none;margin:0;padding:16px 0;flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px}
li{max-width:80%;padding:8px 12px;border-radius:4px 14px 14px 14px;background:var(--card);border:1px solid var(--line);overflow-wrap:anywhere;white-space:pre-wrap}
li.mine{align-self:flex-end;background:var(--mine);border-color:var(--mine-line);border-radius:14px 4px 14px 14px}
li.agent{max-width:100%;align-self:stretch;background:none;border:none;border-top:1px dashed var(--line);border-radius:0;font-family:var(--mono);font-size:12px;color:var(--agent)}
li small{display:block;text-align:right;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
form{display:flex;gap:8px;padding-block:12px 20px;border-top:1px solid var(--line)}
input{flex:1;min-width:0;height:44px;border-radius:22px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:0 16px;font:inherit}
button{height:44px;padding:0 18px;border-radius:22px;border:none;background:var(--signal);color:var(--bg);font:inherit;font-weight:600}
button:focus-visible,input:focus-visible{outline:2px solid var(--signal);outline-offset:2px}
.empty{color:var(--muted);text-align:center;margin:auto}`

const SCRIPT = `
(async () => {
  const list = document.getElementById("log"), state = document.getElementById("state"), form = document.getElementById("send")
  const db = await claude.use("db"), user = await claude.use("user")
  if (!db || !user) { state.textContent = "Bu görünümden odaya bağlanılamıyor."; form.hidden = true; return }
  const me = await user.id()
  const rows = new Map()
  const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  const newId = now => { let t = now, s = ""; for (let i = 0; i < 10; i++) { s = ALPHA[t % 32] + s; t = Math.floor(t / 32) } for (let i = 0; i < 16; i++) s += ALPHA[Math.floor(Math.random() * 32)]; return s }
  const render = async () => {
    const all = [...rows.values()].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1))
    const names = await user.profiles([...new Set(all.map(r => r.author))])
    list.replaceChildren(...all.map(r => {
      const li = document.createElement("li")
      li.className = r.author === me ? "mine" : r.kind === "human" ? "" : "agent"
      li.textContent = (r.author === me || r.kind !== "human" ? "" : ((names[r.author] && names[r.author].name) || "Biri") + ": ") + r.text
      const small = document.createElement("small"); small.textContent = new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); li.append(small)
      return li
    }))
    state.textContent = all.length ? "" : "Henüz mesaj yok. İlk mesajı aşağıdan yaz."
    list.scrollTop = list.scrollHeight
  }
  const watched = new Set()
  db.collection("outbox").onSnapshot(snap => {
    for (const d of snap.docs) {
      if (watched.has(d.id)) continue
      watched.add(d.id)
      db.collection("outbox/" + d.id + "/msgs").orderBy("ts", "asc").limit(500).onSnapshot(ms => {
        for (const m of ms.docs) { const x = m.data(); if (x && typeof x.text === "string" && typeof x.ts === "number") rows.set(m.id, { ...x, id: m.id, author: d.id }) }
        render()
      })
    }
  }, () => { state.textContent = "Bağlantı koptu; sayfa yeniden bağlanmayı deneyecek." })
  form.addEventListener("submit", async ev => {
    ev.preventDefault()
    const input = document.getElementById("text"), text = input.value.trim()
    if (!text) return
    const ts = Date.now(), id = newId(ts)
    input.value = ""
    try {
      await db.collection("outbox/" + me + "/msgs").doc(id).set({ v: 1, id, ts, kind: "human", text })
      const head = await db.doc("outbox/" + me).get()
      const prev = head.exists ? head.data() : { v: 1, seenUpTo: "", readUpTo: "", readTs: 0 }
      await db.doc("outbox/" + me).set({ ...prev, v: 1, head: id, headTs: ts })
    } catch (e) { state.textContent = "Gönderilemedi: " + (e && e.message ? e.message : "bilinmeyen hata"); input.value = text }
  })
})()`

export function roomPageHtml(opts: { title: string }): string {
  const title = escapeHtml(opts.title)
  return `<title>${title}</title>\n<style>${STYLE}</style>\n<div class="app"><header><h1>${title}</h1><span>Claude içinde, yalnızca davetliler</span></header>`
    + `<p id="state" class="empty">Mesajlar yükleniyor.</p><ol id="log" aria-live="polite"></ol>`
    + `<form id="send"><label for="text" hidden>Mesaj</label><input id="text" autocomplete="off" placeholder="Mesaj" maxlength="4000"><button type="submit">Gönder</button></form></div>`
    + `<script>${SCRIPT}</script>\n`
}
```

- [ ] **Step 4: Implement `hooks/room-loop.ts`** (one timer per active room; the state lives in memory and in `$.store`)

```ts
import type { EngineInterface } from 'claude-code'

import { DISCOVER_MS } from './limits'
import { callerOf, relayOf } from './relay'
import { discoverInvites, loadRooms, loadSettings, saveRooms, type RoomRecord } from './rooms'
import { initialSync, nextDelay, tick, type RoomSync } from './sync'
import type { Entry } from './timeline'

const SYNC_KEY = (id: string) => `tx.sync.${id}`
type Listener = (opts: { room: RoomRecord; state: RoomSync; fresh: Entry[]; isDenied: boolean }) => Promise<void>

const syncs = new Map<string, RoomSync>()
const timers = new Map<string, { cancel(): void }>()
const listeners: Listener[] = []
let viewing: string | null = null
let isPaneOpen = false

export const onTick = (fn: Listener) => { listeners.push(fn) }
export const setViewing = (roomId: string | null, isOpen: boolean) => { viewing = roomId; isPaneOpen = isOpen }
export const syncOf = (roomId: string) => syncs.get(roomId)
export const putSync = (roomId: string, state: RoomSync) => { syncs.set(roomId, state) }

async function selfUid($: EngineInterface, room: RoomRecord): Promise<string> {
  const stored = (await $.store.get(SYNC_KEY(room.id))) as RoomSync | undefined
  if (stored?.selfUid !== undefined) return stored.selfUid
  return relayOf(callerOf($), room.url).whoami()
}

async function step($: EngineInterface, room: RoomRecord): Promise<void> {
  const relay = relayOf(callerOf($), room.url)
  const state = syncs.get(room.id) ?? ((await $.store.get(SYNC_KEY(room.id))) as RoomSync | undefined) ?? initialSync(await selfUid($, room))
  const settings = await loadSettings($)
  const out = await tick({ relay, state, isViewing: isPaneOpen && viewing === room.id, isReceiptsOn: settings.isReceiptsOn })
  syncs.set(room.id, out.state)
  await $.store.set(SYNC_KEY(room.id), out.state)
  for (const fn of listeners) await fn({ room, state: out.state, fresh: out.fresh, isDenied: out.isDenied })
  schedule($, room, nextDelay({ isPaneOpen, failures: out.state.failures }))
}

function schedule($: EngineInterface, room: RoomRecord, ms: number): void {
  timers.get(room.id)?.cancel()
  timers.set(room.id, $.clock.after(ms, () => { void step($, room).catch(err => $.ui.log(`transceiver: ${room.title}: ${String(err)}`)) }))
}

export async function startLoop($: EngineInterface): Promise<void> {
  for (const room of await loadRooms($)) if (room.status === 'active') schedule($, room, 0)
  $.clock.every(DISCOVER_MS, () => { void discover($) })
}

export const pokeRoom = ($: EngineInterface, room: RoomRecord) => schedule($, room, 0)
export const stopRoom = (roomId: string) => { timers.get(roomId)?.cancel(); timers.delete(roomId) }

async function discover($: EngineInterface): Promise<void> {
  const rooms = await loadRooms($)
  const found = await discoverInvites({ $, known: rooms }).catch(() => [])
  if (found.length > 0) await saveRooms($, [...rooms, ...found])
}
```

`$.ui.log` gets only the room title and the error, never message text.

- [ ] **Step 5: Wire the loop in `hooks/register.tsx`**

```tsx
import type { Register } from 'claude-code'
import { startLoop } from './room-loop'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await startLoop($)
    return next(e)
  })
}
```

- [ ] **Step 6: Run the tests, then validate**

Run: `claude plugin test . && claude plugin validate .`
Expected: the rooms tests pass and validate is clean.

- [ ] **Step 7: Commit**

```bash
git add hooks/rooms.ts hooks/room-page.ts hooks/room-loop.ts hooks/register.tsx tests/rooms.test.ts
git commit -m "feat(rooms): publish room artifacts, discover invites, run the poll loop" -m "Each room is its own artifact so nothing about one room is visible from another." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `/transceiver` commands and joining by link

The spike (`docs/spike-results.md`) showed two things. A settings allow rule cannot skip the per-session write approval, so there is no allow-rule setup; T8's "Bağlan" card handles the approval instead. And invites from another organization are not listed, so `katıl <link>` is required.

**Files:**
- Create: `hooks/commands.ts`, `hooks/join.ts`
- Modify: `hooks/register.tsx`
- Test: `tests/commands.test.ts`

**Interfaces:**
- Consumes: `createRoom`, `loadRooms`, `saveRooms`, `roomTitle`, `RoomRecord` (T6). `pokeRoom`, `stopRoom` (T6). `relayOf`, `callerOf` (T4). `parseArtifactUrls` (T3). `newId` (T2). `PANE_ID`, `COMMAND` (T1).
- Produces:
  - `parseCommand(args): Cmd` (pure), where `Cmd = { verb: 'open' | 'ekle' | 'proje' | 'katil' | 'cik' | 'kur' | 'ayarlar' | 'yardim'; arg: string }`
  - `joinUrlOf(text): string | null` (pure)
  - `joinRoom($, url): Promise<string>`
  - `openPane($)`
  - `wireCommands(on)`

- [ ] **Step 1: Failing tests**

`tests/commands.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { parseCommand } from '../hooks/commands'
import { joinUrlOf } from '../hooks/join'

test('no args opens the pane; Turkish verbs parse with or without diacritics', () => {
  expect(parseCommand('')).toEqual({ verb: 'open', arg: '' })
  expect(parseCommand('ekle')).toEqual({ verb: 'ekle', arg: '' })
  expect(parseCommand('çık DM')).toEqual({ verb: 'cik', arg: 'DM' })
  expect(parseCommand('katıl https://claude.ai/artifact/AAA')).toEqual({ verb: 'katil', arg: 'https://claude.ai/artifact/AAA' })
  expect(parseCommand('proje partalemre/eliti')).toEqual({ verb: 'proje', arg: 'partalemre/eliti' })
  expect(parseCommand('bilinmeyen')).toEqual({ verb: 'yardim', arg: 'bilinmeyen' })
})

test('only a claude.ai artifact link is accepted for joining', () => {
  expect(joinUrlOf(' https://claude.ai/artifact/WY6LgKgyskkYWeg16kuUrb ')).toBe('https://claude.ai/artifact/WY6LgKgyskkYWeg16kuUrb')
  expect(joinUrlOf('https://evil.example/artifact/AAA')).toBe(null)
  expect(joinUrlOf('')).toBe(null)
})
```

- [ ] **Step 2: Implement `hooks/join.ts`**

```ts
import type { EngineInterface } from 'claude-code'

import { parseArtifactUrls } from './dbtext'
import { callerOf, relayOf } from './relay'
import { pokeRoom } from './room-loop'
import { loadRooms, roomTitle, saveRooms } from './rooms'
import { newId } from './ulid'

export function joinUrlOf(text: string): string | null {
  const urls = parseArtifactUrls(text.trim())
  return urls.length === 1 && text.trim() === urls[0] ? urls[0] : null
}

// A link is a room only if its meta doc parses; the person typed the link, so joining needs no extra yes.
export async function joinRoom($: EngineInterface, text: string): Promise<string> {
  const url = joinUrlOf(text)
  if (url === null) return 'Kullanım: /transceiver katıl <https://claude.ai/artifact/…>'
  const rooms = await loadRooms($)
  if (rooms.some(r => r.url === url && r.status === 'active')) return 'Bu odaya zaten katıldın.'
  const meta = await relayOf(callerOf($), url).meta().catch(() => null)
  if (meta === null) return 'Bu link bir Transceiver odası değil ya da sana paylaşılmamış.'
  const now = await $.clock.now()
  const room = { id: newId(now), url, kind: meta.kind, repo: meta.repo, title: roomTitle(meta), status: 'active' as const, isLive: false, isOwner: false, peers: [], joinedAt: now }
  await saveRooms($, [...rooms.filter(r => r.url !== url), room])
  pokeRoom($, room)
  return `${room.title} odasına katıldın.`
}
```

- [ ] **Step 3: Implement `hooks/commands.ts`**

```ts
import type { EngineInterface, On } from 'claude-code'

import { joinRoom } from './join'
import { COMMAND, PANE_ID } from './limits'
import { isRepo } from './protocol'
import { pokeRoom, stopRoom } from './room-loop'
import { createRoom, loadRooms, saveRooms } from './rooms'

export type Verb = 'open' | 'ekle' | 'proje' | 'katil' | 'cik' | 'kur' | 'ayarlar' | 'yardim'
export type Cmd = { verb: Verb; arg: string }

const FOLD: Record<string, string> = { ç: 'c', ı: 'i', ğ: 'g', ö: 'o', ş: 's', ü: 'u' }
const fold = (s: string) => s.toLowerCase().replace(/[çığöşü]/g, c => FOLD[c] ?? c)
const VERBS = new Set<Verb>(['ekle', 'proje', 'katil', 'cik', 'kur', 'ayarlar'])
const HELP = [
  '/transceiver — pencereyi aç',
  '/transceiver ekle — arkadaş için DM odası aç',
  '/transceiver proje <sahip/repo> — ortak proje odası aç',
  '/transceiver katıl <link> — davet linkiyle katıl (başka organizasyondan davetler listede görünmez)',
  '/transceiver çık <oda> — odadan çık',
  '/transceiver kur — bu oturumda bağlan (ilk mesaj için tek onay)',
  '/transceiver ayarlar — okundu bilgisi, bildirimler, GitHub adın',
].join('\n')

export function parseCommand(args: string): Cmd {
  const [head = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  if (head === '') return { verb: 'open', arg: '' }
  const verb = fold(head) as Verb
  return VERBS.has(verb) ? { verb, arg } : { verb: 'yardim', arg: head }
}

export const openPane = ($: EngineInterface) => $.ui.open({ id: PANE_ID, title: 'Transceiver', focus: true, closeOnEscape: true } as never)

async function addRoom($: EngineInterface, kind: 'dm' | 'project', repo?: string): Promise<string> {
  const room = await createRoom({ $, kind, repo })
  await saveRooms($, [...(await loadRooms($)), room])
  pokeRoom($, room)
  await openPane($)
  return `Oda hazır: ${room.url}\nclaude.ai'de bu sayfanın Paylaş menüsünden arkadaşını e-postasıyla davet et; sonra linki ona gönder (/transceiver katıl <link>).`
}

async function leave($: EngineInterface, name: string): Promise<string> {
  const rooms = await loadRooms($)
  const room = rooms.find(r => r.title.endsWith(name) || r.url === name)
  if (room === undefined) return `Oda bulunamadı: ${name}`
  stopRoom(room.id)
  await saveRooms($, rooms.map(r => (r.id === room.id ? { ...r, status: 'left' as const } : r)))
  return `${room.title} odasından çıkıldı.`
}

async function run($: EngineInterface, cmd: Cmd): Promise<string | null> {
  if (cmd.verb === 'open' || cmd.verb === 'ayarlar' || cmd.verb === 'kur') {
    await openPane($)
    return null
  }
  if (cmd.verb === 'ekle') return addRoom($, 'dm')
  if (cmd.verb === 'proje') return isRepo(cmd.arg) ? addRoom($, 'project', cmd.arg) : 'Kullanım: /transceiver proje <sahip/repo>'
  if (cmd.verb === 'cik') return leave($, cmd.arg)
  if (cmd.verb === 'katil') return joinRoom($, cmd.arg)
  return HELP
}

export function wireCommands(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'Arkadaşlarınla ve agent\'larla Claude içinde yazış', argumentHint: '[ekle | proje <repo> | katıl <link> | çık <oda> | kur | ayarlar]', immediate: true })
    return next(e)
  })
  on('command.run', { command: COMMAND }, async ($, e) => {
    const text = await run($, parseCommand(e.args))
    return text === null ? {} : { text }
  })
}
```

- [ ] **Step 4: Wire in `register.tsx`**

```tsx
import type { Register } from 'claude-code'
import { wireCommands } from './commands'
import { startLoop } from './room-loop'

export const register: Register = on => {
  wireCommands(on)
  on('session.start', async ($, e, next) => {
    await startLoop($)
    return next(e)
  })
}
```

- [ ] **Step 5: Test, validate, commit**

Run: `claude plugin test . && claude plugin validate .`
Expected: PASS.
```bash
git add hooks/commands.ts hooks/join.ts hooks/register.tsx tests/commands.test.ts
git commit -m "feat(commands): add /transceiver with room, join and leave verbs" -m "Joining by link covers friends in another organization, whose invites the shared list omits." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
