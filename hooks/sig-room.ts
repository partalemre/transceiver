// A project room's Svg: the gate strip under its head, and the wide pane's aside (the gate's four conditions, the
// ask budget as a segmented meter, today's counts).
import { baseline, outlineEl, place, rectEl, textEl } from './kit/svg-core'
import type { Part } from './kit/svg-core'
import { bodyPart } from './kit/svg-text'
import { eyebrowPiece, glyphPiece, rowPart, spanOf, stackPart, textPiece, type Piece } from './sig-ui'

export type GateTone = { paint: string; label: string }

const STRIP_PAD_X = 12
const STRIP_PAD_Y = 10
const STRIP_GAP = 8
const STRIP_R = 12
const STRIP_ROW = 18
const BAR_H = 4
const SMALL = { size: 11.5 }

export type StripOpts = {
  width: number; tone: GateTone; detail: string; ago?: string
  ask: { used: number; limit: number }; modelless: number
}

function barPiece(o: { width: number; ratio: number; paint: string; track: string }): Piece {
  const fill = Math.round(o.width * Math.min(1, Math.max(0, o.ratio)))
  const y = (STRIP_ROW - BAR_H) / 2
  const body = [
    rectEl({ x: 0, y, width: o.width, height: BAR_H, radius: BAR_H / 2, paint: o.track }),
    fill > 0 ? rectEl({ x: 0, y, width: fill, height: BAR_H, radius: BAR_H / 2, paint: o.paint }) : '',
  ]
  return { body: body.join(''), width: o.width, height: STRIP_ROW }
}

// KAPI AÇIK @alperenx collaborator ··· 3 dk önce / ask bugün ━━━━━━ 10/10 · 13 modelsiz
export function gateStripPart(o: StripOpts): Part {
  const w = o.width - STRIP_PAD_X * 2
  const isFull = o.ask.used >= o.ask.limit
  const lead = [glyphPiece('shield', { size: 16, paint: o.tone.paint }), eyebrowPiece(o.tone.label, { paint: o.tone.paint })]
  const ago = o.ago === undefined ? [] : [textPiece(o.ago, { ...SMALL, paint: 'lo' })]
  const detail = textPiece(o.detail, { size: 12, paint: 'mid', max: w - spanOf([...lead, ...ago]) - 24 })
  const top = rowPart({ width: w, height: STRIP_ROW, left: [...lead, detail], right: ago, alt: '' })
  const label = textPiece('ask bugün', { ...SMALL, paint: 'mid' })
  const right = [textPiece(`${o.ask.used}/${o.ask.limit}`, { ...SMALL, paint: isFull ? 'warn' : 'mid' }), textPiece(`· ${o.modelless} modelsiz`, { ...SMALL, paint: 'lo' })]
  const barW = Math.max(24, w - label.width - spanOf(right) - 30)
  const bar = barPiece({ width: barW, ratio: o.ask.used / o.ask.limit, paint: isFull ? 'warn' : o.tone.paint, track: `${o.tone.paint}-line` })
  const bottom = rowPart({ width: w, height: STRIP_ROW, left: [label, bar], right, gap: 10, alt: '' })
  const height = STRIP_PAD_Y * 2 + STRIP_ROW * 2 + STRIP_GAP
  const box = { x: 0, y: 0, width: o.width, height, radius: STRIP_R }
  const body = [
    rectEl({ ...box, paint: `${o.tone.paint}-tint` }), outlineEl({ ...box, paint: `${o.tone.paint}-line` }),
    place(top.body, STRIP_PAD_X, STRIP_PAD_Y), place(bottom.body, STRIP_PAD_X, STRIP_PAD_Y + STRIP_ROW + STRIP_GAP),
  ]
  const alt = `${o.tone.label}: ${o.detail}${o.ago ? `, ${o.ago}` : ''}. Ask bugün ${o.ask.used}/${o.ask.limit}, ${o.modelless} modelsiz.`
  return { body: body.join(''), width: o.width, height, alt }
}

export type Check = { text: string; state: boolean | null; isMono?: boolean }

const CHECK_ROW = 20
const SECTION_GAP = 10

// ✓ / ✕ / ○ and the condition, one per row, under its eyebrow and above a meta line.
export function checklistPart(o: { width: number; tone: GateTone; checks: readonly Check[]; meta: string }): Part {
  const head = rowPart({ width: o.width, height: CHECK_ROW, left: [glyphPiece('shield', { size: 16, paint: o.tone.paint }), eyebrowPiece(o.tone.label, { paint: o.tone.paint })], alt: o.tone.label })
  const rows = o.checks.map(c => {
    const mark = c.state === null ? glyphPiece('clock', { size: 14, paint: 'lo' }) : glyphPiece(c.state ? 'check' : 'cross', { size: 14, paint: c.state ? 'ok' : 'danger', stroke: 1.8 })
    const text = textPiece(c.text, { size: 13, paint: c.state === false ? 'mid' : 'hi', isMono: c.isMono, max: o.width - 22 })
    return rowPart({ width: o.width, height: CHECK_ROW, left: [mark, text], alt: `${c.state === null ? '?' : c.state ? '✓' : '✕'} ${c.text}` })
  })
  const meta = rowPart({ width: o.width, height: CHECK_ROW, left: [textPiece(o.meta, { ...SMALL, paint: 'lo', max: o.width })], alt: o.meta })
  return stackPart([head, ...rows, meta], { width: o.width, gap: 6 })
}

const SEGMENT_H = 6
const SEGMENT_GAP = 3
const BIG = { size: 24, weight: 650 }

// ASK BÜTÇESİ / 3 / 10 bugün / ▬▬▬▭▭▭▭▭▭▭ / a note.
export function budgetPart(o: { width: number; used: number; limit: number; note: string }): Part {
  const isFull = o.used >= o.limit
  const eyebrow = rowPart({ width: o.width, height: CHECK_ROW, left: [eyebrowPiece('Ask bütçesi', { paint: 'lo' })], alt: 'Ask bütçesi' })
  const big = textPiece(String(o.used), { ...BIG, paint: isFull ? 'warn' : 'hi' })
  const count = rowPart({ width: o.width, height: big.height, left: [big, textPiece(`/ ${o.limit} bugün`, { size: 14, paint: 'lo' })], gap: 6, alt: `${o.used} / ${o.limit} bugün` })
  const seg = (o.width - SEGMENT_GAP * (o.limit - 1)) / o.limit
  const segments = Array.from({ length: o.limit }, (_, i) =>
    rectEl({ x: i * (seg + SEGMENT_GAP), y: 0, width: seg, height: SEGMENT_H, radius: SEGMENT_H / 2, paint: i < o.used ? (isFull ? 'warn' : 'run') : 'track' }))
  const meter: Part = { body: segments.join(''), width: o.width, height: SEGMENT_H, alt: '' }
  const note = bodyPart({ text: o.note, width: o.width, size: 11.5, lineHeight: 15, paint: 'lo', maxLines: 2 })
  return stackPart([eyebrow, count, meter, note], { width: o.width, gap: 8 })
}

const TILE_H = 52
const TILE_GAP = 8
const TILE_R = 10
const TILE_PAD = 8

export type Stat = { value: number; label: string; paint: string }

// BUGÜN / three inset tiles: a count and what it counts.
export function statsPart(o: { width: number; stats: readonly Stat[] }): Part {
  const eyebrow = rowPart({ width: o.width, height: CHECK_ROW, left: [eyebrowPiece('Bugün', { paint: 'lo' })], alt: 'Bugün' })
  const w = (o.width - TILE_GAP * (o.stats.length - 1)) / o.stats.length
  const tiles = o.stats.map((s, i) => {
    const x = i * (w + TILE_GAP)
    return [
      rectEl({ x, y: 0, width: w, height: TILE_H, radius: TILE_R, paint: 'inset' }),
      textEl({ x: x + TILE_PAD, y: baseline(TILE_PAD, 22, 18), text: String(s.value), paint: s.paint, size: 18, weight: 650 }),
      textEl({ x: x + TILE_PAD, y: baseline(TILE_PAD + 24, 14, 11), text: s.label, paint: 'lo', size: 11 }),
    ].join('')
  })
  const row: Part = { body: tiles.join(''), width: o.width, height: TILE_H, alt: o.stats.map(s => `${s.value} ${s.label}`).join(', ') }
  return stackPart([eyebrow, row], { width: o.width, gap: SECTION_GAP })
}
