// Rooms written before sealing hold their lines in clear. Only a mailbox's owner can rewrite it, so each person
// seals their own, once per room: plain messages, day bundles and the head are rewritten sealed, each pinned to the
// version it was read at. A git room's own ref is then cut down to one new commit, so the clear text leaves its
// history too. What someone fetched before, they keep.
import { isGitUrl } from './gitbox'
import { hasClearPersonal, openHead } from './heads'
import type { AgentHost } from './host'
import { BATCH_MAX_WRITES, COMPACT_PAGE, DAY_MS, HEADS_PAGE, RETENTION_RETRY_MS } from './limits'
import { isStoredDoc, isUnreadable, parseMessage, paths, sealMessage, type StoredDoc } from './protocol'
import { callerOf, relayOf, storedHead, type Relay } from './relay'
import type { TickEvent } from './room-loop'
import type { RoomRecord } from './rooms'
import { audienceOf } from './seal'

type Progress = { msgs: number; days: number; since?: number }
type Ctx = { relay: Relay; uid: string; to: string[] }
type Write = Record<string, unknown>

const doneKey = (id: string) => `tx.sealedHistory.${id}`
// History is sealed to the members whose keys are out. A member who has not updated yet would lose it, so it waits
// for every other member seen to publish a key (seal() always adds this computer), but no longer than this: one who never updates must not keep it in clear.
const WAIT_FOR_KEYS_MS = 3 * DAY_MS
const retryAt = new Map<string, number>()
const after = (ts: number) => ({ where: [['ts', '>', ts]], order_by: { field: 'ts', direction: 'asc' }, limit: COMPACT_PAGE })

// A message from before sealing (version 1) sealed as it is; anything else is left as stored.
function sealedOf(doc: unknown, to: string[]): StoredDoc | null {
  const id = typeof doc === 'object' && doc !== null ? String((doc as { id?: unknown }).id) : ''
  const message = parseMessage(id, doc)
  return isUnreadable(message) ? null : sealMessage(message, to)
}

async function inBatches(relay: Relay, writes: Write[]): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_MAX_WRITES) await relay.batch(writes.slice(i, i + BATCH_MAX_WRITES))
}

// One page of messages after `from`; the time to go on from, or null once the last page is done.
async function sealMessagesAfter(ctx: Ctx, from: number): Promise<number | null> {
  const collection = paths.msgs(ctx.uid)
  const docs = await ctx.relay.docs(collection, after(from))
  const writes = docs.flatMap(d => {
    const data = sealedOf(d.data, ctx.to)
    return data === null ? [] : [{ op: 'set', collection, doc_id: d.id, data, if_version: d.version }]
  })
  await inBatches(ctx.relay, writes)
  return docs.length < COMPACT_PAGE ? null : Math.max(from, ...docs.map(d => Number(d.data.ts)))
}

async function sealDaysAfter(ctx: Ctx, from: number): Promise<number | null> {
  const collection = paths.days(ctx.uid)
  const docs = await ctx.relay.docs(collection, after(from))
  for (const d of docs) {
    const msgs = Array.isArray(d.data.msgs) ? d.data.msgs.filter(isStoredDoc) : []
    const sealed = msgs.map(m => sealedOf(m, ctx.to) ?? m)
    if (sealed.every((m, i) => m === msgs[i])) continue
    // A day doc can be large: one per batch.
    await ctx.relay.batch([{ op: 'set', collection, doc_id: d.id, data: { ...d.data, msgs: sealed }, if_version: d.version }])
  }
  return docs.length < COMPACT_PAGE ? null : Math.max(from, ...docs.map(d => Number(d.data.ts)))
}

async function sealHead(ctx: Ctx & { url: string }): Promise<void> {
  const own = (await ctx.relay.docs(paths.heads, { limit: HEADS_PAGE })).find(d => d.id === ctx.uid)
  const head = own === undefined || !hasClearPersonal(own.data) ? null : openHead(own.data)
  if (own === undefined || head === null) return
  await ctx.relay.batch([{ op: 'set', collection: paths.heads, doc_id: ctx.uid, data: storedHead(ctx.url, head), if_version: own.version }])
}

async function run(host: AgentHost, o: { room: RoomRecord; uid: string; at: Progress }): Promise<Progress | null> {
  const relay = relayOf(callerOf(host), o.room.url)
  const ctx = { relay, uid: o.uid, to: audienceOf(o.room.url), url: o.room.url }
  const msgs = await sealMessagesAfter(ctx, o.at.msgs)
  if (msgs !== null) return { ...o.at, msgs }
  const days = await sealDaysAfter(ctx, o.at.days)
  if (days !== null) return { msgs: Number.MAX_SAFE_INTEGER, days }
  await sealHead(ctx)
  if (isGitUrl(o.room.url)) {
    const out = await callerOf(host)({ tool: 'ArtifactData', url: o.room.url, action: 'squash' })
    if (out.isError === true) throw new Error('transceiver: the history could not be cut')
  }
  return null
}

const progressOf = (raw: unknown): Progress => {
  const x = raw as Partial<Progress> | null
  const since = typeof x?.since === 'number' ? { since: x.since } : {}
  return { msgs: typeof x?.msgs === 'number' ? x.msgs : 0, days: typeof x?.days === 'number' ? x.days : 0, ...since }
}

// One page a tick until the room is done; then never again for it.
export async function sealHistory(host: AgentHost, ev: TickEvent): Promise<void> {
  const key = doneKey(ev.room.id)
  const stored = await host.storeGet(key)
  const now = await host.now()
  if (stored === true || (retryAt.get(key) ?? 0) > now) return
  const at = { since: now, ...progressOf(stored) }
  const isKeyed = Object.values(ev.state.peers).every(h => (h.keys ?? []).length > 0)
  if (!isKeyed && now - at.since < WAIT_FOR_KEYS_MS) return host.storeSet(key, at)
  try {
    const next = await run(host, { room: ev.room, uid: ev.state.selfUid, at })
    await host.storeSet(key, next === null ? true : { ...next, since: at.since })
  } catch (err) {
    retryAt.set(key, now + RETENTION_RETRY_MS)
    host.log(`transceiver: ${ev.room.title}: sealing history ${err instanceof Error ? err.name : 'error'}`)
  }
}
