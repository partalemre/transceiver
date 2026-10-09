// The pane's model from the stored rooms and the live sync states: pure, so every state of the pane is testable
// without the engine.
import { lastCheck } from './gate'
import { isUnreadable } from './protocol'
import type { RoomRecord, Settings } from './rooms'
import type { Created, Draft, EmptyForm, GhAsk, PaneModel, PaneView, RoomView } from './state-types'
import { EMPTY_PANE } from './state-types'
import type { RoomSync } from './sync'
import { unreadCount } from './timeline'
import { firstName } from './tr'
import { dividerOf, linesOf, nameOf, previewOf, receiptFor, waitingOf } from './view-lines'
import { gateBadge, peerHeadOf, peerUids, projectInfo, type RoomSources } from './view-room'

export { previewOf, SELF_NAME, SOMEONE } from './view-lines'

// What the pane remembers for this session only: where the person is and what they just did.
export type SessionUi = {
  activeId: string | null
  view: PaneView
  error: string | null
  busy: string | null
  created: Created | null
  composerKey: number
  isConnectDismissed: boolean
  // The newest message id the person has had on screen per room, so a room they read shows no unread count
  // even before this session may write its read mark.
  localRead: Record<string, string>
  // The read mark the open room had when it was opened: where "n yeni mesaj" goes.
  openedMark: { roomId: string; mark: string } | null
  expanded: string[]
  // The composer: a query type the field is set to, the menu of every query, and a one-line hint under it.
  composeMode: { roomId: string; type: string } | null
  sheetRoom: string | null
  hint: string | null
  // What the person asked to see beyond the default: one of the empty state's fields, a room's details.
  emptyForm: EmptyForm | null
  infoRoom: string | null
}

export const EMPTY_SESSION: SessionUi = {
  activeId: null, view: 'rooms', error: null, busy: null, created: null, composerKey: 0,
  isConnectDismissed: false, localRead: {}, openedMark: null, expanded: [],
  composeMode: null, sheetRoom: null, hint: null, emptyForm: null, infoRoom: null,
}

export type ModelInput = RoomSources & {
  rooms: RoomRecord[]
  syncs: Record<string, RoomSync>
  names: Record<string, string>
  settings: Settings
  session: SessionUi
  isConnected: boolean
  drafts?: Draft[]
  canSettleDrafts?: boolean
  now: number
}

function titleOf(room: RoomRecord, sync: RoomSync | undefined, names: Record<string, string>): string {
  if (room.kind === 'project') return room.repo ?? room.title
  const [peer] = peerUids(sync)
  if (peer !== undefined) return nameOf(names, peer)
  return room.boxes.length === 0 ? 'Davet bekleniyor' : 'DM'
}

export const readMarkOf = (sync: RoomSync, local: string | undefined): string =>
  (local !== undefined && local > sync.ownHead.readUpTo ? local : sync.ownHead.readUpTo)

function lastOf(room: RoomRecord, sync: RoomSync | undefined, input: ModelInput) {
  const last = sync?.entries.at(-1)
  const isMine = last !== undefined && last.author === sync?.selfUid
  return {
    lastText: last === undefined ? '' : previewOf(last.message),
    lastTs: last === undefined || isUnreadable(last.message) ? room.joinedAt : last.message.ts,
    lastIsMine: isMine,
    lastReceipt: isMine && sync !== undefined && last !== undefined ? receiptFor(last, sync, input.settings.isReceiptsOn) : undefined,
  }
}

function roomView(room: RoomRecord, input: ModelInput): RoomView {
  const sync = input.syncs[room.id]
  const [peer] = peerUids(sync)
  const project = room.kind === 'project' ? projectInfo({ room, sync, src: { ...input, checkOf: input.checkOf ?? lastCheck }, now: input.now }) : undefined
  const unread = sync === undefined ? 0
    : unreadCount({ entries: sync.entries, selfUid: sync.selfUid, readUpTo: readMarkOf(sync, input.session.localRead[room.id]) })
  const head = peerHeadOf(sync)
  return {
    id: room.id, url: room.url, title: titleOf(room, sync, input.names), kind: room.kind, repo: room.repo, isLive: room.isLive,
    gate: project === undefined ? 'unknown' : gateBadge(project.checks),
    ghLogin: project?.checks.isConfirmed === true ? project.checks.login : undefined,
    seed: room.kind === 'project' ? room.repo ?? room.id : peer ?? room.id,
    unread, isTroubled: (sync?.failures ?? 0) > 0, isBoxBlocked: (sync?.unread.length ?? 0) > 0,
    isWaiting: room.kind === 'dm' && room.boxes.length === 0 && peer === undefined,
    ...lastOf(room, sync, input),
    ...(peer === undefined ? {} : { peerName: firstName(nameOf(input.names, peer)) }),
    peerSeenTs: head.seenTs, peerReadTs: input.settings.isReceiptsOn ? head.readTs : 0,
    ...(project === undefined ? {} : { project }),
  }
}

// What the gate last heard from GitHub about a login, per active project room it shares with this person.
function reposOf(input: ModelInput, uid: string, gh: string): NonNullable<GhAsk['repos']> {
  const checkOf = input.checkOf ?? lastCheck
  return input.rooms
    .filter(r => r.status === 'active' && r.kind === 'project' && r.repo !== undefined && input.syncs[r.id]?.peers[uid] !== undefined)
    .flatMap(r => {
      const hit = checkOf(r.repo ?? '', gh)
      return hit === undefined ? [] : [{ repo: r.repo ?? '', isCollaborator: hit.isOk }]
    })
}

// A login a peer published that the person has not answered yet: asked once per login, yes or no.
function ghAskOf(input: ModelInput): GhAsk | null {
  for (const room of input.rooms) {
    const sync = input.syncs[room.id]
    if (room.status !== 'active' || sync === undefined) continue
    for (const uid of peerUids(sync)) {
      const gh = sync.peers[uid]?.gh
      const peer = room.peers.find(p => p.uid === uid)
      if (gh === undefined || peer?.gh === gh) continue
      const repos = reposOf(input, uid, gh)
      return { roomId: room.id, uid, gh, name: nameOf(input.names, uid), ...(repos.length > 0 ? { repos } : {}) }
    }
  }
  return null
}

function viewOf(session: SessionUi, activeId: string | null): PaneView {
  return session.view === 'chat' && activeId === null ? 'rooms' : session.view
}

function chatOf(input: ModelInput, activeId: string | null): Pick<PaneModel, 'lines' | 'divider'> {
  const room = input.rooms.find(r => r.id === activeId)
  const sync = activeId === null ? undefined : input.syncs[activeId]
  if (room === undefined || sync === undefined) return { lines: [], divider: null }
  const opened = input.session.openedMark
  const mark = opened?.roomId === activeId ? opened.mark : readMarkOf(sync, input.session.localRead[room.id])
  const lines = linesOf({ room, sync, names: input.names, isReceiptsOn: input.settings.isReceiptsOn, rooms: input.rooms, syncs: input.syncs })
  return { lines, divider: dividerOf(sync, mark) }
}

function composerOf(session: SessionUi, activeId: string | null): Pick<PaneModel, 'composeMode' | 'isSheetOpen' | 'hint' | 'isInfoOpen'> {
  const isHere = (roomId: string | undefined) => activeId !== null && roomId === activeId
  return {
    composeMode: isHere(session.composeMode?.roomId) ? session.composeMode?.type ?? null : null,
    isSheetOpen: isHere(session.sheetRoom ?? undefined), hint: session.hint, isInfoOpen: isHere(session.infoRoom ?? undefined),
  }
}

export function buildModel(input: ModelInput): PaneModel {
  const active = input.rooms.filter(r => r.status === 'active')
  const rooms = active.map(r => roomView(r, input)).sort((a, b) => b.lastTs - a.lastTs)
  const activeId = rooms.some(r => r.id === input.session.activeId) ? input.session.activeId : null
  const hasSynced = active.some(r => input.syncs[r.id] !== undefined)
  return {
    ...EMPTY_PANE,
    rooms, activeId, view: viewOf(input.session, activeId), now: input.now, ...chatOf(input, activeId),
    invites: input.rooms.filter(r => r.status === 'invited')
      .map(r => ({ id: r.id, title: r.title, kind: r.kind, repo: r.repo, url: r.url, joinedAt: r.joinedAt })),
    ghAsk: ghAskOf(input),
    // A draft names its asker by uid; the pane shows the person's name.
    drafts: (input.drafts ?? []).map(d => ({ ...d, asker: nameOf(input.names, d.asker) })),
    canSettleDrafts: input.canSettleDrafts === true,
    isConnected: input.isConnected,
    needsSetup: !input.isConnected && !input.session.isConnectDismissed && hasSynced,
    settings: { isReceiptsOn: input.settings.isReceiptsOn, isToastOn: input.settings.isToastOn, isStatusOn: input.settings.isStatusOn },
    isReceiptsOn: input.settings.isReceiptsOn,
    error: input.session.error, busy: input.session.busy,
    created: input.session.created, composerKey: input.session.composerKey,
    waiting: input.isConnected ? [] : waitingOf(active, input.syncs), expanded: input.session.expanded,
    ...composerOf(input.session, activeId),
    sessionRepo: input.sessionRepo ?? null, emptyForm: input.session.emptyForm,
  }
}
