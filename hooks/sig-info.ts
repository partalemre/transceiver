// A project room's details on the desktop, drawn as two quiet cards on the app's own ink: the gate (its state as the
// card's title, each condition a lamp beside its words, when GitHub was last asked) with the day's asks as a
// ten-cell meter under it; and the live-mode switch, pressed as a whole, its warning under it. Pure: words in, Svg out.
import { baseline, num, sans, textEl, toPic } from './kit/svg-core'
import type { SvgPic } from './kit/svg-core'
import { fitText, textWidth } from './kit/svg-metrics'
import { linesPart } from './kit/svg-text'
import { hairline, themed, veilRect, VEIL } from './sig-ink'
import { glyphPiece, type GlyphName } from './sig-ui'

const PAD = 14
const RADIUS = 12
const HEAD = { h: 26, size: 14, weight: 650, glyph: 16, gap: 8 }
const ROW = { h: 22, size: 13, lamp: 3.5, textX: 20 }
const META = { h: 20, size: 12 }
const NOTE = { size: 12, lineH: 17, maxLines: 3 }
const SECTION_GAP = 12
const METER = { h: 6, gap: 3, top: 6, r: 2, rest: 0.1 }
const SWITCH = { w: 32, h: 18, knob: 7 }
const LIVE_ROW_H = 24

export type CheckLamp = { text: string; state: boolean | null }
export type GateInfo = { paint: string; label: string; passed: string; checks: CheckLamp[]; checked: string }
export type InfoOpts = {
  width: number
  gate: GateInfo
  budget: { text: string; used: number; limit: number; note: string; today: string }
  pin?: boolean
}

const GATE_GLYPH: Record<string, GlyphName> = { ok: 'check', danger: 'cross', warn: 'clock' }

// Passed in green, failed in red, not yet asked an open ring.
function lamp(state: boolean | null, cy: number): string {
  const cx = PAD + ROW.lamp + 1
  if (state === null) return `<circle cx="${num(cx)}" cy="${num(cy)}" r="${ROW.lamp}" fill="none" class="s-lo" stroke-width="1.25"/>`
  return `<circle cx="${num(cx)}" cy="${num(cy)}" r="${ROW.lamp}" class="${state ? 'f-ok' : 'f-danger'}"/>`
}

function gateHead(o: InfoOpts, y: number): string {
  const g = o.gate
  const glyph = glyphPiece(GATE_GLYPH[g.paint] ?? 'clock', { size: HEAD.glyph, paint: g.paint, stroke: 1.9 })
  const by = baseline(y, HEAD.h, HEAD.size)
  const room = o.width - PAD * 2 - HEAD.glyph - HEAD.gap - textWidth(g.passed, META.size) - HEAD.gap
  return [
    `<g transform="translate(${PAD} ${num(y + (HEAD.h - HEAD.glyph) / 2)})">${glyph.body}</g>`,
    textEl({ x: PAD + HEAD.glyph + HEAD.gap, y: by, text: fitText(g.label, room, sans(HEAD.size, HEAD.weight)), paint: g.paint, size: HEAD.size, weight: HEAD.weight }),
    textEl({ x: o.width - PAD, y: by, text: g.passed, paint: 'lo', size: META.size, isMono: true, anchor: 'end' }),
  ].join('')
}

// Used asks in Claude's clay, the rest as thin ink; all ten in clay's warning once the day is spent.
function meter(o: InfoOpts, y: number): string {
  const { used, limit } = o.budget
  const cells = Math.max(1, limit)
  const w = (o.width - PAD * 2 - METER.gap * (cells - 1)) / cells
  const isSpent = used >= limit
  return Array.from({ length: cells }, (_, i) => {
    const x = PAD + i * (w + METER.gap)
    const look = i < used ? `class="${isSpent ? 'f-warn' : 'f-edit'}"` : `class="f-hi" fill-opacity="${METER.rest}"`
    return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${METER.h}" rx="${METER.r}" ${look}/>`
  }).join('')
}

const note = (text: string, width: number, y: number): { body: string; h: number } => {
  const part = linesPart({ text, width: width - PAD * 2, size: NOTE.size, weight: 400, lineHeight: NOTE.lineH, paint: 'lo', maxLines: NOTE.maxLines })
  return { body: `<g transform="translate(${PAD} ${num(y)})">${part.body}</g>`, h: part.height }
}

export function infoPic(o: InfoOpts): SvgPic {
  const w = Math.floor(o.width)
  const parts: string[] = []
  let y = PAD - 4
  parts.push(gateHead(o, y))
  y += HEAD.h + 4
  for (const c of o.gate.checks) {
    parts.push(lamp(c.state, y + ROW.h / 2), textEl({ x: PAD + ROW.textX, y: baseline(y, ROW.h, ROW.size), text: fitText(c.text, w - PAD * 2 - ROW.textX, sans(ROW.size)), paint: c.state === false ? 'danger' : 'hi', size: ROW.size }))
    y += ROW.h
  }
  parts.push(textEl({ x: PAD + ROW.textX, y: baseline(y, META.h, META.size), text: o.gate.checked, paint: 'lo', size: META.size }))
  y += META.h + SECTION_GAP
  parts.push(hairline({ x1: PAD, x2: w - PAD, y }))
  y += SECTION_GAP
  parts.push(textEl({ x: PAD, y: baseline(y, META.h, ROW.size), text: o.budget.text, paint: 'hi', size: ROW.size, weight: 600 }))
  y += META.h + METER.top - 4
  parts.push(meter(o, y))
  y += METER.h + 10
  for (const text of [o.budget.note, o.budget.today]) {
    const n = note(text, w, y)
    parts.push(n.body)
    y += n.h + 2
  }
  const h = Math.ceil(y + PAD - 4)
  const card = veilRect({ x: 0, y: 0, w, h, r: RADIUS, fill: VEIL.soft, edge: VEIL.rule })
  const alt = [`${o.gate.label} · ${o.gate.passed}`, ...o.gate.checks.map(c => c.text), o.gate.checked, o.budget.text, o.budget.note, o.budget.today].join(' — ')
  return themed(toPic({ body: card + parts.join(''), width: w, height: h, alt }), o.pin)
}

// The switch: a track and a knob, on in green.
function switchSvg(x: number, y: number, isOn: boolean): string {
  const r = SWITCH.h / 2
  const track = isOn
    ? `<rect x="${num(x)}" y="${num(y)}" width="${SWITCH.w}" height="${SWITCH.h}" rx="${r}" class="f-ok"/>`
    : `<rect x="${num(x + 0.5)}" y="${num(y + 0.5)}" width="${SWITCH.w - 1}" height="${SWITCH.h - 1}" rx="${r}" class="f-hi s-hi" fill-opacity="0.08" stroke-opacity="0.28"/>`
  const cx = isOn ? x + SWITCH.w - r : x + r
  return `${track}<circle cx="${num(cx)}" cy="${num(y + r)}" r="${SWITCH.knob}" class="${isOn ? 'f-sheet' : 'f-lo'}"/>`
}

export function livePic(o: { width: number; label: string; action: string; note: string; isOn: boolean; pin?: boolean }): SvgPic {
  const w = Math.floor(o.width)
  const y = PAD - 4
  const by = baseline(y, LIVE_ROW_H, ROW.size)
  const swX = w - PAD - SWITCH.w
  const actionX = swX - 8
  const n = note(o.note, w, y + LIVE_ROW_H + 4)
  const h = Math.ceil(y + LIVE_ROW_H + 4 + n.h + PAD - 4)
  const body = [
    veilRect({ x: 0, y: 0, w, h, r: RADIUS, fill: VEIL.soft, edge: VEIL.rule }),
    textEl({ x: PAD, y: by, text: o.label, paint: o.isOn ? 'ok' : 'hi', size: ROW.size, weight: 600 }),
    textEl({ x: actionX, y: by, text: o.action, paint: 'lo', size: META.size, anchor: 'end' }),
    switchSvg(swX, y + (LIVE_ROW_H - SWITCH.h) / 2, o.isOn),
    n.body,
  ].join('')
  return themed(toPic({ body, width: w, height: h, alt: `${o.label} · ${o.action} — ${o.note}` }), o.pin)
}
