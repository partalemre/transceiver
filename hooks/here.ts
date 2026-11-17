import { sameName } from './gate'
import { isGitUrl } from './gitbox'
import { sessionRepo } from './github'
import type { AgentHost } from './host'
import { REPO_CACHE_MS } from './limits'
import type { RoomRecord } from './rooms'

type Memo = { root: string; repo: string | null; at: number }
let memo: Memo | null = null

// The GitHub repo of the session's project root (its `origin`), read again once a minute or when the root moves.
export async function repoHere(host: Pick<AgentHost, 'run' | 'root' | 'now'>): Promise<string | null> {
  const [root, now] = await Promise.all([host.root(), host.now()])
  if (memo !== null && memo.root === root && now - memo.at < REPO_CACHE_MS) return memo.repo
  const repo = await sessionRepo(host.run, root).catch(() => null)
  memo = { root, repo, at: now }
  return repo
}

export const forgetRepo = () => { memo = null }

// Agent traffic only ever reaches an active project room of the session's own repo: never a DM, never another repo.
export function projectRoomFor(rooms: readonly RoomRecord[], repo: string | null): RoomRecord | null {
  if (repo === null) return null
  const here = rooms.filter(r => r.status === 'active' && r.kind === 'project' && sameName(r.repo, repo))
  // The repo's own room first: an older artifact room of the same repo stays readable but no longer takes the traffic.
  return here.find(r => isGitUrl(r.url)) ?? here[0] ?? null
}
