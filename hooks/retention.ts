import { compactRoom, dayOf } from './compact'
import { parseArtifactUrls } from './dbtext'
import type { AgentHost } from './host'
import { RETENTION_RETRY_MS, ROLLOVER_DOCS } from './limits'
import { parseMessage, isUnreadable, type Message, type Unreadable } from './protocol'
import { callerOf, relayOf } from './relay'
import { forgetRoom, onTick, pokeRoom, type TickEvent } from './room-loop'
import { createRoom, loadRooms, saveRooms, type RoomRecord } from './rooms'
import { newId } from './ulid'
import { agentWords } from './words-agent'
import { MOVED } from './words-wire'

export { MOVED }

// Retention on the room loop (T15), only while the session may write: once a day each person compacts their own
// week-old messages, and a person whose own mailbox nears the document limit moves to a new mailbox. The others
// follow the move from the notice, whether or not they may write.

type Turn = { room: RoomRecord; ev: TickEvent }
// Kept in the store once the new room is published, so a retry reuses it (and its notice) instead of publishing
// another room or posting the notice twice.
type Moving = { next: RoomRecord; notice: Message }

const compactedKey = (id: string) => `tx.compacted.${id}`
const movingKey = (id: string) => `tx.rollover.${id}`

// After a failure a room waits RETENTION_RETRY_MS (per room and kind of work); module state, so a reload tries again.
const retryAt = new Map<string, number>()
const warned = new Set<string>()

const errName = (err: unknown) => (err instanceof Error ? err.name : 'error')

async function compactDaily(host: AgentHost, t: Turn): Promise<void> {
  const now = await host.now()
  const today = dayOf(now)
  const key = compactedKey(t.room.id)
  if ((await host.storeGet(key)) === today || (retryAt.get(key) ?? 0) > now) return
  try {
    const out = await compactRoom({ relay: relayOf(callerOf(host), t.room.url), uid: t.ev.state.selfUid, now })
    if (out.isDone) await host.storeSet(key, today)
  } catch (err) {
    retryAt.set(key, now + RETENTION_RETRY_MS)
    host.log(`transceiver: ${t.room.title}: compaction ${errName(err)}`)
  }
}

function movingOf(raw: unknown): Moving | null {
  const x = raw as Partial<Moving> | null
  if (typeof x?.next?.url !== 'string' || typeof x.next.id !== 'string' || x.notice === undefined) return null
  const notice = parseMessage(String(x.notice.id), x.notice)
  return isUnreadable(notice) ? null : { next: x.next, notice }
}

async function movingFor(host: AgentHost, room: RoomRecord): Promise<Moving> {
  const stored = movingOf(await host.storeGet(movingKey(room.id)))
  if (stored !== null) return stored
  const created = await createRoom({ host, kind: room.kind, repo: room.repo, room: room.room, boxes: room.boxes })
  const next = { ...created, peers: room.peers, isLive: room.isLive }
  const now = await host.now()
  const notice: Message = { v: 1, id: newId(now), ts: now, kind: 'system', text: `${MOVED}${next.url}` }
  await host.storeSet(movingKey(room.id), { next, notice })
  return { next, notice }
}

// The old mailbox says where the talk went, then stays read-only: the mod stops polling it.
async function moveTo(host: AgentHost, t: Turn & Moving): Promise<void> {
  const { room, ev, next } = t
  const known = ev.state.ownVersion > 0 ? { head: ev.state.ownHead, version: ev.state.ownVersion } : undefined
  await relayOf(callerOf(host), room.url).send({ uid: ev.state.selfUid, message: t.notice, known })
  const rooms = (await loadRooms(host)).filter(r => r.id !== next.id)
  await saveRooms(host, [...rooms.map(r => (r.id === room.id ? { ...r, status: 'left' as const } : r)), next])
  await host.storeSet(movingKey(room.id), null)
  await forgetRoom(host, room.id)
  pokeRoom(host, next)
  host.toast(agentWords().rolledOver)
}

async function rollover(host: AgentHost, t: Turn): Promise<void> {
  const key = movingKey(t.room.id)
  const now = await host.now()
  if ((t.ev.docsUsed ?? 0) < ROLLOVER_DOCS || (retryAt.get(key) ?? 0) > now) return
  try {
    await moveTo(host, { ...t, ...(await movingFor(host, t.room)) })
  } catch (err) {
    retryAt.set(key, now + RETENTION_RETRY_MS)
    host.log(`transceiver: ${t.room.title}: rollover ${errName(err)}`)
    if (!warned.has(key)) host.toast(agentWords().rolloverFailed)
    warned.add(key)
  }
}

// A member may move only their own mailbox: the notice counts only from the mailbox its author writes.
const isMove = (m: Message | Unreadable): m is Message => !isUnreadable(m) && m.kind === 'system' && m.text.startsWith(MOVED)

function movesOf(ev: TickEvent, boxes: string[]): string[] {
  let next = boxes
  for (const { author, message } of ev.fresh) {
    if (!isMove(message)) continue
    const from = ev.state.boxOf[author]
    const [to] = parseArtifactUrls(message.text.slice(MOVED.length))
    if (from !== undefined && to !== undefined && next.includes(from) && !next.includes(to)) next = next.map(b => (b === from ? to : b))
  }
  return next
}

export async function followMoves(host: AgentHost, ev: TickEvent): Promise<void> {
  if (!ev.fresh.some(e => isMove(e.message))) return
  const rooms = await loadRooms(host)
  const room = rooms.find(r => r.id === ev.room.id && r.status === 'active')
  if (room === undefined) return
  const boxes = movesOf(ev, room.boxes)
  if (boxes !== room.boxes) await saveRooms(host, rooms.map(r => (r.id === room.id ? { ...r, boxes } : r)))
}

export async function onRetentionTick(host: AgentHost, ev: TickEvent): Promise<void> {
  await followMoves(host, ev)
  if (ev.isDenied || !host.isConnected()) return
  // Only a room of this person's own store (the record is read fresh: it may have been left meanwhile).
  const room = (await loadRooms(host)).find(r => r.id === ev.room.id && r.status === 'active')
  if (room === undefined) return
  await compactDaily(host, { room, ev })
  await rollover(host, { room, ev })
}

export function wireRetention(host: AgentHost): () => void {
  return onTick(ev => onRetentionTick(host, ev).catch(() => undefined))
}
