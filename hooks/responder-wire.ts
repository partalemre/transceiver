import type { Timer } from 'claude-code'
import { askModel, newNonce } from './ask'
import { spendAsk } from './budget'
import { addDraft, loadDrafts } from './drafts'
import { makeGate, type GateInput } from './gate'
import { ghCheck, mcpCheck } from './github'
import { repoHere } from './here'
import type { AgentHost } from './host'
import { DRAFT_TOAST_QUIET_MS } from './limits'
import { isUnreadable } from './protocol'
import { answerTyped } from './queries'
import { callerOf, relayOf } from './relay'
import { respond, type Deps } from './responder'
import { enqueueMessage, onTick, type TickEvent } from './room-loop'
import { loadRooms, type RoomRecord } from './rooms'
import type { Entry } from './timeline'

type Gate = (input: GateInput) => Promise<boolean>
type Ctx = { host: AgentHost; gate: Gate }
type Turn = { room: RoomRecord; ev: TickEvent; repo: string | null; root: string }

// Per room, across ticks: the rate window and the queries this session has decided on.
const rate = new Map<string, number[]>()
const seenByRoom = new Map<string, Set<string>>()
const draftToasts = new Map<string, Timer>()

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
    addDraft: async draft => {
      if (await addDraft(host, draft)) tellDrafted(host, room)
    },
  }
}

async function toastWaiting(host: AgentHost, room: RoomRecord): Promise<void> {
  const waiting = (await loadDrafts(host)).filter(d => d.roomId === room.id).length
  host.toast(`Transceiver: günlük soru sınırı doldu, ${waiting} soru onayını bekliyor`)
}

// A burst of asks past the limit is one toast per room, saying how many wait: each new draft pushes it back.
function tellDrafted(host: AgentHost, room: RoomRecord): void {
  draftToasts.get(room.id)?.cancel()
  draftToasts.set(room.id, host.after(DRAFT_TOAST_QUIET_MS, () => {
    draftToasts.delete(room.id)
    toastWaiting(host, room).catch((err: unknown) =>
      host.log(`transceiver: ${room.title}: drafts toast ${err instanceof Error ? err.name : 'error'}`))
  }))
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
