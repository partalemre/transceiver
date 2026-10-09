// The cards' Svg: an icon tile and a person's repos as pills.
import { outlineEl, place, rectEl } from './kit/svg-core'
import type { Part } from './kit/svg-core'
import { signalPiece } from './sig-chat'
import { dotPiece, glyphPiece, rowPart, textPiece, type GlyphName, type Piece } from './sig-ui'

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

const PILL_H = 24
const PILL_PAD = 10
const PILL_DOT = 6

// ● eliti · collaborator  ● tahminx · değil
export function repoPillsPart(o: { width: number; repos: ReadonlyArray<{ repo: string; isCollaborator: boolean }> }): Part {
  const pills = o.repos.map(r => {
    const paint = r.isCollaborator ? 'ok' : 'lo'
    const label = textPiece(`${r.repo.split('/')[1] ?? r.repo} · ${r.isCollaborator ? 'collaborator' : 'değil'}`, { size: 12, paint })
    const width = PILL_PAD * 2 + PILL_DOT + 6 + label.width
    const box = { x: 0, y: 0, width, height: PILL_H, radius: PILL_H / 2 }
    const body = [
      rectEl({ ...box, paint: r.isCollaborator ? 'ok-tint' : 'card' }), outlineEl({ ...box, paint: r.isCollaborator ? 'ok-line' : 'line' }),
      place(dotPiece(PILL_DOT, r.isCollaborator ? 'ok' : 'line-strong').body, PILL_PAD, (PILL_H - PILL_DOT) / 2),
      place(label.body, PILL_PAD + PILL_DOT + 6, (PILL_H - label.height) / 2),
    ]
    return { body: body.join(''), width, height: PILL_H }
  })
  return rowPart({ width: o.width, height: PILL_H, left: pills, alt: o.repos.map(r => `${r.repo}: ${r.isCollaborator ? 'collaborator' : 'değil'}`).join(', ') })
}
