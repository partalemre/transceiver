// The pane's model from the stored rooms and the live sync states: pure, so every state of the pane is testable
// without the engine.
import { PREVIEW_CHARS } from './limits'
import { isUnreadable } from './protocol'
import type { Message, Unreadable } from './protocol'
import type { RoomRecord, Settings } from './rooms'
import type { Created, Draft, GhAsk, Line, PaneModel, PaneView, RoomView } from './state-types'
import { EMPTY_PANE } from './state-types'
import type { RoomSync } from './sync'
import { receiptOf, unreadCount, type Entry } from './timeline'

export const SELF_NAME = 'sen'
export const SOMEONE = 'Biri'

// What the pane remembers for this session only: where the person is and what they just did.
export type SessionUi = {
  activeId: string | null
  view: PaneView
  error: string | null
  busy: string | null
  created: Created | null
  composerKey: number
  isConnectDismissed: boolean
  latencyMs: number | null
  // The newest message id the person has had on screen per room, so a room they read shows no unread count
  // even before this session may write its read mark.
  localRead: Record<string, string>
}

export const EMPTY_SESSION: SessionUi = {
  activeId: null, view: 'rooms', error: null, busy: null, created: null, composerKey: 0,
  isConnectDismissed: false, latencyMs: null, localRead: {},
}

export type ModelInput = {
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

const nameOf = (names: Record<string, string>, uid: string) => names[uid] || SOMEONE
const peerUids = (sync: RoomSync | undefined) => Object.keys(sync?.peers ?? {}).filter(uid => uid !== sync?.selfUid)

function titleOf(room: RoomRecord, sync: RoomSync | undefined, names: Record<string, string>): string {
  if (room.kind === 'project') return room.repo ?? room.title
  const [peer] = peerUids(sync)
  if (peer !== undefined) return nameOf(names, peer)
  return room.isOwner ? 'Davet bekleniyor' : 'DM'
}

// One line of preview: a query shows as the question, an answer as a reply, an unreadable doc as such.
export function previewOf(message: Message | Unreadable): string {
  if (isUnreadable(message)) return 'okunamayan mesaj'
  const first = (text: string) => text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
  const flat = message.kind === 'query' ? `Soru: ${first(message.query?.question ?? message.query?.path ?? message.text)}`
    : message.kind === 'answer' ? `Cevap: ${message.answer?.ok === false ? 'erişim yok' : first(message.answer?.body ?? message.text)}`
      : first(message.text)
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat
}

const readMarkOf = (sync: RoomSync, local: string | undefined) =>
  (local !== undefined && local > sync.ownHead.readUpTo ? local : sync.ownHead.readUpTo)

function receiptFor(entry: Entry, sync: RoomSync, isReceiptsOn: boolean) {
  const peers = peerUids(sync).map(uid => sync.peers[uid]).filter(h => h !== undefined)
  return receiptOf({ entry, selfUid: sync.selfUid, peers, isReceiptsOn })
}

function roomView(room: RoomRecord, input: ModelInput): RoomView {
  const sync = input.syncs[room.id]
  const last = sync?.entries.at(-1)
  const [peer] = peerUids(sync)
  const confirmed = room.peers.find(p => p.isGhConfirmed && p.gh !== undefined)
  const unread = sync === undefined ? 0
    : unreadCount({ entries: sync.entries, selfUid: sync.selfUid, readUpTo: readMarkOf(sync, input.session.localRead[room.id]) })
  return {
    id: room.id, url: room.url, title: titleOf(room, sync, input.names), kind: room.kind, repo: room.repo, isLive: room.isLive,
    gate: room.kind !== 'project' ? 'unknown' : confirmed === undefined ? 'closed' : 'open',
    ghLogin: room.kind === 'project' ? confirmed?.gh : undefined,
    seed: room.kind === 'project' ? room.repo ?? room.id : peer ?? room.id,
    unread, isTroubled: (sync?.failures ?? 0) > 0,
    isWaiting: room.kind === 'dm' && room.isOwner && peer === undefined,
    lastText: last === undefined ? '' : previewOf(last.message),
    lastTs: last === undefined || isUnreadable(last.message) ? room.joinedAt : last.message.ts,
    lastIsMine: last !== undefined && last.author === sync?.selfUid,
    lastReceipt: last !== undefined && last.author === sync?.selfUid && sync !== undefined
      ? receiptFor(last, sync, input.settings.isReceiptsOn) : undefined,
  }
}

function linesOf(sync: RoomSync, input: ModelInput): Line[] {
  return sync.entries.map(entry => {
    const isMine = entry.author === sync.selfUid
    return {
      id: entry.message.id, message: entry.message, isMine, authorUid: entry.author, seed: entry.author,
      authorName: isMine ? SELF_NAME : nameOf(input.names, entry.author),
      receipt: isMine ? receiptFor(entry, sync, input.settings.isReceiptsOn) : undefined,
    }
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
      if (gh !== undefined && peer?.gh !== gh) return { roomId: room.id, uid, gh, name: nameOf(input.names, uid) }
    }
  }
  return null
}

function viewOf(session: SessionUi, activeId: string | null): PaneView {
  return session.view === 'chat' && activeId === null ? 'rooms' : session.view
}

export function buildModel(input: ModelInput): PaneModel {
  const active = input.rooms.filter(r => r.status === 'active')
  const rooms = active.map(r => roomView(r, input)).sort((a, b) => b.lastTs - a.lastTs)
  const activeId = rooms.some(r => r.id === input.session.activeId) ? input.session.activeId : null
  const sync = activeId === null ? undefined : input.syncs[activeId]
  const hasSynced = active.some(r => input.syncs[r.id] !== undefined)
  return {
    ...EMPTY_PANE,
    rooms, activeId, view: viewOf(input.session, activeId), now: input.now,
    lines: sync === undefined ? [] : linesOf(sync, input),
    invites: input.rooms.filter(r => r.status === 'invited').map(r => ({ id: r.id, title: r.title, kind: r.kind, repo: r.repo })),
    ghAsk: ghAskOf(input),
    drafts: input.drafts ?? [], canSettleDrafts: input.canSettleDrafts === true,
    isConnected: input.isConnected,
    needsSetup: !input.isConnected && !input.session.isConnectDismissed && hasSynced,
    settings: { isReceiptsOn: input.settings.isReceiptsOn, isToastOn: input.settings.isToastOn, isStatusOn: input.settings.isStatusOn },
    isReceiptsOn: input.settings.isReceiptsOn,
    latencyMs: input.session.latencyMs, error: input.session.error, busy: input.session.busy,
    created: input.session.created, composerKey: input.session.composerKey,
  }
}
