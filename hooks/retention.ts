import { compactRoom, dayOf } from './compact'
import type { AgentHost } from './host'
import { RETENTION_RETRY_MS, ROLLOVER_DOCS } from './limits'
import { parseMessage, isUnreadable, type Message } from './protocol'
import { callerOf, relayOf } from './relay'
import { onTick, pokeRoom, stopRoom, type TickEvent } from './room-loop'
import { createRoom, loadRooms, saveRooms, type RoomRecord } from './rooms'
import { newId } from './ulid'

// Retention on the room loop (T15), only while the session may write: once a day each person compacts their own
// week-old messages, and the owner of a room near the document limit moves it to a new room artifact.

type Turn = { room: RoomRecord; ev: TickEvent }
// Kept in the store once the new room is published, so a retry reuses it (and its notice) instead of publishing
// another room or posting the notice twice.
type Moving = { next: RoomRecord; notice: Message }

const compactedKey = (id: string) => `tx.compacted.${id}`
const movingKey = (id: string) => `tx.rollover.${id}`
const ROLLOVER_TOAST = 'Transceiver: oda doldu; yeni odayı Paylaş ile tekrar davet et.'
const ROLLOVER_FAILED = 'Transceiver: oda doldu ama yeni oda açılamadı; /transceiver ile tekrar dene.'

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
  const created = await createRoom({ host, kind: room.kind, repo: room.repo })
  const next = { ...created, peers: room.peers, isLive: room.isLive }
  const now = await host.now()
  const notice: Message = { v: 1, id: newId(now), ts: now, kind: 'system', text: `Oda doldu, yeni oda: ${next.url}` }
  await host.storeSet(movingKey(room.id), { next, notice })
  return { next, notice }
}

// The old room says where the talk went, then stays read-only: its page still shows it, the mod stops polling it.
async function moveTo(host: AgentHost, t: Turn & Moving): Promise<void> {
  const { room, ev, next } = t
  const known = ev.state.ownVersion > 0 ? { head: ev.state.ownHead, version: ev.state.ownVersion } : undefined
  await relayOf(callerOf(host), room.url).send({ uid: ev.state.selfUid, message: t.notice, known })
  const rooms = (await loadRooms(host)).filter(r => r.id !== next.id)
  await saveRooms(host, [...rooms.map(r => (r.id === room.id ? { ...r, status: 'left' as const } : r)), next])
  await host.storeSet(movingKey(room.id), null)
  stopRoom(room.id)
  pokeRoom(host, next)
  host.toast(ROLLOVER_TOAST)
}

async function rollover(host: AgentHost, t: Turn): Promise<void> {
  const key = movingKey(t.room.id)
  const now = await host.now()
  if (!t.room.isOwner || (t.ev.docsUsed ?? 0) < ROLLOVER_DOCS || (retryAt.get(key) ?? 0) > now) return
  try {
    await moveTo(host, { ...t, ...(await movingFor(host, t.room)) })
  } catch (err) {
    retryAt.set(key, now + RETENTION_RETRY_MS)
    host.log(`transceiver: ${t.room.title}: rollover ${errName(err)}`)
    if (!warned.has(key)) host.toast(ROLLOVER_FAILED)
    warned.add(key)
  }
}

export async function onRetentionTick(host: AgentHost, ev: TickEvent): Promise<void> {
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
