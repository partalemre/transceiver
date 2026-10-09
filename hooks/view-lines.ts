// The open chat's lines: names, receipts, the message a reply quotes, a shared project room a DM names, and where
// the "n yeni mesaj" divider goes. Pure.
import { PREVIEW_CHARS } from './limits'
import { isUnreadable } from './protocol'
import type { Message, Unreadable } from './protocol'
import type { RoomRecord } from './rooms'
import type { Line, PaneModel } from './state-types'
import type { RoomSync } from './sync'
import { receiptOf, type Entry } from './timeline'
import { peerUids } from './view-room'

export const SELF_NAME = 'sen'
export const SOMEONE = 'Biri'
// How a quote names the person's own message.
const SELF_QUOTE = 'Sen'

export const nameOf = (names: Record<string, string>, uid: string): string => names[uid] || SOMEONE

// One line of preview: a query shows as the question, an answer as a reply, an unreadable doc as such.
export function previewOf(message: Message | Unreadable): string {
  if (isUnreadable(message)) return 'okunamayan mesaj'
  const first = (text: string) => text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
  const flat = message.kind === 'query' ? `Soru: ${first(message.query?.question ?? message.query?.path ?? message.text)}`
    : message.kind === 'answer' ? `Cevap: ${message.answer?.ok === false ? 'erişim yok' : first(message.answer?.body ?? message.text)}`
      : first(message.text)
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat
}

export function receiptFor(entry: Entry, sync: RoomSync, isReceiptsOn: boolean) {
  const peers = peerUids(sync).map(uid => sync.peers[uid]).filter(h => h !== undefined)
  return receiptOf({ entry, selfUid: sync.selfUid, peers, isReceiptsOn })
}

export type LinesInput = {
  room: RoomRecord
  sync: RoomSync
  names: Record<string, string>
  isReceiptsOn: boolean
  rooms: RoomRecord[]
  syncs: Record<string, RoomSync>
}

function replyOf(entry: Entry, byId: Map<string, Entry>, o: LinesInput): Line['replyTo'] {
  const id = isUnreadable(entry.message) ? undefined : entry.message.replyTo
  const target = id === undefined ? undefined : byId.get(id)
  if (target === undefined) return undefined
  return { name: target.author === o.sync.selfUid ? SELF_QUOTE : nameOf(o.names, target.author), text: previewOf(target.message) }
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const names = (repo: string) => [repo, repo.split('/')[1] ?? repo].map(n => new RegExp(`(^|[^\\p{L}\\p{N}_/-])${escapeRe(n)}($|[^\\p{L}\\p{N}_-])`, 'iu'))

// A project room both sides of the DM are in, named in the message by its repo ("eliti" or "partalemre/eliti").
function roomLinkOf(entry: Entry, o: LinesInput): Line['roomLink'] {
  const m = entry.message
  if (o.room.kind !== 'dm' || isUnreadable(m) || m.kind !== 'human') return undefined
  const [peer] = peerUids(o.sync)
  const shared = o.rooms.filter(r => r.status === 'active' && r.kind === 'project' && r.repo !== undefined)
    .filter(r => peer !== undefined && (r.peers.some(p => p.uid === peer) || o.syncs[r.id]?.peers[peer] !== undefined))
  const hit = shared.find(r => names(r.repo ?? '').some(re => re.test(m.text)))
  return hit === undefined || hit.repo === undefined ? undefined : { roomId: hit.id, repo: hit.repo }
}

export function linesOf(o: LinesInput): Line[] {
  const { sync } = o
  const byId = new Map(sync.entries.map(e => [e.message.id, e]))
  return sync.entries.map(entry => {
    const isMine = entry.author === sync.selfUid
    const replyTo = replyOf(entry, byId, o)
    const roomLink = roomLinkOf(entry, o)
    return {
      id: entry.message.id, message: entry.message, isMine, authorUid: entry.author, seed: entry.author,
      authorName: isMine ? SELF_NAME : nameOf(o.names, entry.author),
      receipt: isMine ? receiptFor(entry, sync, o.isReceiptsOn) : undefined,
      ...(replyTo === undefined ? {} : { replyTo }),
      ...(roomLink === undefined ? {} : { roomLink }),
    }
  })
}

// The peer messages past the read mark the room had when it was opened: the divider stays while it is open.
export function dividerOf(sync: RoomSync, mark: string): PaneModel['divider'] {
  const unread = sync.entries.filter(e => e.author !== sync.selfUid && e.message.id > mark)
  const first = unread[0]
  return first === undefined ? null : { id: first.message.id, count: unread.length }
}

// What waits for "Bağlan": every room's queued messages, oldest first.
export function waitingOf(rooms: RoomRecord[], syncs: Record<string, RoomSync>): string[] {
  return rooms.flatMap(r => syncs[r.id]?.pending ?? []).sort((a, b) => a.ts - b.ts).map(m => previewOf(m))
}
