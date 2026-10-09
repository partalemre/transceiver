// Small Svg pieces laid in rows: text, eyebrows, pills, glyphs on a 16 grid (the boards' own drawings), receipts,
// and `rowPart`, which places pieces left and right in one line. Paint names only, never hex.
import { baseline, mono, num, outlineEl, place, rectEl, sans, TYPE, textEl, upperTr } from './kit/svg-core'
import type { Part } from './kit/svg-core'
import { fitText } from './kit/svg-metrics'
import { eyebrowWidth } from './kit/svg-text'

export type Piece = { body: string; width: number; height: number; alt?: string }

const LINE_RATIO = 1.3

export type TextOpts = { size: number; paint: string; weight?: number; isMono?: boolean; max?: number }

export function textPiece(text: string, o: TextOpts): Piece {
  const measure = o.isMono ? mono(o.size) : sans(o.size, o.weight)
  const fitted = o.max === undefined ? text : fitText(text, o.max, measure)
  const height = Math.round(o.size * LINE_RATIO)
  const body = textEl({ x: 0, y: baseline(0, height, o.size), text: fitted, size: o.size, weight: o.weight, paint: o.paint, isMono: o.isMono })
  return { body, width: Math.ceil(measure(fitted)), height, alt: fitted }
}

const tracking = TYPE.eyebrow.size * TYPE.eyebrow.tracking

// SENİN AGENT'IN SORDU: capitals (Turkish casing), tracked, 10.5/700.
export function eyebrowPiece(text: string, o: { paint: string; max?: number }): Piece {
  const label = o.max === undefined ? upperTr(text) : fitText(upperTr(text), o.max, eyebrowWidth)
  const height = Math.round(TYPE.eyebrow.size * LINE_RATIO) + 2
  const body = textEl({ x: 0, y: baseline(0, height, TYPE.eyebrow.size), text: label, paint: o.paint, ...TYPE.eyebrow, tracking })
  return { body, width: Math.ceil(eyebrowWidth(label)), height, alt: label }
}

export const gapPiece = (width: number): Piece => ({ body: '', width, height: 0 })
export const partPiece = (part: Part): Piece => ({ body: part.body, width: part.width, height: part.height, alt: part.alt })

const PILL_PAD = 8

// A full-radius pill: tint, hairline, text in the paint (mono for a query type or a path).
export type PillPieceOpts = { paint: string; height?: number; size?: number; isMono?: boolean; weight?: number; tint?: string; line?: string }

export function pillPiece(text: string, o: PillPieceOpts): Piece {
  const height = o.height ?? 20
  const size = o.size ?? 11
  const label = textPiece(text, { size, paint: o.paint, weight: o.weight ?? 600, isMono: o.isMono })
  const width = label.width + PILL_PAD * 2
  const box = { x: 0, y: 0, width, height, radius: height / 2 }
  const body = [
    rectEl({ ...box, paint: o.tint ?? `${o.paint}-tint` }), outlineEl({ ...box, paint: o.line ?? `${o.paint}-line` }),
    place(label.body, PILL_PAD, (height - label.height) / 2),
  ].join('')
  return { body, width, height, alt: text }
}

// The boards' glyphs, drawn on a 16 grid.
const GLYPHS = {
  back: 'M10 3.5 5.5 8l4.5 4.5',
  plus: 'M8 3.5v9M3.5 8h9',
  robot: 'M5 5h6a2.5 2.5 0 0 1 2.5 2.5v3A2.5 2.5 0 0 1 11 13H5a2.5 2.5 0 0 1-2.5-2.5v-3A2.5 2.5 0 0 1 5 5zM8 2.2V5M6 9h.01M10 9h.01',
  lock: 'M5 7h6a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM5.5 7V5a2.5 2.5 0 0 1 5 0v2',
  shield: 'M8 1.8 13 3.6v4c0 3.1-2.1 5.4-5 6.6-2.9-1.2-5-3.5-5-6.6v-4zm-2.4 6.2 1.7 1.7L10.6 6.4',
  link: 'M6.7 9.3 9.3 6.7M7.6 3.9 8.9 2.7a2.8 2.8 0 0 1 4 4l-1.2 1.2M8.4 12.1l-1.3 1.2a2.8 2.8 0 0 1-4-4l1.2-1.2',
  person: 'M10.6 6a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0zM3 13.5c.8-2.4 2.8-3.6 5-3.6s4.2 1.2 5 3.6',
  branch: 'M5.6 3.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0zM5.6 12.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0zM13.6 5.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0zM4 5.1v5.8M12 7.1c0 2.6-3.2 2.6-6.6 3.8',
  check: 'm3.4 8.2 3 3L12.6 5',
  cross: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  clock: 'M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0zM8 5v3l2 1.3',
  star: 'M8 1.8 9.5 6l4.3.2-3.4 2.7 1.2 4.2L8 10.7l-3.6 2.4 1.2-4.2-3.4-2.7L6.5 6z',
  doc: 'M4.5 2h7a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 11.5 14h-7A2.5 2.5 0 0 1 2 11.5v-7A2.5 2.5 0 0 1 4.5 2zM5.7 8h4.6',
} as const

export type GlyphName = keyof typeof GLYPHS
const GRID = 16
const GLYPH_STROKE = 1.6

export function glyphPiece(name: GlyphName, o: { size: number; paint: string; stroke?: number }): Piece {
  const scale = o.size / GRID
  const body = `<g transform="scale(${num(scale)})" fill="none" class="s-${o.paint}" stroke-width="${num((o.stroke ?? GLYPH_STROKE) / scale)}" stroke-linecap="round" stroke-linejoin="round"><path d="${GLYPHS[name]}"/></g>`
  return { body, width: o.size, height: o.size }
}

export const dotPiece = (size: number, paint: string): Piece =>
  ({ body: `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" class="f-${paint}"/>`, width: size, height: size })

const CHECKS = { one: 'M1 5.5 4 8.5 10 1.5', two: 'M1 5.5 4 8.5 10 1.5M7 8.5 13.5 1.5' }
const CHECKS_W = 16
const CHECKS_H = 10
const CHECKS_STROKE = 1.6

// ✓ written, ✓✓ reached them; the caller paints read ones in Tide.
export const checksPiece = (o: { isDouble: boolean; paint: string }): Piece => ({
  body: `<path d="${o.isDouble ? CHECKS.two : CHECKS.one}" fill="none" class="s-${o.paint}" stroke-width="${CHECKS_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>`,
  width: CHECKS_W, height: CHECKS_H,
})

export type RowOpts = { width: number; height: number; left: Piece[]; right?: Piece[]; gap?: number; alt: string }

const ROW_GAP = 8

// Pieces in one line: `left` from the start, `right` against the end, each centred on the row's height.
export function rowPart(o: RowOpts): Part {
  const gap = o.gap ?? ROW_GAP
  const at = (p: Piece, x: number) => place(p.body, x, Math.round((o.height - p.height) / 2))
  let x = 0
  const left = o.left.map(p => { const out = at(p, x); x += p.width + (p.width > 0 ? gap : 0); return out })
  let end = o.width
  const right = [...(o.right ?? [])].reverse().map(p => { end -= p.width; const out = at(p, end); end -= gap; return out })
  return { body: [...left, ...right].join(''), width: o.width, height: o.height, alt: o.alt }
}

// The width the row's `left` pieces take, gaps included: what is left for a fitted text.
export const spanOf = (pieces: readonly Piece[], gap = ROW_GAP): number =>
  pieces.reduce((n, p) => n + p.width, 0) + gap * Math.max(0, pieces.filter(p => p.width > 0).length - 1)

// Parts stacked top to bottom, `gap` px apart.
export function stackPart(parts: ReadonlyArray<Part | null>, o: { width: number; gap: number }): Part {
  let y = 0
  const placed = parts.filter((p): p is Part => p !== null).map(p => { const out = place(p.body, 0, y); y += p.height + o.gap; return { out, p } })
  return {
    body: placed.map(x => x.out).join(''), width: o.width, height: Math.max(0, y - o.gap),
    alt: placed.map(x => x.p.alt).filter(Boolean).join(' — '),
  }
}

// A 1 px rule across `width`.
export const rulePart = (width: number, paint = 'line'): Part =>
  ({ body: `<path d="M0 0.5H${width}" class="s-${paint}"/>`, width, height: 1, alt: '' })
