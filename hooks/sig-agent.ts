// Agent traffic's one Svg: the asker's small face beside an exchange. (Words are native Text.)
import { num, place } from './kit/svg-core'
import { dotPiece, textPiece, type Piece } from './sig-ui'

// A small face for "ALPEREN'İN AGENT'I SORDU": the asker's initials in their colour.
export function tinyFace(o: { initials: string; paint: string; size: number }): Piece {
  const r = o.size / 2
  const label = textPiece(o.initials, { size: Math.round(o.size * 0.47), weight: 700, paint: o.paint })
  return {
    body: `<circle cx="${r}" cy="${r}" r="${num(r - 0.5)}" class="f-${o.paint}-tint s-${o.paint}-line"/>${place(label.body, (o.size - label.width) / 2, (o.size - label.height) / 2)}`,
    width: o.size, height: o.size,
  }
}

export const bulletPiece = (paint: string): Piece => dotPiece(6, paint)
