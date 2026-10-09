import type { CollabCheck } from './github'
import { COLLAB_CACHE_MS } from './limits'
import type { Query } from './protocol'

// The part of a room record the gate reads; RoomRecord (rooms.ts) satisfies it.
export type GateRoom = {
  kind: 'dm' | 'project'
  repo?: string
  peers: readonly { uid: string; gh?: string; isGhConfirmed: boolean }[]
}
// `headGh` is the login the peer's head announces now: a confirmation names one login, so a head that later
// claims another (a collaborator's, say) does not inherit it.
export type GateInput = {
  room: GateRoom; peerUid: string; query: Query; sessionRepo: string | null; headGh: string | undefined; now: number
}

// GitHub owner, repo and login names are case-insensitive.
export const sameName = (a: string | null | undefined, b: string | null | undefined): boolean =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

function confirmedLogin(input: GateInput): string | null {
  const { room, query } = input
  const isProject = room.kind === 'project' && sameName(room.repo, query.repo)
  const isSameRepo = sameName(input.sessionRepo, query.repo)
  const peer = room.peers.find(p => p.uid === input.peerUid)
  if (!isProject || !isSameRepo || peer?.isGhConfirmed !== true || peer.gh === undefined) return null
  return sameName(peer.gh, input.headGh) ? peer.gh : null
}

export function makeGate(check: CollabCheck): (input: GateInput) => Promise<boolean> {
  const cache = new Map<string, { isOk: boolean; at: number }>()
  return async input => {
    const login = confirmedLogin(input)
    if (login === null) return false
    const repo = input.query.repo
    const key = `${repo}#${login}`.toLowerCase()
    const hit = cache.get(key)
    if (hit !== undefined && input.now - hit.at <= COLLAB_CACHE_MS) return hit.isOk
    let isOk = false
    try {
      isOk = (await check({ repo, login })) === true
    } catch {
      // Unknown means no: a check that cannot run never opens the gate, and is not cached.
      return false
    }
    cache.set(key, { isOk, at: input.now })
    return isOk
  }
}
