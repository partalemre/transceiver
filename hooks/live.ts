import { fence, newNonce } from './ask'
import { sameName } from './gate'
import { repoHere } from './here'
import type { AgentHost } from './host'
import { LIVE_COOLDOWN_MS, LIVE_MAX_CHARS } from './limits'
import { isUnreadable } from './protocol'
import { onTick, type TickEvent } from './room-loop'
import { loadRooms } from './rooms'
import type { Entry } from './timeline'

// Live mode: per room, off by default, and it costs tokens. A teammate's message to a live project room wakes this
// session (when it is open on that repo and idle) with the message fenced as untrusted data.

const WAKE_KINDS = new Set(['agent', 'human', 'answer'])
const TOAST = 'Transceiver: proje odasında yeni mesaj var'
const CUT = '…'

let isTurnRunning = false
const lastWake = new Map<string, number>()

export const setTurnRunning = (is: boolean) => { isTurnRunning = is }

export function wakeText(opts: { title: string; entries: readonly Entry[]; nonce: string }): string {
  const lines = opts.entries.flatMap(e => (isUnreadable(e.message) ? [] : [`[${e.message.kind}] ${e.message.text}`]))
  const joined = lines.join('\n')
  const body = joined.length > LIVE_MAX_CHARS ? joined.slice(0, LIVE_MAX_CHARS) + CUT : joined
  const head = `Transceiver: ${opts.title} odasına yeni mesaj geldi. Gerekirse mcp__transceiver__inbox ile oku.`
  return `${head}\n${fence(body, opts.nonce)}`
}

// Spike R4: under -p a self-send was not delivered. Try it; when it is not delivered, add the text as a row the model
// reads on its next turn, and tell the person with a toast.
export async function wake(host: AgentHost, text: string): Promise<'sent' | 'noted'> {
  const isSent = await host.sendSelf(text).catch(() => false)
  if (isSent) return 'sent'
  await host.note(text)
  host.toast(TOAST)
  return 'noted'
}

const isWakeWorthy = (selfUid: string) => (e: Entry) =>
  e.author !== selfUid && !isUnreadable(e.message) && WAKE_KINDS.has(e.message.kind)

// At most one wake per room per cooldown, never while a turn runs, never for a room of another repo.
export async function onLiveTick(host: AgentHost, ev: TickEvent): Promise<boolean> {
  if (ev.room.kind !== 'project' || isTurnRunning) return false
  const entries = ev.fresh.filter(isWakeWorthy(ev.state.selfUid))
  if (entries.length === 0) return false
  const room = (await loadRooms(host)).find(r => r.id === ev.room.id)
  if (room === undefined || !room.isLive || room.status !== 'active') return false
  if (!sameName(room.repo, await repoHere(host))) return false
  const now = await host.now()
  if (now - (lastWake.get(room.id) ?? Number.NEGATIVE_INFINITY) < LIVE_COOLDOWN_MS) return false
  lastWake.set(room.id, now)
  await wake(host, wakeText({ title: room.title, entries, nonce: newNonce(now) }))
  return true
}

export function wireLive(host: AgentHost): () => void {
  return onTick(ev => onLiveTick(host, ev).then(() => undefined, () => undefined))
}
