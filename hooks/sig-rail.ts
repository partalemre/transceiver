// The rooms list's Svg: a section's label, a row's second line (the receipt and the last line, fitted) and the
// foot's status, shown only when something is wrong.
import type { Part } from './kit/svg-core'
import { checksPiece, dotPiece, eyebrowPiece, rowPart, textPiece, type Piece } from './sig-ui'

export const sectionPart = (o: { width: number; text: string }): Part =>
  rowPart({ width: o.width, height: 16, left: [eyebrowPiece(o.text, { paint: 'lo' })], alt: o.text })

export type PreviewOpts = { width: number; text: string; isUnread: boolean; ticks?: 'one' | 'two' | 'read'; paint?: string }

// "✓✓ Teşekkürler, okudum…", fitted to the row.
export function previewPart(o: PreviewOpts): Part {
  const lead: Piece[] = []
  if (o.ticks !== undefined) lead.push(checksPiece({ isDouble: o.ticks !== 'one', paint: o.ticks === 'read' ? 'read' : 'lo' }))
  const room = o.width - lead.reduce((n, p) => n + p.width + 6, 0)
  const text = textPiece(o.text, { size: 12.5, paint: o.paint ?? (o.isUnread ? 'hi' : 'lo'), max: room })
  return rowPart({ width: o.width, height: 18, left: [...lead, text], gap: 6, alt: o.text })
}

// ● bağlantı bekleniyor
export function statusPart(o: { width: number; text: string; paint: string }): Part {
  return rowPart({ width: o.width, height: 18, left: [dotPiece(7, o.paint), textPiece(o.text, { size: 12, paint: 'lo', max: o.width - 16 })], alt: o.text })
}
