// The pane's live state: the port register.tsx binds at session start (the engine follows `$` into no other file),
// what the person is looking at, and `refreshPane`, which rebuilds the model and hands it to `$.state` for the
// render hook. Any module may call `refreshPane()` after it changed something the pane shows.
import type { RenderSurface } from 'claude-code'

import { askUsedToday } from './budget'
import { isConnected } from './connection'
import type { Host } from './host'
import { hubOf, type HubShown } from './hub'
import { PANE_CLOCK_MS } from './limits'
import { namesNow, resolveNames } from './names'
import { setViewing, syncOf } from './room-loop'
import { loadRooms, loadSettings, type RoomRecord } from './rooms'
import type { Draft, PaneModel } from './state-types'
import type { RoomSync } from './sync'
import { buildModel, EMPTY_SESSION, type SessionUi } from './view'

// What the pane needs of the engine beyond Host; bound from `$` in register.tsx.
export type UiHost = {
  setPane(model: PaneModel): Promise<void>
  // The MODZ hub's line; the port writes it only when it differs from the one written.
  setHub(shown: HubShown): Promise<void>
  isPaneShown(): Promise<boolean>
  toast(text: string): void
  status(text: string | undefined): void
  copy(text: string, surface: RenderSurface): Promise<boolean>
}
export type PanePort = { host: Host; ui: UiHost }
export type DraftSettler = (qid: string, isApproved: boolean) => Promise<boolean>

let port: PanePort | null = null
let session: SessionUi = { ...EMPTY_SESSION }
let isShown = false
let shown = ''
let last: PaneModel | null = null
let draftSource: (() => Promise<Draft[]>) | null = null
let draftSettler: DraftSettler | null = null
let repoSource: (() => Promise<string | null>) | null = null

export const bindPane = (p: PanePort): void => { port = p }
export const portNow = (): PanePort | null => port
export const sessionNow = (): SessionUi => session
export const modelNow = (): PaneModel | null => last
export const isPaneShownNow = (): boolean => isShown

export function patchSession(patch: Partial<SessionUi>): void {
  session = { ...session, ...patch }
  syncViewing()
}

// The agent side (drafts past the daily ask limit) plugs in here, so the pane needs none of its modules.
export const setDraftSource = (fn: () => Promise<Draft[]>): void => { draftSource = fn }
export const setDraftSettler = (fn: DraftSettler): void => { draftSettler = fn }
export const draftSettlerNow = (): DraftSettler | null => draftSettler
// The session's repo (its git `origin`), for the gate checklist; register.tsx binds it.
export const setRepoSource = (fn: () => Promise<string | null>): void => { repoSource = fn }

// Read marks follow what is on screen: the open chat, while the pane is shown.
function syncViewing(): void {
  const room = session.view === 'chat' && isShown ? session.activeId : null
  setViewing(room, isShown)
}

export function setPaneShown(is: boolean): void {
  isShown = is
  syncViewing()
}

function syncsOf(rooms: RoomRecord[]): Record<string, RoomSync> {
  const syncs: Record<string, RoomSync> = {}
  for (const room of rooms) {
    const sync = syncOf(room.id)
    if (sync !== undefined) syncs[room.id] = sync
  }
  return syncs
}

// Names arrive in the background; the pane draws "Biri" until then and redraws once they land.
function askNames(host: Host, rooms: RoomRecord[], syncs: Record<string, RoomSync>): void {
  const known = namesNow()
  for (const room of rooms) {
    const uids = Object.keys(syncs[room.id]?.peers ?? {}).filter(uid => known[uid] === undefined)
    if (uids.length > 0) void resolveNames(host, { url: room.url, uids }).then(() => refreshPane()).catch(() => undefined)
  }
}

function markOnScreen(syncs: Record<string, RoomSync>): void {
  const id = session.activeId
  const newest = id === null ? undefined : syncs[id]?.entries.at(-1)?.message.id
  if (!isShown || session.view !== 'chat' || id === null || newest === undefined) return
  if ((session.localRead[id] ?? '') < newest) session = { ...session, localRead: { ...session.localRead, [id]: newest } }
}

// The model is written only when what it shows changed; `now` moves by the minute (day labels, ages).
export async function refreshPane(): Promise<PaneModel | null> {
  if (port === null) return null
  const { host, ui } = port
  const rooms = await loadRooms(host)
  const syncs = syncsOf(rooms)
  askNames(host, rooms, syncs)
  markOnScreen(syncs)
  const now = Math.floor((await host.now()) / PANE_CLOCK_MS) * PANE_CLOCK_MS
  const drafts = draftSource === null ? [] : await draftSource().catch(() => [])
  const sessionRepo = repoSource === null ? undefined : await repoSource().catch(() => undefined)
  const model = buildModel({
    rooms, syncs, names: namesNow(), settings: await loadSettings(host), session, isConnected: isConnected(),
    drafts, canSettleDrafts: draftSettler !== null, now, sessionRepo, askUsed: await askUsedToday(host).catch(() => ({})),
  })
  const json = JSON.stringify(model)
  last = model
  if (json !== shown) {
    shown = json
    await ui.setPane(model)
  }
  await ui.setHub(hubOf(model.rooms))
  return model
}
