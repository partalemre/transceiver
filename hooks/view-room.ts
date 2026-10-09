// What a room shows beyond its messages: the peer's head (when they were last here, when they last read) and, for a
// project room, the gate's four conditions, the day's ask budget and what this machine answered today. Pure.
import { sameName } from './gate'
import { ASK_DAILY_LIMIT } from './limits'
import { isUnreadable } from './protocol'
import type { RoomRecord } from './rooms'
import type { DayCounts, GateBadge, GateChecks, ProjectInfo } from './state-types'
import type { RoomSync } from './sync'
import { dayKey } from './when'

export type CheckOf = (repo: string, login: string) => { isOk: boolean; at: number } | undefined

// Read besides the rooms: the session's repo (undefined while unknown, null when it has none), the asks each room
// spent today, and the gate's last GitHub answers.
export type RoomSources = { sessionRepo?: string | null; askUsed?: Record<string, number>; checkOf?: CheckOf }

export const peerUids = (sync: RoomSync | undefined): string[] =>
  Object.keys(sync?.peers ?? {}).filter(uid => uid !== sync?.selfUid)

export function gateChecks(room: RoomRecord, sync: RoomSync | undefined, src: RoomSources): GateChecks {
  const peer = room.peers.find(p => p.isGhConfirmed && p.gh !== undefined)
  const login = peer?.gh
  const isConfirmed = peer !== undefined && login !== undefined && sameName(login, sync?.peers[peer.uid]?.gh)
  const hit = isConfirmed && room.repo !== undefined && login !== undefined ? src.checkOf?.(room.repo, login) : undefined
  return {
    isConfirmed, login, isCollaborator: hit?.isOk ?? null, checkedAt: hit?.at ?? null,
    isSessionRepo: src.sessionRepo === undefined ? null : sameName(src.sessionRepo, room.repo),
  }
}

// Open only when all four hold, closed when one fails, unknown while GitHub or the session's repo is not known.
export function gateBadge(c: GateChecks): GateBadge {
  if (!c.isConfirmed || c.isCollaborator === false || c.isSessionRepo === false) return 'closed'
  return c.isCollaborator === true && c.isSessionRepo === true ? 'open' : 'unknown'
}

type Today = { counts: DayCounts; queries: number }

// Today's agent traffic: every query in the room, and the answers this machine wrote (a split answer once).
export function todayOf(sync: RoomSync | undefined, now: number): Today {
  const start = dayKey(now)
  const today: Today = { counts: { answered: 0, modelless: 0, denied: 0 }, queries: 0 }
  for (const e of sync?.entries ?? []) {
    const m = e.message
    if (isUnreadable(m) || m.ts < start) continue
    if (m.kind === 'query') today.queries += 1
    const isOwnAnswer = m.kind === 'answer' && e.author === sync?.selfUid && (m.answer?.part ?? 1) === 1
    if (!isOwnAnswer) continue
    today.counts.answered += 1
    if (m.answer?.ok === false) today.counts.denied += 1
    else if (m.answer?.tokens === 0) today.counts.modelless += 1
  }
  return today
}

export function projectInfo(o: { room: RoomRecord; sync: RoomSync | undefined; src: RoomSources; now: number }): ProjectInfo {
  const today = todayOf(o.sync, o.now)
  return {
    checks: gateChecks(o.room, o.sync, o.src), askUsed: o.src.askUsed?.[o.room.id] ?? 0, askLimit: ASK_DAILY_LIMIT,
    today: today.counts, queriesToday: today.queries,
  }
}

// The first peer's head: when it last moved (a send or a read mark) and when they last read.
export function peerHeadOf(sync: RoomSync | undefined): { seenTs: number; readTs: number } {
  const [uid] = peerUids(sync)
  const head = uid === undefined ? undefined : sync?.peers[uid]
  return { seenTs: Math.max(head?.headTs ?? 0, head?.readTs ?? 0), readTs: head?.readTs ?? 0 }
}
