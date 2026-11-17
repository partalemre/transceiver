// Who else is on the session's repo, for a status strip outside this mod (MODZ's session strip reads it from the
// `team` state): the teammates with a mailbox in the repo's room, when each last worked and on which branch, and
// the newest line one of them or their agent wrote. Null while nobody else is there. No clock in it: the reader
// decides what "now" is, so the value moves only when the room does.
import type { TeamLine } from '../types'
import { repoRoomOf } from './gitroom'
import { isUnreadable } from './protocol'
import type { RoomRecord } from './rooms'
import type { RoomSync } from './sync'
import { unreadCount } from './timeline'
import { firstName } from './tr'
import { nameOf, previewOf } from './view-lines'
import { peerUids } from './view-room'

const MAX_MATES = 3
const MAX_PREVIEW_CHARS = 120
const AGENT_KINDS = new Set(['agent', 'query', 'answer'])

type Opts = { rooms: readonly RoomRecord[]; syncs: Record<string, RoomSync>; names: Record<string, string>; repo: string | null | undefined; readMark: (sync: RoomSync, roomId: string) => string }

function lastOf(sync: RoomSync, names: Record<string, string>): TeamLine['last'] {
  const theirs = sync.entries.filter(e => e.author !== sync.selfUid && !isUnreadable(e.message))
  const entry = theirs.at(-1)
  if (entry === undefined || isUnreadable(entry.message)) return null
  const { message } = entry
  return {
    id: message.id, name: firstName(nameOf(names, entry.author)), text: previewOf(message).slice(0, MAX_PREVIEW_CHARS),
    ts: message.ts, isAgent: AGENT_KINDS.has(message.kind),
  }
}

export function teamOf(o: Opts): TeamLine | null {
  const room = typeof o.repo === 'string' ? repoRoomOf(o.rooms, o.repo) : undefined
  const sync = room === undefined ? undefined : o.syncs[room.id]
  if (room === undefined || room.status !== 'active' || sync === undefined) return null
  const mates = peerUids(sync).map(key => {
    const head = sync.peers[key]
    const at = Math.max(head?.at ?? 0, head?.headTs ?? 0, head?.readTs ?? 0)
    return { name: firstName(nameOf(o.names, key)), at, ...(head?.branch === undefined ? {} : { branch: head.branch }) }
  }).sort((a, b) => b.at - a.at).slice(0, MAX_MATES)
  if (mates.length === 0) return null
  const unread = unreadCount({ entries: sync.entries, selfUid: sync.selfUid, readUpTo: o.readMark(sync, room.id) })
  return { roomId: room.id, repo: room.repo ?? '', mates, last: lastOf(sync, o.names), unread }
}
