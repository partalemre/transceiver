// What every part of the pane draws with: the drawing context, Svg placement, a meta line, a rule, faces for rooms
// and people, and the receipt glyphs.
import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { PaneHandlers } from './actions'
import { WAITING } from './connection'
import type { Part, SvgPic } from './kit/svg-core'
import { PRESENCE_MS } from './limits'
import { sigPic } from './sig'
import { facePart } from './sig-chat'
import { tilePart } from './sig-states'
import { rulePart } from './sig-ui'
import type { PaneModel, Receipt, RoomView } from './state-types'
import { avatarRole, initialsOf, type Look } from './theme'

export type Ctx = {
  ui: ElementTable
  surface: RenderSurface
  look: Look
  // Cells across the part being drawn, and the same in Svg px.
  columns: number
  px: number
  // Two columns (rooms beside the chat) rather than one view at a time.
  isWide: boolean
  model: PaneModel
  on: PaneHandlers
}

export const PX_PER_CELL = 8
const MIN_PX = 160

export const isText = (ctx: Ctx): boolean => ctx.look.isText || !('Svg' in ctx.ui)
export const pxOf = (columns: number): number => Math.max(MIN_PX, columns * PX_PER_CELL)
export const within = (ctx: Ctx, columns: number): Ctx => ({ ...ctx, columns, px: pxOf(columns) })

export function SvgOf(ctx: Ctx, pic: SvgPic, key?: string): RenderElement | null {
  if (!('Svg' in ctx.ui)) return null
  const { Svg } = ctx.ui
  return <Svg key={key} source={pic.source} alt={pic.alt} width={pic.width} height={pic.height} />
}

// A Part drawn as its own Svg, or its alt as text where the surface has no Svg.
export function Pic(ctx: Ctx, part: Part, key?: string): RenderElement {
  const { Text } = ctx.ui
  return SvgOf(ctx, sigPic(part), key) ?? <Text key={key} color={ctx.look.lo}>{part.alt}</Text>
}

// One line of meta text in text.lo.
export function Meta(ctx: Ctx, text: string, key?: string): RenderElement {
  const { Text } = ctx.ui
  return <Text key={key} color={ctx.look.lo} wrap="wrap">{text}</Text>
}

// A hairline across the part: a rule Svg on the desktop, a line of ─ on the terminal.
export function Rule(ctx: Ctx, key: string): RenderElement {
  const { Text } = ctx.ui
  if (isText(ctx)) return <Text key={key} color={ctx.look.line}>{'─'.repeat(Math.max(1, ctx.columns))}</Text>
  return Pic(ctx, rulePart(ctx.px), key)
}

// A person was here lately: their head moved within PRESENCE_MS.
export const isHere = (room: RoomView, now: number): boolean => room.peerSeenTs > 0 && now - room.peerSeenTs < PRESENCE_MS

// A room's face: a person's initials (with presence), a project's branch tile, an amber clock while nobody joined.
export function roomFace(room: RoomView, o: { size: number; now: number; isMuted?: boolean }): Part {
  if (room.kind === 'project') {
    return o.isMuted === true
      ? tilePart({ glyph: 'branch', paint: 'lo', tint: 'card', line: 'line', size: o.size })
      : tilePart({ glyph: 'branch', paint: 'run', size: o.size })
  }
  if (room.isWaiting) return tilePart({ glyph: 'clock', paint: 'warn', size: o.size })
  return { ...facePart({ initials: initialsOf(room.title), paint: avatarRole(room.seed), size: o.size, isHere: isHere(room, o.now) }), alt: room.title }
}

export type ReceiptTone = { glyph: string; color?: string }

// ◷ waiting (with why, while the session may not write), ✓ written, ✓✓ reached them, ✓✓ in Tide once read.
export function receiptTone(ctx: Ctx, receipt: Receipt): ReceiptTone {
  if (receipt === 'pending') {
    return ctx.model.isConnected ? { glyph: '◷', color: ctx.look.lo } : { glyph: `◷ ${WAITING}`, color: ctx.look.role.warn.fg }
  }
  if (receipt === 'read') return { glyph: '✓✓', color: ctx.look.role.read.fg }
  return { glyph: receipt === 'sent' ? '✓' : '✓✓', color: ctx.look.lo }
}

// A message still going out has no ticks yet.
const TICKS: Record<Receipt, 'one' | 'two' | 'read' | undefined> = { pending: undefined, sent: 'one', delivered: 'two', read: 'read' }

export const ticksOf = (receipt: Receipt | undefined): 'one' | 'two' | 'read' | undefined =>
  (receipt === undefined ? undefined : TICKS[receipt])
