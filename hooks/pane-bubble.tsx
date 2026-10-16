// A person's message on the desktop: a rounded bubble, mine in signal on the right, theirs on the card colour on
// the left (a project room puts their face beside the last of a run); a run shows its time once, under the last;
// a reply quotes what it answers; a DM that names a shared project room carries a chip to it; a message still
// going out is dashed and says so. System lines sit centred; an unreadable doc says it is one.
import type { RenderElement } from 'claude-code'

import { waitingText } from './connection'
import { GlyphPic, isText, Pic, receiptTone, type Ctx } from './pane-kit'
import { facePart } from './sig-chat'
import type { Line, RoomView } from './state-types'
import { avatarRole, initialsOf } from './theme'
import { messageOf } from './traffic'
import { clockText } from './when'
import { chatWords } from './words-chat'
import { shownSystem } from './words-wire'

const FACE = 24
const FACE_CELLS = 3
// The empty side of a bubble: about a fifth of the pane, so mine and theirs never line up into one column.
const GUTTER_RATIO = 0.18

export type BubbleOpts = { line: Line; isFirst: boolean; isLast: boolean; room: RoomView }

const gutterOf = (ctx: Ctx) => Math.max(4, Math.round(ctx.columns * GUTTER_RATIO))

// A message still going out says so, in amber while it waits for "Connect".
function pendingStatus(ctx: Ctx, line: Line): { text: string; color?: string } | null {
  if (line.receipt !== 'pending') return null
  return ctx.model.isConnected ? { text: chatWords().sending, color: ctx.look.lo } : { text: waitingText(), color: ctx.look.role.warn.fg }
}

// The time, then the receipt ticks or why it has none yet; text, so the host draws it in Claude's theme.
function Stamp(ctx: Ctx, line: Line, ts: number): RenderElement {
  const { Box, Text } = ctx.ui
  const status = pendingStatus(ctx, line)
  const tick = status === null && line.receipt !== undefined ? receiptTone(ctx, line.receipt) : null
  return (
    <Box key="stamp" flexDirection="row" justifyContent="flex-end" gap={1}>
      <Text color={ctx.look.lo}>{clockText(ts)}</Text>
      {status === null ? null : <Text color={status.color}>{status.text}</Text>}
      {tick === null ? null : <Text color={tick.color}>{tick.glyph}</Text>}
    </Box>
  )
}

// The message a reply answers: who wrote it and its first words, on the inset.
function Quote(ctx: Ctx, line: Line): RenderElement | null {
  const { Box, Text } = ctx.ui
  const quote = line.replyTo
  if (quote === undefined) return null
  return (
    <Box key="quote" flexDirection="column" backgroundColor={ctx.look.inset} paddingX={1}>
      <Text color={ctx.look.signal.fg} bold>{quote.name}</Text>
      <Text color={ctx.look.lo} wrap="truncate-end">{quote.text}</Text>
    </Box>
  )
}

// ⌥ partalemre/eliti ··· Go to room: a shared project room this DM names.
function RoomChip(ctx: Ctx, line: Line): RenderElement | null {
  const { Box, Button, Text } = ctx.ui
  const link = line.roomLink
  if (link === undefined) return null
  const run = ctx.look.role.run
  return (
    <Box key="room-chip" flexDirection="row" alignItems="center" gap={1} borderStyle="round" borderColor={run.line} backgroundColor={run.tint} paddingX={1}>
      {GlyphPic(ctx, { glyph: 'branch', paint: 'run', key: `chip-glyph-${line.id}` })}
      <Box flexGrow={1} flexShrink={1}><Text color={ctx.look.hi} wrap="truncate-end">{link.repo}</Text></Box>
      <Button key={`goto-${line.id}`} label={chatWords().goToRoom} plain onPress={() => ctx.on.select(link.roomId)} />
    </Box>
  )
}

function bubbleBody(ctx: Ctx, o: BubbleOpts & { text: string; ts: number }): RenderElement {
  const { Box, Text } = ctx.ui
  const { line } = o
  const tone = line.isMine ? ctx.look.signal : { tint: ctx.look.card, line: ctx.look.line }
  const isPending = line.receipt === 'pending'
  return (
    <Box flexDirection="column" borderStyle={isPending ? 'dashed' : 'round'} borderColor={tone.line} backgroundColor={tone.tint} paddingX={1} gap={0}>
      {Quote(ctx, line)}
      <Text key="text" color={ctx.look.hi} wrap="wrap">{o.text}</Text>
      {RoomChip(ctx, line)}
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
  if (m === null) return <Box key={`msg-${o.line.id}`} paddingLeft={FACE_CELLS + 1}><Text color={ctx.look.lo} italic>{chatWords().unreadable}</Text></Box>
  if (m.kind === 'system' || isText(ctx)) {
    return <Box key={`msg-${o.line.id}`} justifyContent="center"><Text color={ctx.look.lo} italic wrap="wrap">{shownSystem(m.text)}</Text></Box>
  }
  return Side(ctx, { ...o, body: bubbleBody(ctx, { ...o, text: m.text, ts: m.ts }) })
}
