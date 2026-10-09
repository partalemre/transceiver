// Svg the kit lacks: the spec's `signal` role (teal), the picture every Svg part becomes, avatars and steps. Same
// rules as the kit: paint names become CSS variables for both schemes, no hex in the markup, reduced motion last.
// Svg follows the OS's colour scheme, not Claude's, so the pane keeps words out of it.
import { baseline, escapeXml, num, sans, TYPE, textEl } from './kit/svg-core'
import type { Part, SvgPic } from './kit/svg-core'
import { fitText } from './kit/svg-metrics'
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

