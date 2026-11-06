import { fence, newNonce } from './ask'
import { deviceLabels, deviceNameOf } from './devices'
import type { AgentHost, Host } from './host'
import { BRIDGE_WAKES_PER_HOUR, HOUR_MS, LIVE_COOLDOWN_MS, LIVE_MAX_CHARS } from './limits'
import { isTurnRunning, onTurnIdle, wake } from './live'
import { isUnreadable, type Message } from './protocol'
import { onTick, type TickEvent } from './room-loop'
import type { RoomRecord } from './rooms'
import { agentWords } from './words-agent'
import { paneWords } from './words-pane'

// The bridge in a session: per computer, it follows the person to the session they last wrote in. There the
// other computer's messages show in the transcript as they arrive and wake the idle session, so two agents can talk
// while the person reads along. Only this account's own mailboxes reach here (devices.ts). The wakes have a ceiling
// per hour, since each is a model turn and two agents could otherwise answer each other for ever.

const LINK_KEY = 'tx.devices.session'
const SHOWN = new Set(['human', 'agent'])
const CUT = '…'

type Link = { session: string; at: number }
type Said = { name: string; text: string }

const waiting: Said[] = []
let lastWake = Number.NEGATIVE_INFINITY
let wakes: number[] = []
let isPauseSaid = false
let isFlushQueued = false

async function linkOf(host: Host): Promise<Link | null> {
  const raw = (await host.storeGet(LINK_KEY)) as Link | null | undefined
  return typeof raw?.session === 'string' && typeof raw.at === 'number' ? raw : null
}

// A session that already holds the bridge keeps its start: a send must not turn what has not been read yet into history.
export async function linkHere(host: Host): Promise<void> {
  const session = await host.sessionId()
  if ((await linkOf(host))?.session !== session) await host.storeSet(LINK_KEY, { session, at: await host.now() })
}

export const isLinkedHere = async (host: Host): Promise<boolean> => (await linkOf(host))?.session === (await host.sessionId())

const whoOf = (kind: string): string => (kind === 'agent' ? 'Claude' : paneWords().you)

const clipped = (text: string): string => (text.length > LIVE_MAX_CHARS ? text.slice(0, LIVE_MAX_CHARS) + CUT : text)

export const bridgeLine = (o: Said & { isMine: boolean }): string => `${o.isMine ? '↗' : '↙'} ${o.name}: ${clipped(o.text)}`

// What this computer just sent, for the reader of the session that holds the bridge.
export async function showSent(host: Host, o: { room: RoomRecord; message: Message }): Promise<void> {
  if (o.room.kind !== 'devices') return
  await linkHere(host)
  host.say(bridgeLine({ name: `${whoOf(o.message.kind)} · ${await deviceNameOf(host)}`, text: o.message.text, isMine: true }))
}

function isOverCeiling(now: number): boolean {
  wakes = wakes.filter(at => now - at < HOUR_MS)
  return wakes.length >= BRIDGE_WAKES_PER_HOUR
}

function wakeTextOf(said: readonly Said[], now: number): string {
  const body = clipped(said.map(s => `[${s.name}] ${s.text}`).join('\n'))
  return `${agentWords().bridgeHead}\n${fence(body, newNonce(now))}`
}

// One wake for everything waiting: never during a turn, at most one per cooldown and BRIDGE_WAKES_PER_HOUR an hour.
export async function flushWake(host: AgentHost): Promise<boolean> {
  if (waiting.length === 0 || isTurnRunning()) return false
  const now = await host.now()
  const left = LIVE_COOLDOWN_MS - (now - lastWake)
  if (left > 0) {
    if (!isFlushQueued) {
      isFlushQueued = true
      host.after(left, () => { isFlushQueued = false; void flushWake(host).catch(() => undefined) })
    }
    return false
  }
  if (isOverCeiling(now)) {
    if (!isPauseSaid) host.say(agentWords().bridgePaused)
    isPauseSaid = true
    waiting.length = 0
    return false
  }
  isPauseSaid = false
  lastWake = now
  wakes.push(now)
  await wake(host, wakeTextOf(waiting.splice(0), now))
  return true
}

export async function onBridgeTick(host: AgentHost, ev: TickEvent): Promise<void> {
  if (ev.room.kind !== 'devices' || ev.fresh.length === 0) return
  const link = await linkOf(host)
  if (link === null || link.session !== (await host.sessionId())) return
  const names = deviceLabels([ev.room], { [ev.room.id]: ev.state })
  for (const e of ev.fresh) {
    const m = e.message
    // A mailbox read for the first time brings its history: only what came after the link is news.
    if (isUnreadable(m) || !SHOWN.has(m.kind) || m.ts < link.at) continue
    const said = { name: `${whoOf(m.kind)} · ${names[e.author] ?? agentWords().otherComputer}`, text: m.text }
    host.say(bridgeLine({ ...said, isMine: false }))
    waiting.push(said)
  }
  await flushWake(host)
}

export function wireBridge(host: AgentHost): () => void {
  const offTick = onTick(ev => onBridgeTick(host, ev).catch(() => undefined))
  const offIdle = onTurnIdle(() => { void flushWake(host).catch(() => undefined) })
  return () => { offTick(); offIdle() }
}

export function resetBridge(): void {
  waiting.length = 0
  lastWake = Number.NEGATIVE_INFINITY
  wakes = []
  isPauseSaid = false
  isFlushQueued = false
}
