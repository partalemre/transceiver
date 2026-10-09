import { isLogin, ownLogin } from './github'
import type { AgentHost } from './host'
import { LOGIN_RETRY_MS } from './limits'
import { callerOf, relayOf } from './relay'
import { adoptOwnHead, onTick, type TickEvent } from './room-loop'
import { loadRooms, loadSettings } from './rooms'

type Known = { login: string | null; at: number }
let memo: Known | null = null

// The person's GitHub login: the one they set in the settings, else `gh`'s. A miss is not asked again for a while.
async function loginOf(host: AgentHost): Promise<string | null> {
  const set = (await loadSettings(host)).gh
  if (set !== undefined && isLogin(set)) return set
  const now = await host.now()
  if (memo !== null && now - memo.at < LOGIN_RETRY_MS) return memo.login
  const login = await ownLogin(host.run).catch(() => null)
  memo = { login, at: now }
  return login
}

export const forgetLogin = () => { memo = null }

// The only identity transceiver publishes, and only into rooms the person accepted, once the session may write:
// their GitHub login on their own head, merged so no cursor moves. The room is read fresh from this person's own
// store: one left meanwhile, or a room this host does not hold, gets nothing.
export async function shareLogin(host: AgentHost, ev: TickEvent): Promise<boolean> {
  if (ev.isDenied || !host.isConnected()) return false
  const isMine = (await loadRooms(host)).some(r => r.id === ev.room.id && r.url === ev.room.url && r.status === 'active')
  if (!isMine) return false
  const login = await loginOf(host)
  const { state } = ev
  if (login === null || state.ownHead.gh === login) return false
  const known = state.ownVersion > 0 ? { head: state.ownHead, version: state.ownVersion } : undefined
  const own = await relayOf(callerOf(host), ev.room.url).writeHead({ uid: state.selfUid, patch: { gh: login }, known })
  adoptOwnHead(ev.room.id, own)
  return true
}

export function wireIdentity(host: AgentHost): () => void {
  // A failed write is tried again on a later tick; it never stops the room.
  return onTick(ev => shareLogin(host, ev).then(() => undefined, () => undefined))
}
