// What one agent exchange says in words, the same on every surface: who asked, what, how it ended and what it
// cost, and an answer's compact form. The pane shows an exchange as this line; the answer opens on press.
import { FIRST_ROWS, type Compact } from './answers'
import type { Line } from './state-types'
import { firstName, genitive } from './tr'
import { askedArg, joined, queryType, type Tx } from './traffic'

export function agentOf(line: Line | undefined, noun = 'agent\'ı'): string {
  if (line === undefined) return `Karşı tarafın ${noun}`
  return line.isMine ? 'Senin agent\'ın' : `${genitive(firstName(line.authorName))} ${noun}`
}

// Who answered a peer's question: their agent, or their machine when no model was needed (0 tokens).
export function answererOf(a: { line: Line; tokens: number }): string {
  const noun = a.tokens > 0 ? 'agent\'ı' : 'makinesi'
  return agentOf(a.line, noun)
}

export type TxOutcome = 'answered' | 'waiting' | 'denied'
export type TxSummary = { text: string; outcome: TxOutcome }

// "soru sordu", "diff sordu", "grep refreshToken sordu"; a refusal names what was wanted: ".env istedi".
function askedOf(tx: Tx, isDenied: boolean): string {
  const type = queryType(tx)
  if (type === 'ask') return 'soru sordu'
  const arg = askedArg(tx)
  if (isDenied) return `${arg ?? type} istedi`
  return arg === undefined ? `${type} sordu` : `${type} ${arg} sordu`
}

// "Alperen'in agent'ı diff sordu · cevaplandı · 0 token"
export function txSummary(tx: Tx): TxSummary {
  const a = joined(tx)
  const who = agentOf(tx.query)
  if (a === null) return { text: `${who} ${askedOf(tx, false)} · cevap bekleniyor`, outcome: 'waiting' }
  if (a.isDenied) return { text: `${who} ${askedOf(tx, true)} · erişim yok`, outcome: 'denied' }
  return { text: `${who} ${askedOf(tx, false)} · cevaplandı · ${a.tokens} token`, outcome: 'answered' }
}

// An answer in one line: a diff's stat, test counts, the first hits or items, TODO tags, a commit, or its text.
export function compactText(c: Compact): string {
  if (c.kind === 'diff') return `${c.stat.files} dosya +${c.stat.added} −${c.stat.removed}`
  if (c.kind === 'tests') return `✓ ${c.passed} geçti · ${c.failed} kaldı`
  if (c.kind === 'hits') return `${c.count} eşleşme · ${c.rows.slice(0, FIRST_ROWS).map(h => h.loc).join(', ')}`
  if (c.kind === 'list') return `${c.count} ${c.noun} · ${c.items.slice(0, FIRST_ROWS).join(', ')}`
  if (c.kind === 'tags') return c.tags.map(t => `${t.tag} ${t.count}`).join(' · ')
  if (c.kind === 'commit') return `${c.subject}${c.stat === null ? '' : ` · ${c.stat.files} dosya +${c.stat.added} −${c.stat.removed}`}`
  return c.text.split('\n').find(r => r.trim() !== '')?.trim() ?? ''
}
