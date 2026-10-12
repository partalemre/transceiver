// What one agent exchange says in words, the same on every surface: who asked, what, how it ended and what it
// cost, and an answer's compact form. The pane shows an exchange as this line; the answer opens on press.
import { FIRST_ROWS, type Compact } from './answers'
import { lang, pick } from './kit/lang'
import type { Line } from './state-types'
import { firstName, genitive, possessive } from './tr'
import { askedArg, joined, queryType, type Tx } from './traffic'
import { countOf, tokensText } from './words-count'
import { shownWire } from './words-wire'

export type Noun = 'agent' | 'machine'

const EN = {
  nouns: { agent: 'agent', machine: 'machine' } as Record<Noun, string>,
  theirs: (noun: string) => `The other side's ${noun}`,
  mine: 'Your agent',
  whose: (o: { name: string; noun: string }) => `${possessive(o.name)} ${o.noun}`,
  answered: (who: string) => `${who} answered`,
  question: 'asked a question',
  wanted: (what: string) => `wanted ${what}`,
  asked: (what: string) => `asked · ${what}`,
  waiting: 'waiting for an answer',
  denied: 'no access',
  done: 'answered',
  tests: (o: { passed: number; failed: number }) => `✓ ${o.passed} passed · ${o.failed} failed`,
  stat: (o: { files: number; added: number; removed: number }) => `${countOf(o.files, { one: 'file', many: 'files' })} +${o.added} -${o.removed}`,
  matches: (n: number) => countOf(n, { one: 'match', many: 'matches' }),
}

const TR: typeof EN = {
  nouns: { agent: 'agent\'ı', machine: 'makinesi' },
  theirs: noun => `Karşı tarafın ${noun}`,
  mine: 'Senin agent\'ın',
  whose: o => `${genitive(o.name)} ${o.noun}`,
  answered: who => who,
  question: 'soru sordu',
  wanted: what => `${what} istedi`,
  asked: what => `${what} sordu`,
  waiting: 'cevap bekleniyor',
  denied: 'erişim yok',
  done: 'cevaplandı',
  tests: o => `✓ ${o.passed} geçti · ${o.failed} kaldı`,
  stat: o => `${o.files} dosya +${o.added} −${o.removed}`,
  matches: n => `${n} eşleşme`,
}

const words = () => pick({ en: EN, tr: TR })

// "Leo's agent", "Your agent"; Turkish "Alperen'in agent'ı", "Senin agent'ın".
export function agentOf(line: Line | undefined, noun: Noun = 'agent'): string {
  const w = words()
  if (line === undefined) return w.theirs(w.nouns[noun])
  return line.isMine ? w.mine : w.whose({ name: firstName(line.authorName), noun: w.nouns[noun] })
}

// Who answered a peer's question: their agent, or their machine when no model was needed (0 tokens).
export function answererOf(a: { line: Line; tokens: number }): string {
  return words().answered(agentOf(a.line, a.tokens > 0 ? 'agent' : 'machine'))
}

export type TxOutcome = 'answered' | 'waiting' | 'denied'
export type TxSummary = { text: string; outcome: TxOutcome }

// "asked · diff", "asked · grep refreshToken", "asked a question"; a refusal names what was wanted:
// "wanted .env". Turkish: "diff sordu", "grep refreshToken sordu", "soru sordu", ".env istedi".
function askedOf(tx: Tx, isDenied: boolean): string {
  const w = words()
  const type = queryType(tx)
  if (type === 'ask') return w.question
  const arg = askedArg(tx)
  if (isDenied) return w.wanted(arg ?? type)
  return w.asked(arg === undefined ? type : `${type} ${arg}`)
}

// "Leo's agent asked · diff · answered · 0 tokens"; "Alperen'in agent'ı diff sordu · cevaplandı · 0 token"
export function txSummary(tx: Tx): TxSummary {
  const w = words()
  const a = joined(tx)
  const who = agentOf(tx.query)
  if (a === null) return { text: `${who} ${askedOf(tx, false)} · ${w.waiting}`, outcome: 'waiting' }
  if (a.isDenied) return { text: `${who} ${askedOf(tx, true)} · ${w.denied}`, outcome: 'denied' }
  return { text: `${who} ${askedOf(tx, false)} · ${w.done} · ${tokensText(a.tokens)}`, outcome: 'answered' }
}

// "View diff", "View answer": what opens an exchange; a Turkish line says "Göster".
export const viewLabel = (tx: Tx): string => {
  if (lang() === 'tr') return 'Göster'
  const type = queryType(tx)
  return `View ${type === 'ask' ? 'answer' : type}`
}

// An answer in one line: a diff's stat, test counts, the first hits or items, TODO tags, a commit, or its text.
export function compactText(c: Compact): string {
  const w = words()
  if (c.kind === 'diff') return w.stat(c.stat)
  if (c.kind === 'tests') return w.tests(c)
  if (c.kind === 'hits') return `${w.matches(c.count)} · ${c.rows.slice(0, FIRST_ROWS).map(h => h.loc).join(', ')}`
  if (c.kind === 'list') return `${c.count} ${c.noun} · ${c.items.slice(0, FIRST_ROWS).join(', ')}`
  if (c.kind === 'tags') return c.tags.map(t => `${t.tag} ${t.count}`).join(' · ')
  if (c.kind === 'commit') return `${c.subject}${c.stat === null ? '' : ` · ${w.stat(c.stat)}`}`
  return shownWire(c.text.split('\n').find(r => r.trim() !== '')?.trim() ?? '')
}
