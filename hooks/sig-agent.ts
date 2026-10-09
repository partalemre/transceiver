// Agent traffic in Svg: an exchange folded to one line, the answer's meta (who answered, tokens, how long) and
// the compact bodies (a diff's stat, test pills, search hits, lists, TODO tags, a commit).
import { num, place, rectEl } from './kit/svg-core'
import type { Part } from './kit/svg-core'
import type { Compact, DiffStat, Hit } from './answers'
import { dotPiece, eyebrowPiece, pillPiece, rowPart, stackPart, textPiece, type Piece } from './sig-ui'

const HEAD_H = 20
const META_H = 18
const SMALL = { size: 11.5 }
const MONO = { size: 12, isMono: true }
const TIME = { size: 11, paint: 'lo' }
// What a row puts between the lead and the words, kept in hand when fitting them.
const LINE_GAP_PX = 12

// [face] Alperen'in agent'ı diff sordu · cevaplandı · 0 token: one exchange, folded to a line. Its time is in the
// opened answer; the line keeps its width for the words.
export function txLinePart(o: { width: number; lead: Piece; text: string; paint: string }): Part {
  const text = textPiece(o.text, { size: 12, paint: o.paint, max: o.width - o.lead.width - LINE_GAP_PX })
  return rowPart({ width: o.width, height: HEAD_H, left: [o.lead, text], alt: o.text })
}

export type MetaOpts = { width: number; who: string; tokens: number; extra?: string; right?: string }

// "Alperen'in agent'ı · 312 token · 2,1 sn", or "Bu makine cevapladı [0 token] 7 eşleşme".
export function answerMetaPart(o: MetaOpts): Part {
  const who = textPiece(o.who, { ...SMALL, weight: 600, paint: 'mid' })
  const left: Piece[] = o.tokens > 0
    ? [who, textPiece([`· ${o.tokens} token`, o.extra].filter(Boolean).join(' · '), { ...SMALL, paint: 'lo' })]
    : [who, pillPiece('0 token', { paint: 'signal', height: 18, size: 10.5, weight: 700 }), ...(o.extra ? [textPiece(o.extra, { ...SMALL, paint: 'lo' })] : [])]
  const right = o.right === undefined ? [] : [textPiece(o.right, TIME)]
  return rowPart({ width: o.width, height: META_H, left, right, alt: [o.who, `${o.tokens} token`, o.extra, o.right].filter(Boolean).join(' · ') })
}

const SQUARES = 5
const SQUARE = 8
const SQUARE_GAP = 2
const SQUARE_R = 2

function squarePaint(i: number, green: number, red: number): string {
  if (i < green) return 'ok'
  return i < green + red ? 'danger' : 'track'
}

// Five squares: added in Moss, removed in Flare, the rest on the track, as GitHub draws a stat.
function squaresPiece(stat: DiffStat): Piece {
  const total = stat.added + stat.removed
  const green = total === 0 ? 0 : Math.round((stat.added / total) * (SQUARES - 1))
  const red = total === 0 ? 0 : Math.min(SQUARES - green, Math.max(stat.removed > 0 ? 1 : 0, Math.round((stat.removed / total) * (SQUARES - 1))))
  const paints = Array.from({ length: SQUARES }, (_, i) => squarePaint(i, green, red))
  const body = paints.map((paint, i) => rectEl({ x: i * (SQUARE + SQUARE_GAP), y: 0, width: SQUARE, height: SQUARE, radius: SQUARE_R, paint })).join('')
  return { body, width: SQUARES * (SQUARE + SQUARE_GAP) - SQUARE_GAP, height: SQUARE }
}

const statPieces = (stat: DiffStat): Piece[] => [
  textPiece(`${stat.files} dosya`, { ...MONO, paint: 'mid' }), textPiece(`+${stat.added}`, { ...MONO, paint: 'ok' }),
  textPiece(`−${stat.removed}`, { ...MONO, paint: 'danger' }), squaresPiece(stat),
]

const ROW_H = 18
const LINE_GAP = 4

function hitsPart(rows: readonly Hit[], width: number): Part {
  const lines = rows.map(h => {
    const loc = textPiece(h.loc, { size: 11.5, isMono: true, paint: 'read', max: width })
    const text = textPiece(h.text, { size: 11.5, isMono: true, paint: 'mid', max: Math.max(0, width - loc.width - 8) })
    return rowPart({ width, height: ROW_H, left: [loc, text], alt: `${h.loc} ${h.text}` })
  })
  return stackPart(lines, { width, gap: LINE_GAP })
}

function listPart(items: readonly string[], width: number): Part {
  return stackPart(items.map(item => rowPart({ width, height: ROW_H, left: [textPiece(item, { size: 11.5, isMono: true, paint: 'mid', max: width })], alt: item })), { width, gap: LINE_GAP })
}

const okPill = (text: string): Piece => pillPiece(`✓ ${text}`, { paint: 'ok', height: 22, size: 11.5 })
const plainPill = (text: string): Piece => pillPiece(text, { paint: 'mid', tint: 'card', line: 'line', height: 22, size: 11.5, weight: 500 })

// The answer's body, compact; `shown` rows of a search or a list (the rest behind "Göster").
export function compactPart(c: Compact, o: { width: number; shown: number }): Part | null {
  const row = (left: Piece[], alt: string) => rowPart({ width: o.width, height: 22, left, alt })
  if (c.kind === 'diff') return row(statPieces(c.stat), `${c.stat.files} dosya +${c.stat.added} −${c.stat.removed}`)
  if (c.kind === 'tests') return row([okPill(`${c.passed} geçti`), c.failed > 0 ? pillPiece(`${c.failed} kaldı`, { paint: 'danger', height: 22, size: 11.5 }) : plainPill('0 kaldı')], `${c.passed} geçti, ${c.failed} kaldı`)
  if (c.kind === 'hits') return hitsPart(c.rows.slice(0, o.shown), o.width)
  if (c.kind === 'list') return listPart(c.items.slice(0, o.shown), o.width)
  if (c.kind === 'tags') return row(c.tags.map(t => plainPill(`${t.tag} ${t.count}`)), c.tags.map(t => `${t.tag} ${t.count}`).join(', '))
  if (c.kind === 'commit') {
    const subject = rowPart({ width: o.width, height: ROW_H, left: [textPiece(c.subject, { size: 13, paint: 'hi', max: o.width })], alt: c.subject })
    return stackPart([subject, c.stat === null ? null : row(statPieces(c.stat), 'stat')], { width: o.width, gap: LINE_GAP })
  }
  return null
}

// The sheet's lead: ALPEREN'İN AGENT'INA SOR ··· 12 hazır sorgu · 0 token
export function sheetHeadPart(o: { width: number; title: string; meta: string }): Part {
  return rowPart({ width: o.width, height: HEAD_H, left: [eyebrowPiece(o.title, { paint: 'run' })], right: [textPiece(o.meta, { size: 11.5, paint: 'lo' })], alt: `${o.title} · ${o.meta}` })
}

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
