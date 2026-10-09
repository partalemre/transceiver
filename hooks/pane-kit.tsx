// What every part of the pane draws with: the drawing context, Svg placement, a card frame and its header, a
// rule, a bordered icon button, faces for rooms and people, and the receipt glyphs of the terminal.
import type { ElementTable, RenderChildren, RenderElement, RenderSurface } from 'claude-code'

import type { PaneHandlers } from './actions'
import { WAITING } from './connection'
import { GLYPH } from './kit/icons'
import type { Part, SvgPic } from './kit/svg-core'
import { upperTr } from './kit/svg-core'
import type { Role } from './kit/tokens'
import { PRESENCE_MS } from './limits'
import { headPart, sigPic, type Glyph } from './sig'
import { facePart } from './sig-chat'
import { tilePart } from './sig-states'
import { rulePart } from './sig-ui'
import type { PaneModel, Receipt, RoomView } from './state-types'
import { avatarRole, initialsOf, type Look, type Tone } from './theme'

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
const FRAME_PAD_X = 2
const FRAME_BORDER = 2
const MIN_PX = 160

export const isText = (ctx: Ctx): boolean => ctx.look.isText || !('Svg' in ctx.ui)
export const pxOf = (columns: number): number => Math.max(MIN_PX, columns * PX_PER_CELL)
// The px a frame's content gets inside `columns`.
export const innerPx = (columns: number): number => pxOf(columns - FRAME_PAD_X * 2 - FRAME_BORDER)
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

export type ToneName = 'signal' | Role
export const toneOf = (look: Look, name: ToneName): Tone => (name === 'signal' ? look.signal : look.role[name])

// A card: round border in the tone's line, card fill on the desktop; `isDanger` is the single Flare border.
export function Frame(ctx: Ctx, o: { tone?: ToneName; isDanger?: boolean; key?: string; children: RenderChildren }): RenderElement {
  const { Box } = ctx.ui
  const tone = o.isDanger ? ctx.look.role.danger : o.tone === undefined ? undefined : toneOf(ctx.look, o.tone)
  return (
    <Box key={o.key} flexDirection="column" borderStyle={o.isDanger ? 'single' : 'round'} borderColor={tone?.line ?? ctx.look.line}
      backgroundColor={ctx.look.card} paddingX={FRAME_PAD_X} paddingY={isText(ctx) ? 0 : 1} gap={1}>
      {o.children}
    </Box>
  )
}

// `width` (px) for a header drawn outside a frame; inside one it is the frame's inner width.
export type HeadSpec = { glyph: Glyph; tone: ToneName; eyebrow: string; headline?: string; sub?: string; meta?: string; width?: number }

// The forms' header: one Svg on the desktop (tile, eyebrow, headline, sub), lines of text on the terminal.
export function Head(ctx: Ctx, o: HeadSpec): RenderElement {
  const { Box, Text } = ctx.ui
  if (!isText(ctx)) return SvgOf(ctx, sigPic(headPart({ ...o, paint: o.tone, width: o.width ?? innerPx(ctx.columns) }))) ?? <Box />
  const tone = toneOf(ctx.look, o.tone)
  const glyph = o.glyph === 'radio' ? '((·))' : GLYPH[o.glyph]
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={tone.fg} bold>{`${glyph} ${upperTr(o.eyebrow)}`}</Text>
        {o.meta ? <Text color={ctx.look.lo}>{o.meta}</Text> : null}
      </Box>
      {o.headline ? <Text bold>{o.headline}</Text> : null}
      {o.sub ? <Text color={ctx.look.mid} wrap="wrap">{o.sub}</Text> : null}
    </Box>
  )
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

// A bordered, plain button with one glyph ("‹", "+"), as the boards' icon buttons.
export function IconButton(ctx: Ctx, o: { key: string; label: string; onPress: () => void }): RenderElement {
  const { Box, Button } = ctx.ui
  return (
    <Box key={`${o.key}-box`} borderStyle="round" borderColor={ctx.look.lineStrong} paddingX={isText(ctx) ? 0 : 1} flexShrink={0}>
      <Button key={o.key} label={o.label} plain onPress={() => o.onPress()} />
    </Box>
  )
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

export const ticksOf = (receipt: Receipt | undefined): 'one' | 'two' | 'read' | undefined =>
  receipt === undefined || receipt === 'pending' ? undefined : receipt === 'read' ? 'read' : receipt === 'sent' ? 'one' : 'two'
