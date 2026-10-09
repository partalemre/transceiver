// The rooms rail's Svg: the brand head, a section's label, a row's second line (receipt or gate dot, the last
// line, fitted) and the connection footer.
import type { Part } from './kit/svg-core'
import { checksPiece, dotPiece, eyebrowPiece, rowPart, textPiece, type Piece } from './sig-ui'
import { tilePart } from './sig-states'

const BRAND_TILE = 36
const BRAND_GAP = 10

// [((·))] TRANSCEIVER / Sohbetler
export function brandPart(o: { width: number; title: string }): Part {
  const tile = tilePart({ glyph: 'signal', paint: 'signal', size: BRAND_TILE })
  const eyebrow = eyebrowPiece('TRANSCEIVER', { paint: 'signal' })
  const title = textPiece(o.title, { size: 17, weight: 620, paint: 'hi' })
  const x = BRAND_TILE + BRAND_GAP
  const top = Math.round((BRAND_TILE - eyebrow.height - title.height) / 2)
  const body = [tile.body, `<g transform="translate(${x} ${top})">${eyebrow.body}</g>`, `<g transform="translate(${x} ${top + eyebrow.height})">${title.body}</g>`]
  return { body: body.join(''), width: o.width, height: BRAND_TILE, alt: `Transceiver — ${o.title}` }
}

export const sectionPart = (o: { width: number; text: string }): Part =>
  rowPart({ width: o.width, height: 16, left: [eyebrowPiece(o.text, { paint: 'lo' })], alt: o.text })

export type PreviewOpts = { width: number; text: string; isUnread: boolean; ticks?: 'one' | 'two' | 'read'; dot?: string; paint?: string }

// "✓✓ Teşekkürler, okudum…" or "● kapı açık · 3 agent sorusu", fitted to the row.
export function previewPart(o: PreviewOpts): Part {
  const lead: Piece[] = []
  if (o.ticks !== undefined) lead.push(checksPiece({ isDouble: o.ticks !== 'one', paint: o.ticks === 'read' ? 'read' : 'lo' }))
  if (o.dot !== undefined) lead.push(dotPiece(6, o.dot))
  const room = o.width - lead.reduce((n, p) => n + p.width + 6, 0)
  const text = textPiece(o.text, { size: 12.5, paint: o.paint ?? (o.isUnread ? 'hi' : 'lo'), max: room })
  return rowPart({ width: o.width, height: 18, left: [...lead, text], gap: 6, alt: o.text })
}

// ● Bağlı · yoklama 1 sn
export function footerPart(o: { width: number; text: string; paint: string }): Part {
  return rowPart({ width: o.width, height: 18, left: [dotPiece(7, o.paint), textPiece(o.text, { size: 12, paint: 'lo', max: o.width - 16 })], alt: o.text })
}
