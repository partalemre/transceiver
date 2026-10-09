// A person's message on the desktop: a rounded bubble, mine in signal on the right, theirs on the card colour on
// the left (a project room puts their face beside the last of a run); a run shows its time once, under the last;
// a reply quotes what it answers; a DM that names a shared project room carries a chip to it; a message still
// going out is dashed and says so. System lines sit centred; an unreadable doc says it is one.
import type { RenderElement } from 'claude-code'

import { isText, Pic, PX_PER_CELL, ticksOf, type Ctx } from './pane-kit'
import { facePart, quotePart, stampPart, type StampOpts } from './sig-chat'
import { glyphPiece, rowPart, textPiece } from './sig-ui'
import type { Line, RoomView } from './state-types'
import { avatarRole, initialsOf } from './theme'
import { messageOf } from './traffic'
import { clockText } from './when'

const FACE = 24
const FACE_CELLS = 3
// The empty side of a bubble: about a fifth of the pane, so mine and theirs never line up into one column.
const GUTTER_RATIO = 0.18
const BUBBLE_PAD_PX = 2 * PX_PER_CELL + 2
// The chip's glyph, and what "Odaya git" and the padding take beside the repo's name.
const CHIP_GLYPH = 16
const CHIP_ROOM_PX = 120

export type BubbleOpts = { line: Line; isFirst: boolean; isLast: boolean; room: RoomView }

const gutterOf = (ctx: Ctx) => Math.max(4, Math.round(ctx.columns * GUTTER_RATIO))

// A message still going out says so, in amber while it waits for "Bağlan".
function pendingStatus(ctx: Ctx, line: Line): StampOpts['status'] {
  if (line.receipt !== 'pending') return undefined
  return ctx.model.isConnected ? { text: 'gönderiliyor', paint: 'lo' } : { text: 'bağlantı bekleniyor', paint: 'warn' }
}

function Stamp(ctx: Ctx, line: Line, ts: number): RenderElement {
  const { Box } = ctx.ui
  const status = pendingStatus(ctx, line)
  return <Box key="stamp" flexDirection="row" justifyContent="flex-end">{Pic(ctx, stampPart({ time: clockText(ts), ticks: ticksOf(line.receipt), status }))}</Box>
}

// ⌥ partalemre/eliti ··· Odaya git: a shared project room this DM names.
function RoomChip(ctx: Ctx, o: { line: Line; maxPx: number }): RenderElement | null {
  const { Box, Button } = ctx.ui
  const link = o.line.roomLink
  if (link === undefined) return null
  const run = ctx.look.role.run
  const repo = textPiece(link.repo, { size: 12.5, isMono: true, paint: 'hi', max: Math.max(0, o.maxPx - CHIP_ROOM_PX) })
  const name = rowPart({ width: repo.width + CHIP_GLYPH + 8, height: 18, left: [glyphPiece('branch', { size: CHIP_GLYPH, paint: 'run' }), repo], alt: link.repo })
  return (
    <Box key="room-chip" flexDirection="row" alignItems="center" gap={1} borderStyle="round" borderColor={run.line} backgroundColor={run.tint} paddingX={1}>
      {Pic(ctx, name)}
      <Box flexGrow={1} />
      <Button key={`goto-${o.line.id}`} label="Odaya git" plain onPress={() => ctx.on.select(link.roomId)} />
    </Box>
  )
}

function bubbleBody(ctx: Ctx, o: BubbleOpts & { text: string; ts: number }): RenderElement {
  const { Box, Text } = ctx.ui
  const { line } = o
  const tone = line.isMine ? ctx.look.signal : { tint: ctx.look.card, line: ctx.look.line }
  const maxPx = (ctx.columns - gutterOf(ctx) - FACE_CELLS) * PX_PER_CELL - BUBBLE_PAD_PX
  const isPending = line.receipt === 'pending'
  return (
    <Box flexDirection="column" borderStyle={isPending ? 'dashed' : 'round'} borderColor={tone.line} backgroundColor={tone.tint} paddingX={1} gap={0}>
      {line.replyTo === undefined ? null : Pic(ctx, quotePart({ ...line.replyTo, maxWidth: maxPx }), 'quote')}
      <Text key="text" color={ctx.look.hi} wrap="wrap">{o.text}</Text>
      {RoomChip(ctx, { line, maxPx })}
      {o.isLast || isPending ? Stamp(ctx, line, o.ts) : null}
    </Box>
  )
}

// Their face beside the last bubble of a run, a blank of its width beside the others; only project rooms show faces.
function Face(ctx: Ctx, o: BubbleOpts): RenderElement | null {
  const { line } = o
  if (o.room.kind !== 'project') return null
  if (o.isLast) return Pic(ctx, facePart({ initials: initialsOf(line.authorName), paint: avatarRole(line.seed), size: FACE }), `face-${line.id}`)
  const { Box } = ctx.ui
  return <Box key={`face-${line.id}`} width={FACE_CELLS} flexShrink={0} />
}

// Mine to the right with the gutter on the left; theirs to the left, behind their face in a project room.
function Side(ctx: Ctx, o: BubbleOpts & { body: RenderElement }): RenderElement {
  const { Box } = ctx.ui
  const { line } = o
  const gutter = gutterOf(ctx)
  if (line.isMine) return <Box key={`msg-${line.id}`} flexDirection="row" justifyContent="flex-end" paddingLeft={gutter}>{o.body}</Box>
  const face = Face(ctx, o)
  return (
    <Box key={`msg-${line.id}`} flexDirection="row" alignItems="flex-end" gap={1} paddingRight={gutter}>
      {face}
      {o.body}
    </Box>
  )
}

export function Bubble(ctx: Ctx, o: BubbleOpts): RenderElement {
  const { Box, Text } = ctx.ui
  const m = messageOf(o.line)
  if (m === null) return <Box key={`msg-${o.line.id}`} paddingLeft={FACE_CELLS + 1}><Text color={ctx.look.lo} italic>okunamayan mesaj</Text></Box>
  if (m.kind === 'system' || isText(ctx)) {
    return <Box key={`msg-${o.line.id}`} justifyContent="center"><Text color={ctx.look.lo} italic wrap="wrap">{m.text}</Text></Box>
  }
  return Side(ctx, { ...o, body: bubbleBody(ctx, { ...o, text: m.text, ts: m.ts }) })
}
