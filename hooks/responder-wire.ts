import { askModel, newNonce } from './ask'
import { spendAsk } from './budget'
import { addDraft, loadDrafts } from './drafts'
import { makeGate, type GateInput } from './gate'
import { ghCheck, mcpCheck } from './github'
import { repoHere } from './here'
import type { AgentHost } from './host'
import { DRAFT_TOAST_MS } from './limits'
import { namesNow } from './names'
import { isUnreadable } from './protocol'
import { answerTyped } from './queries'
import { callerOf, relayOf } from './relay'
import { respond, type Deps } from './responder'
import { enqueueMessage, onTick, type TickEvent } from './room-loop'
import { loadRooms, type RoomRecord } from './rooms'
import type { Draft } from './state-types'
import type { Entry } from './timeline'
import { firstName, genitive } from './tr'

type Gate = (input: GateInput) => Promise<boolean>
type Ctx = { host: AgentHost; gate: Gate }
type Turn = { room: RoomRecord; ev: TickEvent; repo: string | null; root: string }

// Per room, across ticks: the rate window and the queries this session has decided on.
const rate = new Map<string, number[]>()
const seenByRoom = new Map<string, Set<string>>()
// Per room: when its last draft toast went out, the asker it named, and whether a draft was stored since.
const draftToasts = new Map<string, { at: number; asker: string; isDue: boolean }>()

type ToastHost = Pick<AgentHost, 'storeGet' | 'storeSet' | 'now' | 'after' | 'toast'>

export function draftToastText(opts: { name: string; count: number }): string {
  const who = opts.name === '' ? 'Bir agent' : `${genitive(firstName(opts.name))} agent'ı`
  return `${who} ${opts.count} soru bekletiyor`
}

async function toastDrafts(host: ToastHost, opts: { roomId: string; asker: string }): Promise<void> {
  const waiting = (await loadDrafts(host)).filter(d => d.roomId === opts.roomId && d.asker === opts.asker)
  if (waiting.length > 0) host.toast(draftToastText({ name: namesNow()[opts.asker] ?? '', count: waiting.length }))
}

async function flushDraftToast(host: ToastHost, roomId: string): Promise<void> {
  const due = draftToasts.get(roomId)
  if (due?.isDue !== true) return
  draftToasts.set(roomId, { ...due, at: await host.now(), isDue: false })
  await toastDrafts(host, { roomId, asker: due.asker })
}

// A draft past the ask limit is stored once; only a draft stored now raises a toast, and a burst in one room makes
// one toast at once and, when more came within DRAFT_TOAST_MS, one more at its end with the count then.
export async function storeDraft(host: ToastHost, draft: Draft): Promise<void> {
  if (!(await addDraft(host, draft))) return
  const now = await host.now()
  const last = draftToasts.get(draft.roomId)
  if (last === undefined || now - last.at >= DRAFT_TOAST_MS) {
    draftToasts.set(draft.roomId, { at: now, asker: draft.asker, isDue: false })
    await toastDrafts(host, draft)
    return
  }
  if (!last.isDue) host.after(last.at + DRAFT_TOAST_MS - now, () => void flushDraftToast(host, draft.roomId).catch(() => undefined))
  draftToasts.set(draft.roomId, { ...last, asker: draft.asker, isDue: true })
}

function depsFor(ctx: Ctx, turn: Turn): Deps {
  const { host } = ctx
  const { room, ev, repo, root } = turn
  const selfUid = ev.state.selfUid
  const seen = seenByRoom.get(room.id) ?? new Set<string>()
  seenByRoom.set(room.id, seen)
  return {
    selfUid, sessionRepo: repo, now: () => host.now(), rate, seen, isConnected: () => host.isConnected(),
    claim: async qid => relayOf(callerOf(host), room.url).claim({ uid: selfUid, qid, now: await host.now() }),
    // The room is read fresh from the store (a confirmation may be newer than this tick's copy); the login the
    // peer's head announces now must still be the one confirmed.
    gate: o => ctx.gate({ ...o, room, sessionRepo: repo, headGh: ev.state.peers[o.peerUid]?.gh }),
    typed: q => answerTyped({
      run: host.run, root, realPath: host.realPath, readFile: p => host.readFile(p), readState: (p, k) => host.readState(p, k),
    }, q),
    ask: async question => askModel(host, { root, question, nonce: newNonce(await host.now()) }),
    budget: () => spendAsk(host, room.id),
    post: async message => {
      if (!enqueueMessage({ host, room, message })) throw new Error('room not synced')
    },
    addDraft: draft => storeDraft(host, draft),
  }
}

const isPeerQuery = (selfUid: string) => (e: Entry) =>
  e.author !== selfUid && !isUnreadable(e.message) && e.message.kind === 'query'

// Every query still in the room's window is a candidate, not only this tick's: one that arrived before the session
// was connected is answered once it is (claims keep it to one answer anywhere).
async function onRoomTick(ctx: Ctx, ev: TickEvent): Promise<void> {
  if (ev.room.kind !== 'project') return
  const queries = ev.state.entries.filter(isPeerQuery(ev.state.selfUid))
  const seen = seenByRoom.get(ev.room.id)
  const open = queries.filter(e => seen?.has(e.message.id) !== true)
  if (open.length === 0 || !ctx.host.isConnected()) return
  const room = (await loadRooms(ctx.host)).find(r => r.id === ev.room.id)
  if (room === undefined || room.status !== 'active' || room.kind !== 'project') return
  const [repo, root] = await Promise.all([repoHere(ctx.host), ctx.host.root()])
  const deps = depsFor(ctx, { room, ev, repo, root })
  for (const entry of open) await respond(deps, { roomId: room.id, entry })
  // Forget ids that left the window, so the set stays as small as the window.
  const ids = new Set(queries.map(e => e.message.id))
  for (const id of deps.seen) if (!ids.has(id)) deps.seen.delete(id)
}

export function wireResponder(host: AgentHost): () => void {
  const check = mcpCheck({ mcp: { call: (server, tool, args) => host.mcpCall(server, tool, args) } }, ghCheck(host.run))
  const ctx: Ctx = { host, gate: makeGate(check) }
  return onTick(ev => onRoomTick(ctx, ev))
}
