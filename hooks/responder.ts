import type { AskReply } from './ask'
import { sameName } from './gate'
import { ANSWER_PART_HEADROOM, ASK_MAX_QUESTION_CHARS, MAX_ANSWER_PARTS, MAX_TEXT_BYTES, MINUTE_MS } from './limits'
import { QUERY_FUTURE_SKEW_MS, QUERY_RATE_PER_MIN, QUERY_TTL_MS } from './limits'
import { DENIED, isUnreadable, QUERY_TYPES, utf8Bytes, type Message, type Query } from './protocol'
import { hasSecret } from './scan'
import type { Draft } from './state-types'
import type { Entry } from './timeline'
import { newId } from './ulid'

export type Outcome = 'skipped' | 'denied' | 'answered' | 'drafted'
export type Out = { ok: boolean; body: string; tokens: number }
type QueryMessage = Message & { query: Query }

// Everything the responder reaches, as plain functions, so each rule is tested without an engine.
export type Deps = {
  selfUid: string
  sessionRepo: string | null
  now: () => Promise<number>
  // Per room: when its recent queries arrived (the 60 a minute limit).
  rate: Map<string, number[]>
  // Query ids this session already decided on: a later tick never claims them again.
  seen: Set<string>
  isConnected: () => boolean
  claim: (qid: string) => Promise<boolean>
  gate: (opts: { peerUid: string; query: Query; now: number }) => Promise<boolean>
  typed: (query: Query) => Promise<{ ok: boolean; body: string }>
  ask: (question: string) => Promise<AskReply | null>
  budget: () => Promise<boolean>
  post: (message: Message) => Promise<void>
  addDraft: (draft: Draft) => Promise<void>
}

export const DENIED_OUT: Out = { ok: false, body: DENIED, tokens: 0 }

function chunks(body: string): string[] {
  const max = MAX_TEXT_BYTES - ANSWER_PART_HEADROOM
  const out: string[] = []
  let cur = ''
  let used = 0
  for (const ch of body) {
    const size = utf8Bytes(ch)
    if (used + size > max) { out.push(cur); cur = ''; used = 0 }
    cur += ch
    used += size
  }
  out.push(cur)
  return out
}

// A long body goes as numbered parts sharing one qid; the asker joins them by `part`. A refusal is always one
// part whose body is exactly the denial text.
export function answerParts(qid: string, out: Out, now: number): Message[] {
  const safe = !out.ok || out.body === DENIED ? { ...out, ok: false, body: DENIED } : out
  const parts = chunks(safe.body)
  if (parts.length > MAX_ANSWER_PARTS) return answerParts(qid, { ...DENIED_OUT, tokens: out.tokens }, now)
  return parts.map((body, i) => {
    const numbering = parts.length === 1 ? {} : { part: i + 1, parts: parts.length }
    const text = parts.length === 1 ? body : `${i + 1}/${parts.length}\n${body}`
    const answer = { qid, ok: safe.ok, body, tokens: i === 0 ? safe.tokens : 0, ...numbering }
    return { v: 1, id: newId(now + i), ts: now + i, kind: 'answer', text, replyTo: qid, answer }
  })
}

// The author is the outbox the message was read from (the server lets each person write only their own), never
// a field of the message, so a query cannot pose as someone else's.
function queryFor(deps: Deps, entry: Entry): QueryMessage | null {
  const m = entry.message
  if (isUnreadable(m) || m.kind !== 'query' || m.query === undefined || entry.author === deps.selfUid) return null
  return m as QueryMessage
}

const isFresh = (ts: number, now: number) => now - ts <= QUERY_TTL_MS && ts - now <= QUERY_FUTURE_SKEW_MS

function isRateLimited(rate: Map<string, number[]>, roomId: string, now: number): boolean {
  const recent = (rate.get(roomId) ?? []).filter(t => now - t < MINUTE_MS)
  recent.push(now)
  rate.set(roomId, recent)
  return recent.length > QUERY_RATE_PER_MIN
}

// Nothing a scan flags leaves, whatever produced it; the whole body is scanned before it is split.
export function safeParts(qid: string, out: Out, now: number): Message[] {
  return answerParts(qid, out.ok && hasSecret(out.body) ? { ...DENIED_OUT, tokens: out.tokens } : out, now)
}

async function reply(deps: Deps, qid: string, out: Out): Promise<Outcome> {
  const parts = safeParts(qid, out, await deps.now())
  for (const m of parts) await deps.post(m)
  return parts[0]?.answer?.ok === true ? 'answered' : 'denied'
}

async function answerAsk(deps: Deps, opts: { roomId: string; asker: string; m: QueryMessage }): Promise<Outcome> {
  const { m } = opts
  const question = (m.query.question ?? m.text).trim()
  if (question === '' || question.length > ASK_MAX_QUESTION_CHARS) return reply(deps, m.id, DENIED_OUT)
  // Past the day's limit nothing is spent: the question waits for the person's approval.
  if (!(await deps.budget())) {
    await deps.addDraft({ roomId: opts.roomId, qid: m.id, question, asker: opts.asker })
    return 'drafted'
  }
  const answer = await deps.ask(question).catch(() => null)
  return reply(deps, m.id, answer === null ? DENIED_OUT : { ok: true, body: answer.text, tokens: answer.tokens })
}

async function answerOpen(deps: Deps, opts: { roomId: string; asker: string; m: QueryMessage }): Promise<Outcome> {
  const { m } = opts
  // A type that needs a model goes through the day's budget; every other one is answered by `typed` alone.
  if (!QUERY_TYPES[m.query.type].isModelless) return answerAsk(deps, opts)
  const out = await deps.typed(m.query).catch(() => DENIED_OUT)
  return reply(deps, m.id, { ...out, tokens: 0 })
}

// Claim first (create-only, so one session anywhere answers), then the gate, failing closed, then the answer.
export async function respond(deps: Deps, opts: { roomId: string; entry: Entry }): Promise<Outcome> {
  const m = queryFor(deps, opts.entry)
  // Not connected: no write is possible yet; the query stays unseen and is tried again once connected.
  if (m === null || deps.seen.has(m.id) || !deps.isConnected()) return 'skipped'
  deps.seen.add(m.id)
  // Only a session open on the asked repo may claim: another repo's session would win the claim with a denial.
  if (!sameName(m.query.repo, deps.sessionRepo)) return 'skipped'
  const now = await deps.now()
  if (!isFresh(m.ts, now) || isRateLimited(deps.rate, opts.roomId, now)) return 'skipped'
  if (!(await deps.claim(m.id).catch(() => false))) return 'skipped'
  const asker = opts.entry.author
  const isOpen = await deps.gate({ peerUid: asker, query: m.query, now }).catch(() => false)
  if (!isOpen) return reply(deps, m.id, DENIED_OUT)
  return answerOpen(deps, { roomId: opts.roomId, asker, m })
}
