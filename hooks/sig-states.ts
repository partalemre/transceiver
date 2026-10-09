// The cards' Svg: the onboarding radio, an icon tile, a card's head (tile or face, eyebrow, title, meta), the
// numbered steps, a meta line with its glyph, and a person's repos as pills.
import { num, outlineEl, place, rectEl } from './kit/svg-core'
import type { Part } from './kit/svg-core'
import { linesPart } from './kit/svg-text'
import { signalPiece } from './sig-chat'
import { dotPiece, eyebrowPiece, glyphPiece, rowPart, stackPart, textPiece, type GlyphName, type Piece } from './sig-ui'

const ART_ARCS = [
  'M37 37a15.5 15.5 0 0 0 0 22M59 37a15.5 15.5 0 0 1 0 22',
  'M28 28a28 28 0 0 0 0 40M68 28a28 28 0 0 1 0 40',
  'M19 19a41 41 0 0 0 0 58M77 19a41 41 0 0 1 0 58',
]
const ART = 96
const ART_R = 14
const ART_STROKE = 2.4
const ART_DOT = 6
const DELAYS = ['', ' txd', ' txd2']

// The empty state's radio: three arcs each side of a dot, breathing in turn when `isLive`.
export function radioArtPart(o: { width: number; height: number; isLive: boolean }): Part {
  const box = { x: 0, y: 0, width: o.width, height: o.height, radius: ART_R }
  const arcs = ART_ARCS.map((d, i) => `<path d="${d}" class="s-signal${o.isLive ? ` breathe${DELAYS[i]}` : ''}"/>`).join('')
  const art = `<g fill="none" stroke-width="${ART_STROKE}" stroke-linecap="round"><circle cx="48" cy="48" r="${ART_DOT}" class="f-signal" stroke="none"/>${arcs}</g>`
  const body = [rectEl({ ...box, paint: 'signal-tint' }), outlineEl({ ...box, paint: 'signal-line' }), place(art, (o.width - ART) / 2, (o.height - ART) / 2)]
  return { body: body.join(''), width: o.width, height: o.height, alt: 'Telsiz' }
}

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

const LEAD_GAP = 12
const EYEBROW_GAP = 2

export type CardHeadOpts = { width: number; lead?: Part; eyebrow: string; paint: string; title: string; meta?: string; titleSize?: number }

// [tile] EYEBROW / Title ··· meta: the head every card opens with.
export function cardHeadPart(o: CardHeadOpts): Part {
  const x = o.lead === undefined ? 0 : o.lead.width + LEAD_GAP
  const meta = o.meta === undefined ? null : textPiece(o.meta, { size: 12, paint: 'lo' })
  const w = o.width - x - (meta === null ? 0 : meta.width + LEAD_GAP)
  const eyebrow = eyebrowPiece(o.eyebrow, { paint: o.paint, max: w })
  const size = o.titleSize ?? 17
  const title = linesPart({ text: o.title, width: w, size, weight: size > 17 ? 650 : 620, lineHeight: Math.round(size * 1.25), maxLines: 2 })
  const textH = eyebrow.height + EYEBROW_GAP + title.height
  const height = Math.max(o.lead?.height ?? 0, textH)
  const top = Math.round((height - textH) / 2)
  const body = [
    o.lead === undefined ? '' : place(o.lead.body, 0, Math.round((height - o.lead.height) / 2)),
    place(eyebrow.body, x, top), place(title.body, x, top + eyebrow.height + EYEBROW_GAP),
    meta === null ? '' : place(meta.body, o.width - meta.width, Math.round((height - meta.height) / 2)),
  ]
  return { body: body.join(''), width: o.width, height, alt: [eyebrow.alt, o.title, o.meta].filter(Boolean).join(' — ') }
}

const STEP = 20
const STEP_ROW = 22

// ① Oda aç ② Linki e-postayla paylaş ③ Yazış: the first filled, the rest outlined.
export function stepsPart(o: { width: number; steps: readonly string[] }): Part {
  const rows = o.steps.map((text, i) => {
    const r = STEP / 2
    const isFirst = i === 0
    const number = textPiece(String(i + 1), { size: 11, weight: 700, paint: isFirst ? 'sheet' : 'mid' })
    const circle = {
      body: `<circle cx="${r}" cy="${r}" r="${num(r - 0.5)}" class="${isFirst ? 'f-signal' : 'f-card s-line-strong'}"/>${place(number.body, (STEP - number.width) / 2, (STEP - number.height) / 2)}`,
      width: STEP, height: STEP,
    }
    return rowPart({ width: o.width, height: STEP_ROW, left: [circle, textPiece(text, { size: 13, paint: 'mid', max: o.width - STEP - 8 })], alt: `${i + 1}. ${text}` })
  })
  return stackPart(rows, { width: o.width, gap: 4 })
}

// ▢ claude.ai/artifact/…bWx2 · Doğrudan mesaj · 2 dk önce
export function metaLinePart(o: { width: number; glyph: GlyphName; text: string }): Part {
  return rowPart({ width: o.width, height: 18, left: [glyphPiece(o.glyph, { size: 14, paint: 'lo', stroke: 1.5 }), textPiece(o.text, { size: 12, paint: 'lo', max: o.width - 22 })], alt: o.text })
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
