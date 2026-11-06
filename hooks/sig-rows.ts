// The drawings the pane presses or points at: one line per room, and the bridge between two computers. Colour says
// state alone (MODZ DESIGN.md §0). These carry words, so they take Claude's theme, not the OS's.
import { baseline, escapeXml, num, place, textEl, toPic } from './kit/svg-core'
import type { SvgPic } from './kit/svg-core'
import { fitText, textWidth } from './kit/svg-metrics'
import { paintVars } from './kit/tokens'
import { glyphPiece, type GlyphName } from './sig-ui'

export const ROOM_ROW_H = 34
const ICON = 16
const NAME_X = 26
const NAME = { size: 13, weight: 560 }
const NOTE = { size: 12, weight: 400 }
const GAP = 10
// A last line is drawn only with this much room left for it.
const MIN_PREVIEW = 48

const VAR_USE = /[fs]-([a-z-]+)\b/g

// `svgStyle` answers the OS's scheme; said again last, Claude's own theme wins whatever the OS is set to.
export function themed(pic: SvgPic, isLight: boolean): SvgPic {
  const vars = paintVars(isLight)
  const used = new Set([...pic.source.matchAll(VAR_USE)].map(m => m[1] as string))
  const block = Object.entries(vars).filter(([name]) => used.has(name)).map(([name, value]) => `--${name}:${value}`).join(';')
  return { ...pic, source: pic.source.replace(/<\/style>/, `svg{${block}}</style>`) }
}

export type RoomRowOpts = {
  width: number; glyph: GlyphName; name: string; preview: string; time: string; unread: number; isWarn: boolean; isLight: boolean
}

function rightOf(o: RoomRowOpts): { body: string; width: number } {
  const y = baseline(0, ROOM_ROW_H, NOTE.size)
  const count = o.unread > 0 ? String(o.unread) : ''
  const countWidth = count === '' ? 0 : textWidth(count, NOTE.size, 650) + GAP
  const timeWidth = textWidth(o.time, NOTE.size, NOTE.weight)
  const time = textEl({ x: o.width - countWidth, y, text: o.time, paint: 'lo', ...NOTE, anchor: 'end' })
  const mark = count === '' ? '' : textEl({ x: o.width, y, text: count, paint: 'edit', size: NOTE.size, weight: 650, anchor: 'end' })
  return { body: time + mark, width: timeWidth + countWidth }
}

// Mark, name, the last line in what room is left, then the time and the unread count against the right edge.
export function roomRowPic(o: RoomRowOpts): SvgPic {
  const right = rightOf(o)
  const room = o.width - NAME_X - right.width - GAP
  const name = fitText(o.name, Math.max(MIN_PREVIEW, room), t => textWidth(t, NAME.size, NAME.weight))
  const nameWidth = textWidth(name, NAME.size, NAME.weight)
  const left = room - nameWidth - GAP
  const preview = left < MIN_PREVIEW ? '' : fitText(o.preview, left, t => textWidth(t, NOTE.size, NOTE.weight))
  const y = baseline(0, ROOM_ROW_H, NAME.size)
  const glyph = glyphPiece(o.glyph, { size: ICON, paint: o.unread > 0 ? 'hi' : 'mid', stroke: 1.5 })
  const body = [
    place(glyph.body, 0, (ROOM_ROW_H - ICON) / 2),
    textEl({ x: NAME_X, y, text: name, paint: 'hi', ...NAME }),
    preview === '' ? '' : textEl({ x: NAME_X + nameWidth + GAP, y, text: preview, paint: o.isWarn ? 'warn' : o.unread > 0 ? 'mid' : 'lo', ...NOTE }),
    right.body,
  ].join('')
  const alt = [o.name, o.preview, o.time, o.unread > 0 ? String(o.unread) : ''].filter(Boolean).join(' · ')
  return themed(toPic({ body, width: o.width, height: ROOM_ROW_H, alt }), o.isLight)
}

const BRIDGE_H = 60
const MARK = 20
const LINE_Y = 16
const LABEL_Y = 48
const COLUMN = 0.22
const LINE_GAP = 20
const PACKET = 2.5
const TRAVEL_MS = 720
const LABEL = { size: 12, weight: 500 }

export type BridgeOpts = {
  width: number; here: string; there: string | null; waitWord: string; alt: string
  // The newest message: naming it is what makes the drawing new, so the one pass runs once per message.
  lastId: string; lastIsMine: boolean; isLight: boolean
}

function packet(o: BridgeOpts, line: { from: number; to: number }): string {
  if (o.lastId === '' || o.there === null) return ''
  const [start, end] = o.lastIsMine ? [line.from, line.to] : [line.to, line.from]
  const css = [
    `@keyframes tx-go{0%{opacity:0;transform:translateX(0)}18%{opacity:1}82%{opacity:1}100%{opacity:0;transform:translateX(${num(end - start)}px)}}`,
    `.tx-go{opacity:0;animation:tx-go ${TRAVEL_MS}ms cubic-bezier(.2,.8,.2,1) .2s both}`,
    '@media (prefers-reduced-motion: reduce){.tx-go{animation:none}}',
  ].join('')
  return `<style>${css}</style><circle data-id="${escapeXml(o.lastId)}" cx="${num(start)}" cy="${LINE_Y}" r="${PACKET}" class="f-edit tx-go"/>`
}

// Two computers and the line between them: solid once both are in, dashed while the other is awaited. A message going
// over it is the pane's one moment of motion: a dot crosses once, the way the message went.
export function bridgePic(o: BridgeOpts): SvgPic {
  const left = Math.round(o.width * COLUMN)
  const right = o.width - left
  const isAlone = o.there === null
  const line = { from: left + LINE_GAP, to: right - LINE_GAP }
  const mark = (cx: number, paint: string) => place(glyphPiece('laptop', { size: MARK, paint, stroke: 1.5 }).body, cx - MARK / 2, LINE_Y - MARK / 2)
  const room = o.width / 2 - GAP
  const label = (cx: number, text: string, paint: string) =>
    textEl({ x: cx, y: LABEL_Y, text: fitText(text, room, t => textWidth(t, LABEL.size, LABEL.weight)), paint, ...LABEL, anchor: 'middle' })
  const body = [
    mark(left, 'hi'), mark(right, isAlone ? 'lo' : 'hi'),
    `<path d="M${line.from} ${LINE_Y}H${line.to}" class="${isAlone ? 's-lo' : 's-mid'}" stroke-width="1.5" fill="none"${isAlone ? ' stroke-dasharray="3 5"' : ''}/>`,
    label(left, o.here, 'hi'), label(right, o.there ?? o.waitWord, isAlone ? 'lo' : 'hi'),
    packet(o, line),
  ].join('')
  return themed(toPic({ body, width: o.width, height: BRIDGE_H, alt: o.alt }), o.isLight)
}
