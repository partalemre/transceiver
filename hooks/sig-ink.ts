// What the pane's drawings stand on and how they say who someone is. The pane paints no ground: a surface is the
// app's own ink laid thin (the `hi` paint at a low opacity), so a bubble reads on a navy panel, a warm black one or
// paper alike. A person is a neutral monogram and an AI a small pixel crab, as the MODZ session strip draws them.
import { baseline, escapeXml, num, textEl } from './kit/svg-core'
import type { SvgPic } from './kit/svg-core'
import { upper } from './kit/lang'
import { paintVars } from './kit/tokens'

// How much of the ink a surface takes: a filled bubble, an outline, a hairline.
export const VEIL = { fill: 0.075, soft: 0.035, edge: 0.16, rule: 0.13 } as const

export const veilRect = (o: { x: number; y: number; w: number; h: number; r: number; fill?: number; edge?: number; isDashed?: boolean }): string => {
  const classes = [o.fill === undefined ? '' : 'f-hi', o.edge === undefined ? '' : 's-hi'].filter(Boolean).join(' ')
  const fill = o.fill === undefined ? ' fill="none"' : ` fill-opacity="${o.fill}"`
  const edge = o.edge === undefined ? '' : ` stroke-opacity="${o.edge}" stroke-width="1"${o.isDashed === true ? ' stroke-dasharray="3 3"' : ''}`
  return `<rect x="${num(o.x + 0.5)}" y="${num(o.y + 0.5)}" width="${num(o.w - 1)}" height="${num(o.h - 1)}" rx="${o.r}" class="${classes}"${fill}${edge}/>`
}

export const hairline = (o: { x1: number; x2: number; y: number }): string =>
  `<path d="M${num(o.x1)} ${num(o.y + 0.5)}H${num(o.x2)}" class="s-hi" stroke-opacity="${VEIL.rule}" stroke-width="1"/>`

const MONO_INK = { disc: 0.12, size: 0.44, weight: 700 }

// A person's first letter on a disc of thin ink, in the interface's casing.
export function monogram(o: { name: string; x: number; y: number; size: number }): string {
  const r = o.size / 2
  const fontSize = Math.round(o.size * MONO_INK.size)
  const letter = upper([...o.name.trim()][0] ?? '·')
  return [
    `<circle cx="${num(o.x + r)}" cy="${num(o.y + r)}" r="${num(r)}" class="f-hi" fill-opacity="${MONO_INK.disc}"/>`,
    textEl({ x: o.x + r, y: baseline(o.y, o.size, fontSize), text: letter, paint: 'mid', size: fontSize, weight: MONO_INK.weight, anchor: 'middle' }),
  ].join('')
}

// The crab of the session strip: claws up, a body, legs; in Claude's clay, as agents are across MODZ.
const CRAB = ['X.....X', 'XX...XX', '.XXXXX.', 'XXXXXXX', '.X.X.X.']
const CRAB_FILL = 0.84

export function crab(o: { x: number; y: number; size: number }): string {
  const pitch = o.size / CRAB[0]!.length
  const top = o.y + (o.size - CRAB.length * pitch) / 2
  const cell = num(pitch * CRAB_FILL)
  return CRAB.flatMap((row, r) => [...row].flatMap((c, i) => (c === 'X'
    ? [`<rect x="${num(o.x + i * pitch)}" y="${num(top + r * pitch)}" width="${cell}" height="${cell}" class="f-edit"/>`]
    : []))).join('')
}

// Who wrote: a crab for an AI, else the person's monogram.
export const faceOf = (o: { name: string; isAgent: boolean; x: number; y: number; size: number }): string =>
  (o.isAgent ? crab(o) : monogram(o))

// Small pixel marks for the room list, on the hub's grid, so a room row reads as a hub row does.
const MARKS: Record<string, readonly string[]> = {
  branch: ['X...X', 'X...X', 'X..X.', 'X.X..', 'XX...', 'X....', 'X....'],
  laptop: ['.XXXXX.', '.X...X.', '.X...X.', '.XXXXX.', 'XXXXXXX'],
  person: ['..XXX..', '..XXX..', '.......', '.XXXXX.', 'XXXXXXX'],
  clock: ['.XXXXX.', 'X..X..X', 'X..XX.X', 'X.....X', '.XXXXX.'],
}
const MARK = { cell: 2, pitch: 2.5 }

export function markOf(o: { name: string; x: number; y: number; box: number; paint: string }): string {
  const grid = MARKS[o.name] ?? MARKS.person!
  const w = Math.max(...grid.map(row => row.length)) * MARK.pitch
  const left = o.x + (o.box - w) / 2
  const top = o.y + (o.box - grid.length * MARK.pitch) / 2
  return grid.flatMap((row, r) => [...row].flatMap((c, i) => (c === 'X'
    ? [`<rect x="${num(left + i * MARK.pitch)}" y="${num(top + r * MARK.pitch)}" width="${MARK.cell}" height="${MARK.cell}" rx="0.45" class="f-${o.paint}"/>`]
    : []))).join('')
}

const VAR_USE = /[fs]-([a-z-]+)\b/g

// A palette the person pinned (MODZ_THEME), said last so it wins over the app's scheme; absent, the drawing follows
// the app it is drawn in, as the hub's do.
export function themed(pic: SvgPic, pin: boolean | undefined): SvgPic {
  if (pin === undefined) return pic
  const vars = paintVars(pin)
  const used = new Set([...pic.source.matchAll(VAR_USE)].map(m => m[1] as string))
  const block = Object.entries(vars).filter(([name]) => used.has(name)).map(([name, value]) => `--${name}:${value}`).join(';')
  return { ...pic, source: pic.source.replace(/<\/style>/, `svg{${block}}</style>`) }
}

export const esc = escapeXml
