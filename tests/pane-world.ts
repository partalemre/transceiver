// The engine around the real plugin for pane tests: a store holding rooms and their sync states, a clock, a room
// database, the theme, and the pane's own nouns (panes, toast, status, clipboard), each recorded.
import { mock } from 'claude-code/testing'

import type { CallResult } from '../hooks/host'
import type { RoomRecord } from '../hooks/rooms'
import type { RoomSync } from '../hooks/sync'
import { callerFor, fakeDb, type FakeDb } from './fake-db'
import { ME, NAMES, NOW } from './pane-fixtures'

export type WorldOpts = {
  rooms?: RoomRecord[]
  syncs?: Record<string, RoomSync>
  isLight?: boolean
  isShown?: boolean
  // Answers the Artifact tool (publish, list); the default publishes and lists nothing.
  artifact?: (input: Record<string, unknown>) => CallResult
  // More store entries, as other parts of the mod keep them (drafts, settings).
  extra?: Record<string, unknown>
  // The session's git `origin` (`git remote get-url origin`); absent, the session has no repo.
  remote?: string
  // The interface in English (no MODZ_LANG); the other pane tests read the Turkish one.
  isEnglish?: boolean
  // Where the clock starts; NOW by default.
  now?: number
}

export type World = {
  store: Record<string, unknown>
  db: FakeDb
  dbOf: (url: string) => FakeDb
  toasts: string[]
  statuses: Array<string | undefined>
  copies: string[]
  logs: string[]
  opens: unknown[]
  runs: string[][]
  calls: Record<string, unknown>[]
  clock: ReturnType<typeof mock.clock>
  shown: { isShown: boolean }
}

const clone = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)) as unknown)
const ROOM_URL = 'https://claude.ai/artifact/NEWROOM1x'
const publishAnswer = (input: Record<string, unknown>): CallResult =>
  input.action === 'publish' ? { result: { url: ROOM_URL }, text: `Published at ${ROOM_URL}` } : { result: { artifacts: [] }, text: '' }

// A tool.call answer as core gives it: `{ result, text, isError? }`, or `{ deny }`.
const asToolResult = (out: CallResult) =>
  (out.deny !== undefined ? { deny: out.deny } : { result: out.result ?? {}, text: out.text ?? '', ...(out.isError === true ? { isError: true } : {}) }) as never

function profiles(input: Record<string, unknown>): CallResult {
  const ids = (input.ids as string[] | undefined) ?? []
  const found = Object.fromEntries(ids.filter(id => id in NAMES).map(id => [id, { name: NAMES[id as keyof typeof NAMES] }]))
  return { result: { db_profiles: { ids, profiles: found } }, text: '' }
}

// One database per mailbox: the person's own, holding their head at the stored sync state's version, so the first
// polls change nothing they should not; and an empty one for each other member's.
function roomDbs(o: WorldOpts): Map<string, FakeDb> {
  const dbs = new Map<string, FakeDb>()
  for (const room of o.rooms ?? []) {
    const db = fakeDb(ME)
    const sync = o.syncs?.[room.id]
    if (sync !== undefined) db.docs.set(`outbox/${ME}`, { data: sync.ownHead, version: sync.ownVersion })
    dbs.set(room.url, db)
    for (const box of room.boxes) dbs.set(box, fakeDb(ME))
  }
  return dbs
}

// Every command succeeds with no output, but `git remote get-url origin`, which names the session's repo if any.
function runAnswer(argv: string[], remote: string | undefined) {
  if (!argv.includes('get-url')) return { exitCode: 0, stdout: '', stderr: '' }
  return { exitCode: remote === undefined ? 2 : 0, stdout: remote === undefined ? '' : `${remote}\n`, stderr: '' }
}

export function paneWorld(on: any, o: WorldOpts = {}): World {
  const dbs = roomDbs(o)
  const db = fakeDb(ME)
  const dbOf = (url: unknown) => dbs.get(String(url)) ?? db
  const store: Record<string, unknown> = { 'tx.rooms': o.rooms ?? [] }
  for (const [id, sync] of Object.entries(o.syncs ?? {})) store[`tx.sync.${id}`] = sync
  Object.assign(store, o.extra ?? {})
  // The store in the open, so a test reads what the plugin saved.
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: clone(store[e.key]) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => { store[e.key] = clone(e.value); return { value: undefined } })
  on('store.delete', (_$: unknown, e: { key: string }) => { delete store[e.key]; return { value: undefined } })
  mock.env(on, { HOME: '/home/u', ...(o.isEnglish === true ? {} : { MODZ_LANG: 'tr' }) })
  const clock = mock.clock(on, { now: o.now ?? NOW })
  const world: World = { store, db, dbOf, toasts: [], statuses: [], copies: [], logs: [], opens: [], runs: [], calls: [], clock, shown: { isShown: o.isShown ?? true } }
  on('config.list', () => ({ value: [{ key: 'theme', value: o.isLight === true ? 'light' : 'dark' }] }))
  on('command.register', (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/w' }))
  on('classic.SessionStart', () => ({}))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.open', (_$: unknown, e: unknown) => { world.opens.push(e); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: [{ id: 'transceiver', title: 'Transceiver', isShown: world.shown.isShown, isFocused: false, isPlaced: true }] }))
  on('ui.log', (_$: unknown, e: { text: string }) => { world.logs.push(e.text); return { value: undefined } })
  on('ui.toast', (_$: unknown, e: { text: string }) => { world.toasts.push(e.text); return { value: undefined } })
  on('ui.status', (_$: unknown, e: { text?: string }) => { world.statuses.push(e.text); return { value: undefined } })
  on('ui.copy', (_$: unknown, e: { text: string }) => { world.copies.push(e.text); return { value: { isCopied: true } } })
  on('fs.write', () => ({ value: undefined }))
  on('fs.stat', (_$: unknown, e: { path: string }) => ({ value: { kind: e.path.endsWith('.html') ? 'file' : 'dir', size: 0, mtimeMs: 0, isLink: false } }))
  on('process.run', (_$: unknown, e: { argv: string[] }) => { world.runs.push(e.argv); return { value: runAnswer(e.argv, o.remote) } })
  on('tool.call', async (_$: unknown, e: Record<string, unknown>) => {
    world.calls.push(e)
    if (e.tool === 'Artifact') return asToolResult((o.artifact ?? publishAnswer)(e))
    if (e.action === 'profiles') return asToolResult(profiles(e))
    return asToolResult(await callerFor(dbOf(e.url))(e))
  })
  return world
}

export const paneProps = (columns: number) =>
  ({ title: 'Transceiver', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { top: 0, bodyRows: 60 } }) as never

// Starts the session (optionally with permissions bypassed, which connects it) and lets the first polls run.
export async function startSession($: any, w: World, opts: { isBypass?: boolean; surface?: string } = {}): Promise<void> {
  await $.session.start({ surface: opts.surface ?? 'desktop', isInteractive: true, cwd: '/w' })
  if (opts.isBypass === true) await $.classic.SessionStart({ source: 'startup', permission_mode: 'bypassPermissions' })
  await w.clock.settle()
}

export async function mountPane($: any, opts: { surface: 'desktop' | 'terminal'; columns: number }) {
  return $.ui.mount({
    plugin: 'transceiver', surface: opts.surface, component: 'Pane', requestId: 'transceiver',
    props: paneProps(opts.columns), viewport: { columns: opts.columns, rows: 60, isFullscreen: true },
  })
}
