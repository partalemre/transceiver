// What one agent exchange says in a line, the same on every surface: who asked, what, how it ended and what it
// cost. The pane shows an exchange as this line; the question and the answer open on press.
import type { Line } from './state-types'
import { firstName, genitive } from './tr'
import { askedArg, joined, queryType, type Tx } from './traffic'

export function agentOf(line: Line | undefined, noun = 'agent\'ı'): string {
  if (line === undefined) return `Karşı tarafın ${noun}`
  return line.isMine ? 'Senin agent\'ın' : `${genitive(firstName(line.authorName))} ${noun}`
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
