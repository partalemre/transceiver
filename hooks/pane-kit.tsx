// What every part of the pane draws with: the drawing context, Svg placement, a card frame and its header, an
// avatar, and a pill, each for the desktop (Svg, hex) and the terminal (glyphs, theme keys).
import type { ElementTable, RenderChildren, RenderElement, RenderSurface } from 'claude-code'

import type { PaneHandlers } from './actions'
import { GLYPH } from './kit/icons'
import type { SvgPic } from './kit/svg-core'
import { upperTr } from './kit/svg-core'
import { pillPart } from './kit/svg-shapes'
import type { Role } from './kit/tokens'
import { avatarPart, headPart, sigPic, tilePart, type Glyph } from './sig'
import { WAITING } from './connection'
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

// The brand as an eyebrow: written in capitals already, since Turkish casing would dot its i (TRANSCEİVER).
export const BRAND = 'TRANSCEIVER'
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

// The card header: one Svg on the desktop (tile, eyebrow, headline, sub), lines of text on the terminal.
export function Head(ctx: Ctx, o: HeadSpec): RenderElement {
  const { Box, Text } = ctx.ui
  if (!isText(ctx)) {
    const pic = sigPic(headPart({ ...o, paint: o.tone, width: o.width ?? innerPx(ctx.columns) }))
    return SvgOf(ctx, pic) ?? <Box />
  }
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

export type AvatarKind = 'person' | 'project' | 'waiting'

export const kindOf = (room: RoomView): AvatarKind => (room.kind === 'project' ? 'project' : room.isWaiting ? 'waiting' : 'person')

// A person's circle with initials (their colour from their uid), a project's tile, or an amber clock for a room
// whose friend has not joined yet; on the terminal a glyph.
export function Avatar(ctx: Ctx, o: { name: string; seed: string; size: number; kind?: AvatarKind; key?: string }): RenderElement {
  const { Text } = ctx.ui
  const kind = o.kind ?? 'person'
  const role = kind === 'waiting' ? 'warn' : avatarRole(o.seed)
  if (isText(ctx)) return <Text key={o.key} color={ctx.look.role[role].fg}>{kind === 'project' ? '⌥' : kind === 'waiting' ? '◷' : '●'}</Text>
  const part = kind === 'person'
    ? avatarPart({ initials: initialsOf(o.name), paint: role, size: o.size })
    : tilePart({ glyph: kind === 'project' ? 'branch' : 'clock', paint: role, size: o.size })
  return SvgOf(ctx, sigPic({ ...part, alt: o.name }), o.key) ?? <Text>{o.name}</Text>
}

export function Pill(ctx: Ctx, o: { text: string; tone?: Role; key?: string }): RenderElement {
  const { Text } = ctx.ui
  if (isText(ctx)) return <Text key={o.key} color={o.tone ? ctx.look.role[o.tone].fg : ctx.look.lo}>{`[${o.text}]`}</Text>
  return SvgOf(ctx, sigPic(pillPart({ text: o.text, role: o.tone })), o.key) ?? <Text>{o.text}</Text>
}

// One line of meta text in text.lo.
export function Meta(ctx: Ctx, text: string, key?: string): RenderElement {
  const { Text } = ctx.ui
  return <Text key={key} color={ctx.look.lo} wrap="wrap">{text}</Text>
}

const MS_PER_S = 1000

// "sinyal 0,7 sn": how long the last poll of the room took, with a Turkish decimal comma.
export const latencyText = (ms: number | null): string =>
  ms === null || ms <= 0 ? '' : `sinyal ${(ms / MS_PER_S).toFixed(1).replace('.', ',')} sn`

export type ReceiptTone = { glyph: string; color?: string }

// ◷ waiting (with why, while the session may not write), ✓ written, ✓✓ reached them, ✓✓ in Tide once read.
export function receiptTone(ctx: Ctx, receipt: Receipt): ReceiptTone {
  if (receipt === 'pending') {
    return ctx.model.isConnected ? { glyph: '◷', color: ctx.look.lo } : { glyph: `◷ ${WAITING}`, color: ctx.look.role.warn.fg }
  }
  if (receipt === 'read') return { glyph: '✓✓', color: ctx.look.role.read.fg }
  return { glyph: receipt === 'sent' ? '✓' : '✓✓', color: ctx.look.lo }
}
