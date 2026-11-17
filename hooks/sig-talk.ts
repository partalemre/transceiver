// A conversation as the pane draws it on the desktop: one drawing per run of lines from one sender. Theirs sit on the
// left under who wrote them (monogram or crab, the name, the time), outlined in thin ink; mine sit on the right,
// filled with it, the time and the receipt under the last. Words wrap at real line height; a reply carries the line
// it answers. Pure: words in, Svg out.
import { baseline, num, sans, textEl, toPic } from './kit/svg-core'
import type { SvgPic } from './kit/svg-core'
import { fitText, textWidth } from './kit/svg-metrics'
import { faceOf, themed, veilRect, VEIL } from './sig-ink'
import { checksPiece } from './sig-ui'
import { wrapLines } from './sig-wrap'

export const TALK = {
  face: 22, textX: 32, headH: 26, size: 13.5, lineH: 20, padX: 12, padY: 8, gap: 4, metaH: 20, radius: 13,
  maxBubble: 480, sideRoom: 36, nameSize: 13, metaSize: 11.5, quoteH: 36,
} as const
const NAME_WEIGHT = 600
const TIME_GAP = 8
const BODY = sans(TALK.size)

export type Tick = 'pending' | 'sent' | 'delivered' | 'read'
export type Said = { text: string; quote?: { name: string; text: string }; isPending: boolean }
export type RunOpts = {
  width: number
  // `label`: the name as the header says it ("Alperen", "Alperen's AI").
  who: { label: string; name: string; isAgent: boolean; isMine: boolean }
  said: Said[]
  time: string
  tick?: Tick
  // What a line still going out says ("sending…", or why it waits), and whether that is a warning.
  pending?: { text: string; isWarn: boolean }
  // Draw who wrote: always for theirs; for mine only when the side alone does not say it (an AI's, a computer's).
  hasHead: boolean
}

type Bubble = { lines: string[]; quote?: Said['quote']; w: number; h: number; isPending: boolean }

const bubbleWidthOf = (o: RunOpts): number =>
  Math.min(TALK.maxBubble, o.width - (o.who.isMine ? TALK.sideRoom : TALK.textX + TALK.sideRoom / 2))

function bubbleOf(said: Said, max: number): Bubble {
  const inner = max - TALK.padX * 2
  const lines = wrapLines(said.text, { max: inner, measure: BODY })
  const textW = Math.max(...lines.map(line => BODY(line)), said.quote === undefined ? 0 : inner)
  const w = Math.ceil(Math.min(max, textW + TALK.padX * 2))
  const h = lines.length * TALK.lineH + TALK.padY * 2 + (said.quote === undefined ? 0 : TALK.quoteH)
  return { lines, quote: said.quote, w, h, isPending: said.isPending }
}

// The line a reply answers: a bar of ink, who wrote it, its first words.
const QUOTE = { bar: 2, inset: 8, nameY: 11, textY: 25, nameSize: 11.5, textSize: 12 }

function quoteSvg(q: NonNullable<Said['quote']>, o: { x: number; y: number; w: number }): string {
  const left = o.x + TALK.padX
  const room = o.w - TALK.padX * 2 - QUOTE.inset
  const top = o.y + TALK.padY
  return [
    `<rect x="${num(left)}" y="${num(top)}" width="${QUOTE.bar}" height="${TALK.quoteH - QUOTE.inset}" rx="1" class="f-lo"/>`,
    textEl({ x: left + QUOTE.inset, y: top + QUOTE.nameY, text: fitText(q.name, room, sans(QUOTE.nameSize, NAME_WEIGHT)), paint: 'mid', size: QUOTE.nameSize, weight: NAME_WEIGHT }),
    textEl({ x: left + QUOTE.inset, y: top + QUOTE.textY, text: fitText(q.text, room, sans(QUOTE.textSize)), paint: 'lo', size: QUOTE.textSize }),
  ].join('')
}

function bubbleSvg(b: Bubble, o: { x: number; y: number; isMine: boolean }): string {
  const surface = o.isMine
    ? veilRect({ x: o.x, y: o.y, w: b.w, h: b.h, r: TALK.radius, fill: VEIL.fill, ...(b.isPending ? { edge: VEIL.edge, isDashed: true } : {}) })
    : veilRect({ x: o.x, y: o.y, w: b.w, h: b.h, r: TALK.radius, fill: VEIL.soft, edge: VEIL.edge, isDashed: b.isPending })
  const top = o.y + TALK.padY + (b.quote === undefined ? 0 : TALK.quoteH)
  const words = b.lines.map((line, i) => textEl({ x: o.x + TALK.padX, y: baseline(top + i * TALK.lineH, TALK.lineH, TALK.size), text: line, paint: 'hi', size: TALK.size }))
  return [surface, b.quote === undefined ? '' : quoteSvg(b.quote, { x: o.x, y: o.y, w: b.w }), ...words].join('')
}

// Mine, when it says something the side does not: who wrote ("Your AI", or the computer in the person's own room),
// at the right edge, the crab or monogram beside it.
function mineHeadSvg(o: RunOpts): string {
  const room = o.width - TALK.textX
  const label = fitText(o.who.label, room, sans(TALK.nameSize, NAME_WEIGHT))
  const y = baseline(0, TALK.headH, TALK.nameSize)
  return [
    textEl({ x: o.width - TALK.textX, y, text: label, paint: 'hi', size: TALK.nameSize, weight: NAME_WEIGHT, anchor: 'end' }),
    faceOf({ name: o.who.name, isAgent: o.who.isAgent, x: o.width - TALK.face, y: (TALK.headH - TALK.face) / 2, size: TALK.face }),
  ].join('')
}

// Theirs: who wrote, then the time in the quiet ink.
function headSvg(o: RunOpts): string {
  if (o.who.isMine) return mineHeadSvg(o)
  const room = o.width - TALK.textX - textWidth(o.time, TALK.metaSize) - TIME_GAP
  const label = fitText(o.who.label, room, sans(TALK.nameSize, NAME_WEIGHT))
  const y = baseline(0, TALK.headH, TALK.nameSize)
  const timeX = TALK.textX + textWidth(label, TALK.nameSize, NAME_WEIGHT) + TIME_GAP
  return [
    faceOf({ name: o.who.name, isAgent: o.who.isAgent, x: 0, y: (TALK.headH - TALK.face) / 2, size: TALK.face }),
    textEl({ x: TALK.textX, y, text: label, paint: 'hi', size: TALK.nameSize, weight: NAME_WEIGHT }),
    textEl({ x: timeX, y, text: o.time, paint: 'lo', size: TALK.metaSize }),
  ].join('')
}

const TICK_GAP = 6

// Mine: the time, then what became of the last line, against the right edge.
function metaSvg(o: RunOpts, y: number): string {
  const by = baseline(y, TALK.metaH, TALK.metaSize)
  if (o.pending !== undefined) {
    const words = `${o.time} · ${o.pending.text}`
    return textEl({ x: o.width - 2, y: by, text: words, paint: o.pending.isWarn ? 'warn' : 'lo', size: TALK.metaSize, anchor: 'end' })
  }
  if (o.tick === undefined || o.tick === 'pending') return textEl({ x: o.width - 2, y: by, text: o.time, paint: 'lo', size: TALK.metaSize, anchor: 'end' })
  const checks = checksPiece({ isDouble: o.tick !== 'sent', paint: o.tick === 'read' ? 'read' : 'lo' })
  const cx = o.width - 2 - checks.width
  return [
    textEl({ x: cx - TICK_GAP, y: by, text: o.time, paint: 'lo', size: TALK.metaSize, anchor: 'end' }),
    `<g transform="translate(${num(cx)} ${num(y + (TALK.metaH - checks.height) / 2)})">${checks.body}</g>`,
  ].join('')
}

export function runPic(o: RunOpts): SvgPic {
  const max = bubbleWidthOf(o)
  const bubbles = o.said.map(s => bubbleOf(s, max))
  const isTheirs = !o.who.isMine
  let y = o.hasHead ? TALK.headH + TALK.gap : 0
  const parts: string[] = o.hasHead ? [headSvg(o)] : []
  for (const b of bubbles) {
    parts.push(bubbleSvg(b, { x: isTheirs ? TALK.textX : o.width - b.w, y, isMine: !isTheirs }))
    y += b.h + TALK.gap
  }
  if (!isTheirs) parts.push(metaSvg(o, y))
  const height = Math.ceil(isTheirs ? y - TALK.gap : y + TALK.metaH)
  return toPic({ body: parts.join(''), width: Math.floor(o.width), height, alt: altOf(o) })
}

function altOf(o: RunOpts): string {
  const words = o.said.map(s => (s.quote === undefined ? s.text : `(${s.quote.name}: ${s.quote.text}) ${s.text}`)).join(' / ')
  return [`${o.who.label}, ${o.time}`, words, o.pending?.text ?? ''].filter(Boolean).join(': ')
}

const DIVIDER_H = 28
const DIVIDER_SIZE = 11.5
const DIVIDER_GAP = 10
// The unread rule in the accent, half strength: it marks a place, it is not a warning.
const NEW_RULE = 0.5

// The day, or where the unread lines begin (in the accent): a short word between two lines of thin ink.
export function dividerPic(o: { width: number; text: string; isNew: boolean; pin?: boolean }): SvgPic {
  const w = Math.floor(o.width)
  const tw = textWidth(o.text, DIVIDER_SIZE, NAME_WEIGHT)
  const y = DIVIDER_H / 2
  const left = (w - tw) / 2 - DIVIDER_GAP
  const rule = (x1: number, x2: number) => `<path d="M${num(x1)} ${num(y + 0.5)}H${num(x2)}" class="${o.isNew ? 's-edit' : 's-hi'}" stroke-opacity="${o.isNew ? NEW_RULE : VEIL.rule}"/>`
  const body = [
    rule(0, left),
    textEl({ x: w / 2, y: baseline(0, DIVIDER_H, DIVIDER_SIZE), text: o.text, paint: o.isNew ? 'edit' : 'lo', size: DIVIDER_SIZE, weight: NAME_WEIGHT, anchor: 'middle' }),
    rule(w - left, w),
  ].join('')
  return themed(toPic({ body, width: w, height: DIVIDER_H, alt: o.text }), o.pin)
}
