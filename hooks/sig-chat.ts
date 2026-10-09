// The chat's Svg: a face with its presence dot, the breathing signal glyph and its pill, a message's time and
// receipt, a reply's quote, the "n yeni mesaj" rule and the head beside the face.
import { baseline, num, outlineEl, place, rectEl, sans, textEl } from './kit/svg-core'
import type { Part } from './kit/svg-core'
import { fitText } from './kit/svg-metrics'
import { checksPiece, glyphPiece, rowPart, textPiece, type Piece } from './sig-ui'

const INITIALS_RATIO = 0.36
const INITIALS_WEIGHT = 650
const DOT_RATIO = 0.3
const RING = 2

// A person's circle with initials; a green dot with a ring of the sheet when they were here lately.
export function facePart(o: { initials: string; paint: string; size: number; isHere?: boolean }): Part {
  const r = o.size / 2
  const fontSize = Math.round(o.size * INITIALS_RATIO)
  const dot = Math.round(o.size * DOT_RATIO)
  const cx = o.size - dot / 2
  const body = [
    `<circle cx="${r}" cy="${r}" r="${r}" class="f-${o.paint}-tint"/>`,
    `<circle cx="${r}" cy="${r}" r="${num(r - 0.5)}" fill="none" class="s-${o.paint}-line"/>`,
    textEl({ x: r, y: baseline(0, o.size, fontSize), text: o.initials, paint: o.paint, size: fontSize, weight: INITIALS_WEIGHT, anchor: 'middle' }),
    o.isHere === true ? `<circle cx="${num(cx)}" cy="${num(cx)}" r="${num(dot / 2 + RING / 2)}" class="f-ok s-sheet" stroke-width="${RING}"/>` : '',
  ]
  return { body: body.join(''), width: o.size, height: o.size, alt: o.isHere === true ? `${o.initials}, burada` : o.initials }
}

const SIGNAL_GRID = 14
const SIGNAL_INNER = 'M4.6 4.6a3.4 3.4 0 0 0 0 4.8M9.4 4.6a3.4 3.4 0 0 1 0 4.8'
const SIGNAL_OUTER = 'M2.6 2.6a6.2 6.2 0 0 0 0 8.8M11.4 2.6a6.2 6.2 0 0 1 0 8.8'
const SIGNAL_DOT = 1.3
const SIGNAL_STROKE = 1.5

// ((·)): the one glyph that moves. `isLive` breathes its arcs, the outer a beat later; still when idle, and the
// kit's reduced-motion rule stops it for whoever asked.
export function signalPiece(o: { size: number; paint: string; isLive: boolean }): Piece {
  const scale = o.size / SIGNAL_GRID
  const inner = o.isLive ? ' breathe' : ''
  const outer = o.isLive ? ' breathe txd' : ''
  const body = [
    `<g transform="scale(${num(scale)})" fill="none" stroke-width="${num(SIGNAL_STROKE / scale)}" stroke-linecap="round">`,
    `<circle cx="7" cy="7" r="${SIGNAL_DOT}" class="f-${o.paint}" stroke="none"/>`,
    `<path d="${SIGNAL_INNER}" class="s-${o.paint}${inner}"/><path d="${SIGNAL_OUTER}" class="s-${o.paint}${outer}"/></g>`,
  ]
  return { body: body.join(''), width: o.size, height: o.size }
}

const PILL_H = 24
const PILL_PAD = 9
const PILL_GLYPH = 14
const PILL_GAP = 6
const PILL_TEXT = { size: 11.5, weight: 600 }

// "((·)) 0,7 sn": the last poll's round trip in a signal pill.
export function signalPillPart(o: { text: string; isLive: boolean }): Part {
  const label = textPiece(o.text, { ...PILL_TEXT, paint: 'signal' })
  const width = PILL_PAD * 2 + PILL_GLYPH + PILL_GAP + label.width
  const box = { x: 0, y: 0, width, height: PILL_H, radius: PILL_H / 2 }
  const body = [
    rectEl({ ...box, paint: 'signal-tint' }), outlineEl({ ...box, paint: 'signal-line' }),
    place(signalPiece({ size: PILL_GLYPH, paint: 'signal', isLive: o.isLive }).body, PILL_PAD, (PILL_H - PILL_GLYPH) / 2),
    place(label.body, PILL_PAD + PILL_GLYPH + PILL_GAP, (PILL_H - label.height) / 2),
  ]
  return { body: body.join(''), width, height: PILL_H, alt: `sinyal ${o.text}` }
}

const STAMP_H = 14
const STAMP_TEXT = { size: 11 }
const STAMP_GAP = 4
const CLOCK = 12

export type StampOpts = { time?: string; ticks?: 'one' | 'two' | 'read'; status?: { text: string; paint: string } }

const TICK_WORD: Record<NonNullable<StampOpts['ticks']>, string> = { one: 'gönderildi', two: 'ulaştı', read: 'okundu' }

// "18:33 ✓✓" (Tide once read), or "gönderiliyor ◷" while it goes out (amber when it waits for "Bağlan").
export function stampPart(o: StampOpts): Part {
  const pieces: Piece[] = []
  if (o.status !== undefined) {
    pieces.push(textPiece(o.status.text, { ...STAMP_TEXT, paint: o.status.paint }), glyphPiece('clock', { size: CLOCK, paint: o.status.paint, stroke: 1.5 }))
  } else if (o.time !== undefined) pieces.push(textPiece(o.time, { ...STAMP_TEXT, paint: 'lo' }))
  if (o.status === undefined && o.ticks !== undefined) pieces.push(checksPiece({ isDouble: o.ticks !== 'one', paint: o.ticks === 'read' ? 'read' : 'lo' }))
  const width = pieces.reduce((n, p) => n + p.width, 0) + STAMP_GAP * Math.max(0, pieces.length - 1)
  const alt = [o.status?.text, o.time, o.ticks === undefined ? undefined : TICK_WORD[o.ticks]]
  return { ...rowPart({ width, height: STAMP_H, left: pieces, gap: STAMP_GAP, alt: '' }), alt: alt.filter(Boolean).join(' · ') }
}

const QUOTE_PAD_X = 10
const QUOTE_PAD_Y = 6
const QUOTE_BAR = 2
const QUOTE_RADIUS = 8
const QUOTE_NAME = { size: 11.5, weight: 600 }
const QUOTE_TEXT = { size: 12.5 }
const QUOTE_GAP = 2

// The message a reply answers: an inset card, a signal bar on its left, the name and one line of its text.
export function quotePart(o: { name: string; text: string; maxWidth: number }): Part {
  const inner = o.maxWidth - QUOTE_PAD_X * 2
  const name = textPiece(o.name, { ...QUOTE_NAME, paint: 'signal', max: inner })
  const text = textPiece(o.text, { ...QUOTE_TEXT, paint: 'mid', max: inner })
  const width = Math.min(o.maxWidth, Math.max(name.width, text.width) + QUOTE_PAD_X * 2)
  const height = QUOTE_PAD_Y * 2 + name.height + QUOTE_GAP + text.height
  const body = [
    rectEl({ x: 0, y: 0, width, height, radius: QUOTE_RADIUS, paint: 'inset' }),
    rectEl({ x: 0, y: 0, width: QUOTE_BAR, height, paint: 'signal' }),
    place(name.body, QUOTE_PAD_X, QUOTE_PAD_Y), place(text.body, QUOTE_PAD_X, QUOTE_PAD_Y + name.height + QUOTE_GAP),
  ]
  return { body: body.join(''), width, height, alt: `${o.name}: ${o.text}` }
}

const RULE_GAP = 10
const RULE_H = 16
const NEW_TEXT = { size: 11, weight: 650 }

// ──── 2 yeni mesaj ──── in signal: where the unread messages start.
export function newRulePart(o: { text: string; width: number }): Part {
  const w = sans(NEW_TEXT.size, NEW_TEXT.weight)(o.text)
  const mid = o.width / 2
  const y = RULE_H / 2 + 0.5
  const body = [
    `<path d="M0 ${y}H${num(mid - w / 2 - RULE_GAP)}M${num(mid + w / 2 + RULE_GAP)} ${y}H${o.width}" class="s-signal-line"/>`,
    textEl({ x: mid, y: baseline(0, RULE_H, NEW_TEXT.size), text: o.text, paint: 'signal', ...NEW_TEXT, anchor: 'middle' }),
  ]
  return { body: body.join(''), width: o.width, height: RULE_H, alt: o.text }
}

const HEAD_GAP = 10
const TITLE = { size: 15, weight: 620 }
const SUB = { size: 12 }
const LINE_GAP = 2

export type HeadOpts = { face: Part; title: string; sub?: string; subPaint?: string; isMonoTitle?: boolean; width: number }

// [face] title / sub: a chat's head, a row's name, a card's who.
export function headLinePart(o: HeadOpts): Part {
  const x = o.face.width + HEAD_GAP
  const w = Math.max(0, o.width - x)
  const title = textPiece(o.title, { ...TITLE, paint: 'hi', isMono: o.isMonoTitle, max: w })
  const sub = o.sub === undefined || o.sub === '' ? null : textPiece(o.sub, { ...SUB, paint: o.subPaint ?? 'lo', max: w })
  const textH = title.height + (sub === null ? 0 : LINE_GAP + sub.height)
  const height = Math.max(o.face.height, textH)
  const top = Math.round((height - textH) / 2)
  const body = [
    place(o.face.body, 0, Math.round((height - o.face.height) / 2)), place(title.body, x, top),
    sub === null ? '' : place(sub.body, x, top + title.height + LINE_GAP),
  ]
  return { body: body.join(''), width: o.width, height, alt: [o.title, o.sub].filter(Boolean).join(' — ') }
}

export const fitWidth = (text: string, size: number, max: number): string => fitText(text, max, sans(size))
