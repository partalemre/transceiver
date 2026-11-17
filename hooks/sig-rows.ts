// The drawings the pane presses or points at: one line per room, and the bridge between two computers. Colour says
// state alone (MODZ DESIGN.md §0). Like the hub's, they follow the app they are drawn in unless a palette is pinned.
import { baseline, escapeXml, num, place, textEl, toPic } from './kit/svg-core'
import type { SvgPic } from './kit/svg-core'
import { fitText, textWidth } from './kit/svg-metrics'
import { markOf, monogram, themed, veilRect, VEIL } from './sig-ink'
import { glyphPiece, type GlyphName } from './sig-ui'

// A room row is a hub row (MODZ hub-draw.ts sizesOf at a docked pane): one line about 32 px tall, a pixel mark, the name
// at 13/500, the last words and the time at 12 in the quiet ink. The open room (wide pane) lies on thin ink.
export const ROOM_ROW_H = 32
const ICON = 16
const NAME_X = 28
const NAME = { size: 13, weight: 500 }
const NOTE = { size: 12, weight: 400 }
const GAP = 10
const COUNT_WEIGHT = 650
// A last line is drawn only with this much room left for it.
const MIN_PREVIEW = 48
const WASH = { inset: 6, radius: 7 }

export type RoomRowOpts = {
  width: number; glyph: GlyphName; name: string; preview: string; time: string; unread: number; isWarn: boolean
  isActive?: boolean; pin?: boolean
}

function rightOf(o: RoomRowOpts): { body: string; width: number } {
  const y = baseline(0, ROOM_ROW_H, NOTE.size)
  const count = o.unread > 0 ? String(o.unread) : ''
  const countWidth = count === '' ? 0 : textWidth(count, NOTE.size, COUNT_WEIGHT) + GAP
  const timeWidth = textWidth(o.time, NOTE.size, NOTE.weight)
  const time = textEl({ x: o.width - countWidth, y, text: o.time, paint: 'lo', ...NOTE, anchor: 'end' })
  const mark = count === '' ? '' : textEl({ x: o.width, y, text: count, paint: 'edit', size: NOTE.size, weight: COUNT_WEIGHT, anchor: 'end' })
  return { body: time + mark, width: timeWidth + countWidth }
}

// Unread words are live state: the mark takes the accent, as a hub row's glyph does while its mod has news.
function markPaint(o: RoomRowOpts): string {
  if (o.isWarn) return 'warn'
  return o.unread > 0 ? 'edit' : 'mid'
}

function previewPaint(o: RoomRowOpts): string {
  if (o.isWarn) return 'warn'
  return o.unread > 0 ? 'mid' : 'lo'
}

const MONO = 18

// A person is their monogram, as in the chat; a project, the computers and a room still waiting a pixel mark.
function markSvg(o: RoomRowOpts): string {
  const top = (ROOM_ROW_H - ICON) / 2
  if (o.glyph === 'back') return place(glyphPiece('back', { size: ICON, paint: 'mid', stroke: 1.75 }).body, 0, top)
  if (o.glyph === 'person') return monogram({ name: o.name, x: (ICON - MONO) / 2, y: (ROOM_ROW_H - MONO) / 2, size: MONO })
  return markOf({ name: o.glyph, x: 0, y: top, box: ICON, paint: markPaint(o) })
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
  const mark = markSvg(o)
  const body = [
    o.isActive === true ? veilRect({ x: -WASH.inset, y: 1, w: o.width + WASH.inset * 2, h: ROOM_ROW_H - 2, r: WASH.radius, fill: VEIL.fill }) : '',
    mark,
    textEl({ x: NAME_X, y, text: name, paint: 'hi', ...NAME }),
    preview === '' ? '' : textEl({ x: NAME_X + nameWidth + GAP, y, text: preview, paint: previewPaint(o), ...NOTE }),
    right.body,
  ].join('')
  const alt = [o.name, o.preview, o.time, o.unread > 0 ? String(o.unread) : ''].filter(Boolean).join(' · ')
  return themed(toPic({ body, width: Math.floor(o.width), height: ROOM_ROW_H, alt }), o.pin)
}

const DEVICE_H = 26
const DEVICE_GAP = 6
const RAIL_X = ICON / 2
const PACKET = 2
const TRAVEL_MS = 520

export type Device = { name: string; note: string; isWaiting: boolean }
export type BridgeOpts = {
  width: number; here: Device; there: Device; alt: string
  // The newest message: naming it is what makes the drawing new, so the one pass runs once per message.
  lastId: string; lastIsMine: boolean; pin?: boolean
}

function deviceRow(o: { device: Device; y: number; width: number }): string {
  const { device, y } = o
  const note = textEl({ x: o.width, y: y + baseline(0, DEVICE_H, NOTE.size), text: device.note, paint: 'lo', ...NOTE, anchor: 'end' })
  const room = o.width - NAME_X - textWidth(device.note, NOTE.size, NOTE.weight) - GAP
  const name = fitText(device.name, room, t => textWidth(t, NAME.size, NAME.weight))
  return [
    place(glyphPiece('laptop', { size: ICON, paint: device.isWaiting ? 'lo' : 'hi', stroke: 1.5 }).body, 0, y + (DEVICE_H - ICON) / 2),
    textEl({ x: NAME_X, y: y + baseline(0, DEVICE_H, NAME.size), text: name, paint: device.isWaiting ? 'lo' : 'hi', ...NAME }),
    note,
  ].join('')
}

function packet(o: BridgeOpts, rail: { from: number; to: number }): string {
  if (o.lastId === '' || o.there.isWaiting) return ''
  const [start, end] = o.lastIsMine ? [rail.from, rail.to] : [rail.to, rail.from]
  const css = [
    `@keyframes tx-go{0%{opacity:0;transform:translateY(0)}20%{opacity:1}80%{opacity:1}100%{opacity:0;transform:translateY(${num(end - start)}px)}}`,
    `.tx-go{opacity:0;animation:tx-go ${TRAVEL_MS}ms cubic-bezier(.2,.8,.2,1) .2s both}`,
    '@media (prefers-reduced-motion: reduce){.tx-go{animation:none}}',
  ].join('')
  return `<style>${css}</style><circle data-id="${escapeXml(o.lastId)}" cx="${RAIL_X}" cy="${num(start)}" r="${PACKET}" class="f-edit tx-go"/>`
}

// The two computers, one to a line so a long name is read whole in a narrow pane, and the line between them: solid once
// both are in, dashed while the other is awaited. A message crossing it is the pane's one moment of motion.
export function bridgePic(o: BridgeOpts): SvgPic {
  const lower = DEVICE_H + DEVICE_GAP
  const rail = { from: (DEVICE_H + ICON) / 2 - 1, to: lower + (DEVICE_H - ICON) / 2 + 1 }
  const isAlone = o.there.isWaiting
  const body = [
    deviceRow({ device: o.here, y: 0, width: o.width }),
    `<path d="M${RAIL_X} ${rail.from}V${rail.to}" class="${isAlone ? 's-lo' : 's-mid'}" stroke-width="1.5" fill="none"${isAlone ? ' stroke-dasharray="2 3"' : ''}/>`,
    deviceRow({ device: o.there, y: lower, width: o.width }),
    packet(o, rail),
  ].join('')
  return themed(toPic({ body, width: o.width, height: lower + DEVICE_H, alt: o.alt }), o.pin)
}
