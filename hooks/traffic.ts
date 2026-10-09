// Agent traffic as the pane tells it: one transmission per query (who asked what, who answered, with how many
// tokens, how long it took) and a refusal as a single line. Pure.
import type { Answer, Message, QueryType } from './protocol'
import type { Line } from './state-types'

export type Tx = { kind: 'tx'; id: string; query?: Line; answers: Line[] }
export type Item = { kind: 'line'; line: Line } | Tx

const isMessage = (m: Line['message']): m is Message & Line['message'] => !('isUnreadable' in m)
export const messageOf = (line: Line): Message | null => (isMessage(line.message) ? line.message : null)

// Queries in timeline order, each with the answers that name it; an answer whose query left the window stands alone.
export function itemsOf(lines: readonly Line[]): Item[] {
  const items: Item[] = []
  const byQid = new Map<string, Tx>()
  for (const line of lines) {
    const m = messageOf(line)
    if (m?.kind === 'query') {
      const tx: Tx = { kind: 'tx', id: line.id, query: line, answers: [] }
      byQid.set(m.id, tx)
      items.push(tx)
      continue
    }
    const qid = m?.kind === 'answer' ? m.answer?.qid : undefined
    const owner = qid === undefined ? undefined : byQid.get(qid)
    if (owner !== undefined) owner.answers.push(line)
    else if (qid !== undefined) items.push({ kind: 'tx', id: line.id, answers: [line] })
    else items.push({ kind: 'line', line })
  }
  return items
}

const answerOf = (line: Line): Answer | undefined => messageOf(line)?.answer

// The first author's parts joined in order; their tokens added up.
export function joined(tx: Tx): { body: string; tokens: number; isDenied: boolean; ts: number; line: Line } | null {
  const first = tx.answers[0]
  if (first === undefined) return null
  const own = tx.answers.filter(l => l.authorUid === first.authorUid)
  const parts = own.map(answerOf).filter((a): a is Answer => a !== undefined).sort((a, b) => (a.part ?? 1) - (b.part ?? 1))
  const last = own.at(-1) ?? first
  return {
    body: parts.map(a => a.body).join(''), tokens: parts.reduce((n, a) => n + a.tokens, 0),
    isDenied: parts.some(a => !a.ok), ts: messageOf(last)?.ts ?? 0, line: first,
  }
}

export const queryType = (tx: Tx): QueryType => (tx.query === undefined ? 'ask' : messageOf(tx.query)?.query?.type ?? 'ask')

// What the query carried besides its type (a path, a question, a search text), or nothing.
export function askedArg(tx: Tx): string | undefined {
  const q = tx.query === undefined ? undefined : messageOf(tx.query)
  if (q?.query === undefined) return undefined
  const arg = q.query.question ?? q.query.path ?? (q.text !== q.query.type ? q.text : undefined)
  return arg === undefined || arg.trim() === '' ? undefined : arg.trim()
}
