// A room's icon tile: a glyph (or the signal) in a role's tint.
import { outlineEl, place, rectEl } from './kit/svg-core'
import type { Part } from './kit/svg-core'
import { signalPiece } from './sig-chat'
import { glyphPiece, type GlyphName, type Piece } from './sig-ui'

// A rounded tile with a glyph (or the signal), in a role's tint.
export function tilePart(o: { glyph: GlyphName | 'signal'; paint: string; size: number; tint?: string; line?: string }): Part {
  const radius = Math.round(o.size / 4)
  const icon = Math.round(o.size / 2)
  const box = { x: 0, y: 0, width: o.size, height: o.size, radius }
  const glyph: Piece = o.glyph === 'signal' ? signalPiece({ size: icon, paint: o.paint, isLive: false }) : glyphPiece(o.glyph, { size: icon, paint: o.paint, stroke: 1.5 })
  const body = [
    rectEl({ ...box, paint: o.tint ?? `${o.paint}-tint` }), outlineEl({ ...box, paint: o.line ?? `${o.paint}-line` }),
    place(glyph.body, (o.size - icon) / 2, (o.size - icon) / 2),
  ]
  return { body: body.join(''), width: o.size, height: o.size, alt: '' }
}

