import { askModel, newNonce } from './ask'
import type { AgentHost, Host } from './host'
import type { Message } from './protocol'
import { DENIED_OUT, safeParts, type Out } from './responder'
import { enqueueMessage } from './room-loop'
import { loadRooms } from './rooms'
import type { Draft } from './state-types'

// Asks past the day's limit wait here, in the store, until the person approves or refuses each one in the pane.
const KEY = 'tx.drafts'
type Listener = (drafts: Draft[]) => void
const listeners: Listener[] = []

// The pane listens, so a new or settled draft redraws it. Returns the unsubscribe.
export function onDrafts(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const at = listeners.indexOf(fn)
    if (at >= 0) listeners.splice(at, 1)
  }
}

const isDraft = (x: unknown): x is Draft =>
  typeof x === 'object' && x !== null && ['roomId', 'qid', 'question', 'asker'].every(k => typeof (x as Record<string, unknown>)[k] === 'string')

export async function loadDrafts(host: Pick<Host, 'storeGet'>): Promise<Draft[]> {
  const raw = await host.storeGet(KEY)
  return Array.isArray(raw) ? raw.filter(isDraft) : []
}

async function saveDrafts(host: Pick<Host, 'storeSet'>, drafts: Draft[]): Promise<void> {
  await host.storeSet(KEY, drafts)
  for (const fn of listeners) fn(drafts)
}

export async function addDraft(host: Pick<Host, 'storeGet' | 'storeSet'>, draft: Draft): Promise<void> {
  const drafts = await loadDrafts(host)
  if (drafts.some(d => d.qid === draft.qid)) return
  await saveDrafts(host, [...drafts, draft])
}

async function takeDraft(host: Pick<Host, 'storeGet' | 'storeSet'>, qid: string): Promise<Draft | undefined> {
  const drafts = await loadDrafts(host)
  const draft = drafts.find(d => d.qid === qid)
  if (draft !== undefined) await saveDrafts(host, drafts.filter(d => d.qid !== qid))
  return draft
}

async function draftAnswer(host: AgentHost, draft: Draft): Promise<Out> {
  const nonce = newNonce(await host.now())
  const reply = await askModel(host, { root: await host.root(), question: draft.question, nonce }).catch(() => null)
  return reply === null ? DENIED_OUT : { ok: true, body: reply.text, tokens: reply.tokens }
}

// The person's answer to a draft: approved, the model answers it outside the day's limit; refused, the asker gets
// the denial. Nothing is written before the session is connected; the draft then stays.
export async function settleDraft(host: AgentHost, opts: { qid: string; isApproved: boolean }): Promise<boolean> {
  if (!host.isConnected()) return false
  const draft = await takeDraft(host, opts.qid)
  // A draft of a room the person has left goes with the room.
  const room = (await loadRooms(host)).find(r => r.id === draft?.roomId && r.status === 'active')
  if (draft === undefined || room === undefined) return false
  const out = opts.isApproved ? await draftAnswer(host, draft) : DENIED_OUT
  const parts: Message[] = safeParts(draft.qid, out, await host.now())
  return parts.every(message => enqueueMessage({ host, room, message }))
}
