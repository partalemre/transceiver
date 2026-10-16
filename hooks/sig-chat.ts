// The chat's Svg: a face with its presence dot and the breathing signal glyph. (Words are native Text.)
import { baseline, num, sans, textEl } from './kit/svg-core'
import type { Part } from './kit/svg-core'
import { fitText } from './kit/svg-metrics'
import { rings } from './kit/motion'
import type { Piece } from './sig-ui'
import { pick } from './kit/lang'

const INITIALS_RATIO = 0.36
const INITIALS_WEIGHT = 650
const DOT_RATIO = 0.3
const RING = 2

// The green dot of a person here lately, ringed by the sheet; rings go out of it while they are (kit/motion.ts).
function hereDot(size: number): string {
  const dot = Math.round(size * DOT_RATIO)
  const c = size - dot / 2
  const r = dot / 2 + RING / 2
  return `${rings({ cx: c, cy: c, r, className: 'f-ok' })}<circle cx="${num(c)}" cy="${num(c)}" r="${num(r)}" class="f-ok s-sheet" stroke-width="${RING}"/>`
}

// A person's circle with initials; a green dot with a ring of the sheet when they were here lately.
export function facePart(o: { initials: string; paint: string; size: number; isHere?: boolean }): Part {
  const r = o.size / 2
  const fontSize = Math.round(o.size * INITIALS_RATIO)
  const body = [
    `<circle cx="${r}" cy="${r}" r="${r}" class="f-${o.paint}-tint"/>`,
    `<circle cx="${r}" cy="${r}" r="${num(r - 0.5)}" fill="none" class="s-${o.paint}-line"/>`,
    textEl({ x: r, y: baseline(0, o.size, fontSize), text: o.initials, paint: o.paint, size: fontSize, weight: INITIALS_WEIGHT, anchor: 'middle' }),
    o.isHere === true ? hereDot(o.size) : '',
  ]
  return { body: body.join(''), width: o.size, height: o.size, alt: o.isHere === true ? `${o.initials}, ${pick({ en: 'here', tr: 'burada' })}` : o.initials }
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

export const fitWidth = (text: string, size: number, max: number): string => fitText(text, max, sans(size))
