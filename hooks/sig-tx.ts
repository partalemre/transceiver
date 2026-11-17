// One AI exchange as a question and its answer: who asked (crab, "Alperen's AI asked", the time), the question in an
// outlined bubble, and under it, hooked to it, how it was answered. A refusal says so in Flare; one still waiting
// says so quietly. Pure: words in, Svg out.
import { baseline, num, sans, textEl, toPic } from './kit/svg-core'
import type { SvgPic } from './kit/svg-core'
import { fitText, textWidth } from './kit/svg-metrics'
import { faceOf, themed, veilRect, VEIL } from './sig-ink'
import { glyphPiece } from './sig-ui'
import { TALK } from './sig-talk'
import { wrapLines } from './sig-wrap'

export type TxOutcome = 'answered' | 'waiting' | 'denied'
export type TxPicOpts = {
  width: number; pin?: boolean
  asker: { label: string; name: string; isAgent: boolean }
  time: string; question: string; answer: string; outcome: TxOutcome
}

const ANSWER = { h: 24, lineH: 17, size: 12, icon: 14, iconGap: 6, hook: 12 }
const ANSWER_LINES = 2
const HOOK_R = 4
const QUESTION_LINES = 4
const NAME_WEIGHT = 600
const TIME_GAP = 8
const BODY = sans(TALK.size)
const OUTCOME: Record<TxOutcome, { glyph: 'check' | 'clock' | 'lock'; paint: string; text: string }> = {
  answered: { glyph: 'check', paint: 'ok', text: 'mid' },
  waiting: { glyph: 'clock', paint: 'lo', text: 'lo' },
  denied: { glyph: 'lock', paint: 'danger', text: 'danger' },
}

function headSvg(o: TxPicOpts): string {
  const y = baseline(0, TALK.headH, TALK.nameSize)
  const label = fitText(o.asker.label, o.width - TALK.textX - textWidth(o.time, TALK.metaSize) - TIME_GAP, sans(TALK.nameSize, NAME_WEIGHT))
  return [
    faceOf({ name: o.asker.name, isAgent: o.asker.isAgent, x: 0, y: (TALK.headH - TALK.face) / 2, size: TALK.face }),
    textEl({ x: TALK.textX, y, text: label, paint: 'hi', size: TALK.nameSize, weight: NAME_WEIGHT }),
    textEl({ x: TALK.textX + textWidth(label, TALK.nameSize, NAME_WEIGHT) + TIME_GAP, y, text: o.time, paint: 'lo', size: TALK.metaSize }),
  ].join('')
}

function questionSvg(o: TxPicOpts, top: number): { svg: string; h: number } {
  const max = Math.min(TALK.maxBubble, o.width - TALK.textX - TALK.sideRoom / 2)
  const lines = wrapLines(o.question, { max: max - TALK.padX * 2, measure: BODY, maxLines: QUESTION_LINES })
  const w = Math.ceil(Math.min(max, Math.max(...lines.map(BODY)) + TALK.padX * 2))
  const h = lines.length * TALK.lineH + TALK.padY * 2
  const words = lines.map((line, i) => textEl({ x: TALK.textX + TALK.padX, y: baseline(top + TALK.padY + i * TALK.lineH, TALK.lineH, TALK.size), text: line, paint: 'hi', size: TALK.size }))
  return { svg: veilRect({ x: TALK.textX, y: top, w, h, r: TALK.radius, fill: VEIL.fill }) + words.join(''), h }
}

// ↳ ✓ Answered on this computer · 0 tokens · 0.4 s, on a second line when the pane is narrow.
function answerSvg(o: TxPicOpts, top: number): { svg: string; h: number } {
  const look = OUTCOME[o.outcome]
  const hookX = TALK.textX + ANSWER.hook
  const mid = top + ANSWER.h / 2
  const iconX = hookX + ANSWER.hook - 2
  const textX = iconX + ANSWER.icon + ANSWER.iconGap
  const lines = wrapLines(o.answer, { max: o.width - textX, measure: sans(ANSWER.size), maxLines: ANSWER_LINES })
  const hook = `<path d="M${num(hookX + 0.5)} ${num(top - TALK.gap)}V${num(mid - HOOK_R)}q0 ${HOOK_R} ${HOOK_R} ${HOOK_R}H${num(iconX - HOOK_R)}" fill="none" class="s-hi" stroke-opacity="${VEIL.edge}"/>`
  const icon = glyphPiece(look.glyph, { size: ANSWER.icon, paint: look.paint, stroke: 1.75 })
  const words = lines.map((line, i) => textEl({ x: textX, y: baseline(top + i * ANSWER.lineH, ANSWER.h, ANSWER.size), text: line, paint: look.text, size: ANSWER.size }))
  const svg = [hook, `<g transform="translate(${num(iconX)} ${num(mid - ANSWER.icon / 2)})">${icon.body}</g>`, ...words].join('')
  return { svg, h: ANSWER.h + (lines.length - 1) * ANSWER.lineH }
}

export function txPic(o: TxPicOpts): SvgPic {
  const q = questionSvg(o, TALK.headH + TALK.gap)
  const answerTop = TALK.headH + TALK.gap + q.h + TALK.gap
  const a = answerSvg(o, answerTop)
  const body = [headSvg(o), q.svg, a.svg].join('')
  const alt = `${o.asker.label}, ${o.time}: ${o.question} — ${o.answer}`
  return themed(toPic({ body, width: Math.floor(o.width), height: Math.ceil(answerTop + a.h), alt }), o.pin)
}
