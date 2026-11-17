// An open room's head on the desktop: the way back (narrow pane), who or what the room is, its name at 15/600 and
// under it what is known of the other side. One drawing, cut to its width, so a long name never runs off the pane.
import { baseline, place, textEl, toPic } from './kit/svg-core'
import type { SvgPic } from './kit/svg-core'
import { fitText, textWidth } from './kit/svg-metrics'
import { faceOf, markOf, themed } from './sig-ink'
import { glyphPiece } from './sig-ui'

export const HEAD_H = 46
const BACK = { size: 18, stroke: 1.75, room: 26 }
const FACE = 26
const FACE_GAP = 10
const HERE_R = 4
const NAME = { size: 15, weight: 600, top: 4, height: 22 }
const SUB = { size: 12, top: 26, height: 16 }

export type HeadOpts = {
  width: number; title: string; sub: string; isSubLive: boolean; hasBack: boolean
  // `isHere`: the person was here lately; a small green dot sits on their monogram.
  face: { kind: 'person' | 'mark'; name: string; mark: string; isHere?: boolean }; pin?: boolean
}

export function chatHeadPic(o: HeadOpts): SvgPic {
  const faceX = o.hasBack ? BACK.room : 0
  const textX = faceX + FACE + FACE_GAP
  const room = o.width - textX
  const faceY = (HEAD_H - FACE) / 2
  const face = o.face.kind === 'person'
    ? faceOf({ name: o.face.name, isAgent: false, x: faceX, y: faceY, size: FACE })
    : markOf({ name: o.face.mark, x: faceX, y: faceY, box: FACE, paint: 'mid' })
  const dot = o.face.kind === 'person' && o.face.isHere === true
    ? `<circle cx="${faceX + FACE - HERE_R}" cy="${faceY + FACE - HERE_R}" r="${HERE_R}" class="f-ok here"/>`
    : ''
  const title = fitText(o.title, room, t => textWidth(t, NAME.size, NAME.weight))
  const sub = fitText(o.sub, room, t => textWidth(t, SUB.size))
  const body = [
    o.hasBack ? place(glyphPiece('back', { size: BACK.size, paint: 'mid', stroke: BACK.stroke }).body, 0, (HEAD_H - BACK.size) / 2) : '',
    face,
    dot,
    textEl({ x: textX, y: baseline(NAME.top, NAME.height, NAME.size), text: title, paint: 'hi', size: NAME.size, weight: NAME.weight }),
    sub === '' ? '' : textEl({ x: textX, y: baseline(SUB.top, SUB.height, SUB.size), text: sub, paint: o.isSubLive ? 'ok' : 'lo', size: SUB.size }),
  ].join('')
  const alt = [o.title, o.sub].filter(Boolean).join(' · ')
  return themed(toPic({ body, width: Math.floor(o.width), height: HEAD_H, alt }), o.pin)
}
