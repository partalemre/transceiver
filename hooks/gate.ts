import type { CollabCheck } from './github'
import { COLLAB_CACHE_MS } from './limits'
import type { Query } from './protocol'

// The part of a room record the gate reads; RoomRecord (rooms.ts) satisfies it.
export type GateRoom = {
  kind: 'dm' | 'project'
  repo?: string
  peers: readonly { uid: string; gh?: string; isGhConfirmed: boolean }[]
}
export type GateInput = { room: GateRoom; peerUid: string; query: Query; sessionRepo: string | null; now: number }

export function makeGate(check: CollabCheck): (input: GateInput) => Promise<boolean> {
  const cache = new Map<string, { isOk: boolean; at: number }>()
  return async input => {
    const { room, query } = input
    const isProject = room.kind === 'project' && room.repo === query.repo
    const isSameRepo = input.sessionRepo !== null && input.sessionRepo === query.repo
    const peer = room.peers.find(p => p.uid === input.peerUid)
    if (!isProject || !isSameRepo || peer?.isGhConfirmed !== true || peer.gh === undefined) return false
    const key = `${query.repo}#${peer.gh}`.toLowerCase()
    const hit = cache.get(key)
    if (hit !== undefined && input.now - hit.at <= COLLAB_CACHE_MS) return hit.isOk
    let isOk = false
    try {
      isOk = (await check({ repo: query.repo, login: peer.gh })) === true
    } catch {
      // Unknown means no: a check that cannot run never opens the gate, and is not cached.
      return false
    }
    cache.set(key, { isOk, at: input.now })
    return isOk
  }
}
