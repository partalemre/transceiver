import { fence, newNonce } from './ask'
import { sameName } from './gate'
import { repoHere } from './here'
import type { AgentHost } from './host'
import { isGitUrl } from './gitbox'
import { LIVE_COOLDOWN_MS, LIVE_HOURLY_MAX, LIVE_MAX_CHARS } from './limits'
import { isUnreadable } from './protocol'
import { onTick, type TickEvent } from './room-loop'
import { loadRooms, type RoomRecord } from './rooms'
import type { Entry } from './timeline'
import { agentWords } from './words-agent'

// A teammate's line wakes this session (when it is open on that repo and idle), fenced as untrusted data, so two
// people's agents can carry a job on between them. Every wake is a model turn, so it is kept small and rare:
// - in a repo room, a line from the teammate's agent wakes by itself; a person's own chat line does not (it is for
//   the person, and shows on the strip);
// - live mode, per room and off by default, wakes on everything;
// - at most one wake per cooldown and a fixed number an hour, so two agents can never talk each other into a loop.

const WAKE_KINDS = new Set(['agent', 'human', 'answer'])
const AGENT_KINDS = new Set(['agent'])
const CUT = '…'
const HOUR_MS = 60 * 60_000

let isRunning = false
const lastWake = new Map<string, number>()
const wakes = new Map<string, number[]>()

const idle: Array<() => void> = []

export const isTurnRunning = () => isRunning

export function setTurnRunning(is: boolean): void {
  isRunning = is
  if (!is) for (const fn of idle) fn()
}

export function onTurnIdle(fn: () => void): () => void {
  idle.push(fn)
  return () => { idle.splice(idle.indexOf(fn), 1) }
}

export function wakeText(opts: { title: string; entries: readonly Entry[]; nonce: string }): string {
  const lines = opts.entries.flatMap(e => (isUnreadable(e.message) ? [] : [`[${e.message.kind}] ${e.message.text}`]))
  const joined = lines.join('\n')
  const body = joined.length > LIVE_MAX_CHARS ? joined.slice(0, LIVE_MAX_CHARS) + CUT : joined
  const head = agentWords().liveHead(opts.title)
  return `${head}\n${fence(body, opts.nonce)}`
}

// Spike R4: under -p a self-send was not delivered. Try it; when it is not delivered, add the text as a row the model
// reads on its next turn, and tell the person with a toast.
export async function wake(host: AgentHost, text: string): Promise<'sent' | 'noted'> {
  const isSent = await host.sendSelf(text).catch(() => false)
  if (isSent) return 'sent'
  await host.note(text)
  host.toast(agentWords().liveToast)
  return 'noted'
}

const isWakeWorthy = (selfUid: string, kinds: Set<string>) => (e: Entry) =>
  e.author !== selfUid && !isUnreadable(e.message) && kinds.has(e.message.kind)

// Which lines wake in this room: all of them in live mode, the teammate's agent's in a repo room, none otherwise.
function wakeKinds(room: RoomRecord): Set<string> | null {
  if (room.isLive) return WAKE_KINDS
  return isGitUrl(room.url) ? AGENT_KINDS : null
}

function isOverHour(roomId: string, now: number): boolean {
  const recent = (wakes.get(roomId) ?? []).filter(at => now - at < HOUR_MS)
  wakes.set(roomId, recent)
  return recent.length >= LIVE_HOURLY_MAX
}

// At most one wake per room per cooldown, never while a turn runs, never for a room of another repo.
export async function onLiveTick(host: AgentHost, ev: TickEvent): Promise<boolean> {
  if (ev.room.kind !== 'project' || isRunning) return false
  const room = (await loadRooms(host)).find(r => r.id === ev.room.id)
  const kinds = room === undefined || room.status !== 'active' ? null : wakeKinds(room)
  if (room === undefined || kinds === null) return false
  const entries = ev.fresh.filter(isWakeWorthy(ev.state.selfUid, kinds))
  if (entries.length === 0) return false
  if (!sameName(room.repo, await repoHere(host))) return false
  const now = await host.now()
  if (now - (lastWake.get(room.id) ?? Number.NEGATIVE_INFINITY) < LIVE_COOLDOWN_MS) return false
  if (isOverHour(room.id, now)) return false
  lastWake.set(room.id, now)
  wakes.set(room.id, [...(wakes.get(room.id) ?? []), now])
  await wake(host, wakeText({ title: room.title, entries, nonce: newNonce(now) }))
  return true
}

export function wireLive(host: AgentHost): () => void {
  return onTick(ev => onLiveTick(host, ev).then(() => undefined, () => undefined))
}
