// The breathing signal glyph, the one drawing that moves while a room is live.
import { num } from './kit/svg-core'
import type { Piece } from './sig-ui'

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
