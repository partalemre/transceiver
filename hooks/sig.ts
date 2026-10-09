// Svg pieces the kit lacks: the spec's `signal` role (teal), the radio glyph, avatars, the unread badge, the chat
// head, the day divider and a switch. Same rules as the kit: paint names become CSS variables for both schemes,
// no hex in the markup, reduced motion last.
import { ICON_GRID } from './kit/icons'
import type { IconName } from './kit/icons'
import { baseline, escapeXml, iconEl, num, outlineEl, place, rectEl, sans, STROKE, TYPE, textEl, upperTr } from './kit/svg-core'
import type { Part, SvgPic } from './kit/svg-core'
import { fitText } from './kit/svg-metrics'
import { bodyPart, EYEBROW_H, eyebrowWidth, linesPart } from './kit/svg-text'
import { svgStyle } from './kit/tokens'

const SIGNAL = {
  dark: { signal: '#5CC8B8', 'signal-tint': '#1A2E2B', 'signal-line': '#2E5650' },
  light: { signal: '#0E6F66', 'signal-tint': '#E3F3F0', 'signal-line': '#A9D8CF' },
} as const

const vars = (set: Record<string, string>) => `svg{${Object.entries(set).map(([k, v]) => `--${k}:${v}`).join(';')}}`
const SIGNAL_CSS = [
  vars(SIGNAL.dark),
  `@media (prefers-color-scheme: light){${vars(SIGNAL.light)}}`,
  ...Object.keys(SIGNAL.dark).map(k => `.f-${k}{fill:var(--${k})}.s-${k}{stroke:var(--${k})}`),
].join('')

// The signal glyph's outer arcs breathe a beat after the inner ones.
const DELAY_CSS = '.txd{animation-delay:.3s}.txd2{animation-delay:.6s}'

export function sigPic(part: Part): SvgPic {
  const style = (/[fs]-signal/.test(part.body) ? SIGNAL_CSS : '') + svgStyle(part.body) + (part.body.includes('txd') ? DELAY_CSS : '')
  const source = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${part.width}" height="${part.height}" viewBox="0 0 ${part.width} ${part.height}"`,
    ` role="img" aria-label="${escapeXml(part.alt)}"><style>${style}</style>${part.body}</svg>`,
  ].join('')
  return { source, width: part.width, height: part.height, alt: part.alt }
}

// ((·)): a dot and two arcs each side, on the kit's 24 grid.
const RADIO_ARCS = 'M8.8 8.8a4.5 4.5 0 0 0 0 6.4M15.2 8.8a4.5 4.5 0 0 1 0 6.4M5.9 5.9a8.6 8.6 0 0 0 0 12.2M18.1 5.9a8.6 8.6 0 0 1 0 12.2'
const DOT_R = 1.7

export type Glyph = IconName | 'radio'

function glyphEl(o: { glyph: Glyph; x: number; y: number; size: number; paint: string }): string {
  if (o.glyph !== 'radio') return iconEl({ name: o.glyph, x: o.x, y: o.y, size: o.size, paint: o.paint })
  const scale = o.size / ICON_GRID
  return [
    `<g transform="translate(${num(o.x)} ${num(o.y)}) scale(${scale.toFixed(4)})">`,
    `<path d="${RADIO_ARCS}" fill="none" class="s-${o.paint}" stroke-width="${num(STROKE / scale)}" stroke-linecap="round"/>`,
    `<circle cx="12" cy="12" r="${DOT_R}" class="f-${o.paint}"/></g>`,
  ].join('')
}

const TILE_RADIUS = 9
const TILE_ICON = 18
const HAIRLINE = 0.6

export function tilePart(o: { glyph: Glyph; paint: string; size?: number }): Part {
  const size = o.size ?? 36
  const icon = Math.min(TILE_ICON, Math.round(size / 2))
  const box = { x: 0, y: 0, width: size, height: size, radius: Math.min(TILE_RADIUS, size / 4) }
  const body = [
    rectEl({ ...box, paint: `${o.paint}-tint` }),
    outlineEl({ ...box, paint: `${o.paint}-line` }, HAIRLINE),
    glyphEl({ glyph: o.glyph, x: (size - icon) / 2, y: (size - icon) / 2, size: icon, paint: o.paint }),
  ]
  return { body: body.join(''), width: size, height: size, alt: '' }
}

const DOT = 6
const DOT_GAP = 6
const META_GAP = 12
const META = TYPE.label

// The kit's eyebrow, for any paint (the kit's takes kit roles only).
export function eyebrowLine(o: { text: string; paint: string; width: number; meta?: string; hasDot?: boolean }): Part {
  const y = baseline(0, EYEBROW_H, TYPE.eyebrow.size)
  const left = o.hasDot === false ? 0 : DOT + DOT_GAP
  const metaMeasure = sans(META.size, META.weight)
  const meta = o.meta ? fitText(o.meta, o.width / 2, metaMeasure) : ''
  const label = fitText(upperTr(o.text), o.width - left - (meta ? metaMeasure(meta) + META_GAP : 0), eyebrowWidth)
  const tracking = TYPE.eyebrow.size * TYPE.eyebrow.tracking
  const body = [
    o.hasDot === false ? '' : `<circle cx="${DOT / 2}" cy="${EYEBROW_H / 2}" r="${DOT / 2}" class="f-${o.paint}"/>`,
    textEl({ x: left, y, text: label, paint: o.paint, ...TYPE.eyebrow, tracking }),
    meta ? textEl({ x: o.width, y, text: meta, paint: 'lo', ...META, anchor: 'end' }) : '',
  ]
  return { body: body.join(''), width: o.width, height: EYEBROW_H, alt: [label, meta].filter(Boolean).join(' · ') }
}

export type HeadOpts = {
  glyph: Glyph; paint: string; eyebrow: string; width: number
  headline?: string; sub?: string; meta?: string; tile?: number
}

const TILE_GAP = 12
const STACK_GAP = 4

// [tile] [EYEBROW ··· meta] / [headline] / [sub]: the kit's card header, for any paint.
export function headPart(o: HeadOpts): Part {
  const size = o.tile ?? 36
  const x = size + TILE_GAP
  const w = o.width - x
  const eyebrow = eyebrowLine({ text: o.eyebrow, paint: o.paint, width: w, meta: o.meta })
  const title = o.headline ? linesPart({ text: o.headline, width: w }) : null
  const titleTop = EYEBROW_H + STACK_GAP
  const subTop = titleTop + (title ? title.height + STACK_GAP : 0)
  const sub = o.sub ? bodyPart({ text: o.sub, width: w, maxLines: 4 }) : null
  const body = [
    tilePart({ glyph: o.glyph, paint: o.paint, size }).body,
    place(eyebrow.body, x, 0),
    title ? place(title.body, x, titleTop) : '',
    sub ? place(sub.body, x, subTop) : '',
  ]
  const titleBottom = title ? titleTop + title.height : EYEBROW_H
  const bottom = sub ? subTop + sub.height : titleBottom
  return { body: body.join(''), width: o.width, height: Math.max(size, bottom), alt: [eyebrow.alt, o.headline, o.sub].filter(Boolean).join(' — ') }
}

const INITIALS_RATIO = 0.4
const INITIALS_WEIGHT = 650

export function avatarPart(o: { initials: string; paint: string; size: number }): Part {
  const r = o.size / 2
  const fontSize = Math.round(o.size * INITIALS_RATIO)
  const body = [
    `<circle cx="${r}" cy="${r}" r="${r}" class="f-${o.paint}-tint"/>`,
    `<circle cx="${r}" cy="${r}" r="${num(r - 0.5)}" fill="none" class="s-${o.paint}-line"/>`,
    textEl({ x: r, y: baseline(0, o.size, fontSize), text: o.initials, paint: o.paint, size: fontSize, weight: INITIALS_WEIGHT, anchor: 'middle' }),
  ]
  return { body: body.join(''), width: o.size, height: o.size, alt: o.initials }
}

const BADGE_H = 18
const BADGE_PAD = 6
const BADGE_TEXT = { size: 11, weight: 700 }
const BADGE_MAX = 99

// The unread count: a filled signal pill, the count in the card colour so it reads on both schemes.
export function badgePart(count: number): Part {
  const text = count > BADGE_MAX ? `${BADGE_MAX}+` : String(count)
  const width = Math.max(BADGE_H, Math.ceil(sans(BADGE_TEXT.size, BADGE_TEXT.weight)(text)) + BADGE_PAD * 2)
  const body = [
    rectEl({ x: 0, y: 0, width, height: BADGE_H, radius: BADGE_H / 2, paint: 'signal' }),
    textEl({ x: width / 2, y: baseline(0, BADGE_H, BADGE_TEXT.size), text, paint: 'card', ...BADGE_TEXT, anchor: 'middle', isMono: true }),
  ]
  return { body: body.join(''), width, height: BADGE_H, alt: `${text} okunmamış` }
}

const RULE_GAP = 10

// ──── BUGÜN ────
export function dividerPart(o: { text: string; width: number }): Part {
  const label = upperTr(o.text)
  const w = eyebrowWidth(label)
  const mid = o.width / 2
  const y = EYEBROW_H / 2 + 0.5
  const tracking = TYPE.eyebrow.size * TYPE.eyebrow.tracking
  const body = [
    `<path d="M0 ${y}H${num(mid - w / 2 - RULE_GAP)}M${num(mid + w / 2 + RULE_GAP)} ${y}H${o.width}" class="s-line"/>`,
    textEl({ x: mid, y: baseline(0, EYEBROW_H, TYPE.eyebrow.size), text: label, paint: 'lo', ...TYPE.eyebrow, tracking, anchor: 'middle' }),
  ]
  return { body: body.join(''), width: o.width, height: EYEBROW_H, alt: o.text }
}

const SWITCH_W = 30
const SWITCH_H = 18
const KNOB_INSET = 3

export function switchPart(isOn: boolean): Part {
  const r = SWITCH_H / 2 - KNOB_INSET
  const cx = isOn ? SWITCH_W - SWITCH_H / 2 : SWITCH_H / 2
  const body = [
    rectEl({ x: 0, y: 0, width: SWITCH_W, height: SWITCH_H, radius: SWITCH_H / 2, paint: isOn ? 'signal' : 'track' }),
    `<circle cx="${cx}" cy="${SWITCH_H / 2}" r="${r}" class="f-${isOn ? 'card' : 'lo'}"/>`,
  ]
  return { body: body.join(''), width: SWITCH_W, height: SWITCH_H, alt: isOn ? 'açık' : 'kapalı' }
}

const STEP_CIRCLE = 22
const STEP_PITCH = 44
const STEP_TEXT_X = 36
const STEP_NUMBER = { size: 11, weight: 700 }

// Numbered steps joined by a hairline: the empty state's "how it works".
export function stepsPart(o: { steps: ReadonlyArray<{ title: string; sub: string }>; width: number }): Part {
  const r = STEP_CIRCLE / 2
  const w = o.width - STEP_TEXT_X
  const rows = o.steps.map((step, i) => {
    const top = i * STEP_PITCH
    const rail = i < o.steps.length - 1 ? `<path d="M${r} ${top + STEP_CIRCLE + 3}V${top + STEP_PITCH - 3}" class="s-signal-line"/>` : ''
    return [
      rail,
      `<circle cx="${r}" cy="${top + r}" r="${r - 0.5}" class="f-signal-tint s-signal-line"/>`,
      textEl({ x: r, y: baseline(top, STEP_CIRCLE, STEP_NUMBER.size), text: String(i + 1), paint: 'signal', ...STEP_NUMBER, anchor: 'middle' }),
      textEl({ x: STEP_TEXT_X, y: top + 9, text: fitText(step.title, w, sans(TYPE.title.size - 1, TYPE.title.weight)), paint: 'hi', size: TYPE.title.size - 1, weight: TYPE.title.weight }),
      textEl({ x: STEP_TEXT_X, y: top + 27, text: fitText(step.sub, w, sans(TYPE.label.size, TYPE.label.weight)), paint: 'lo', ...TYPE.label }),
    ].join('')
  })
  const height = (o.steps.length - 1) * STEP_PITCH + STEP_CIRCLE + 12
  return { body: rows.join(''), width: o.width, height, alt: o.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.sub}`).join(' ') }
}

const CHIP_ICON = 12

// A switch-sized chip with an icon: the session's state beside the settings' switches.
export function chipPart(o: { glyph: Glyph; paint: string }): Part {
  const body = [
    rectEl({ x: 0, y: 0, width: SWITCH_W, height: SWITCH_H, radius: SWITCH_H / 2, paint: `${o.paint}-tint` }),
    outlineEl({ x: 0, y: 0, width: SWITCH_W, height: SWITCH_H, radius: SWITCH_H / 2, paint: `${o.paint}-line` }),
    glyphEl({ glyph: o.glyph, x: (SWITCH_W - CHIP_ICON) / 2, y: (SWITCH_H - CHIP_ICON) / 2, size: CHIP_ICON, paint: o.paint }),
  ]
  return { body: body.join(''), width: SWITCH_W, height: SWITCH_H, alt: '' }
}
