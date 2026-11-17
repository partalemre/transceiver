// A run of lines from one sender on the desktop: one drawing (sig-talk.ts) that says who wrote them (a monogram for a
// person, a crab for an AI, "Alperen's AI" in words), when, and what became of mine. A DM that names a shared project
// room carries a quiet press to it. System lines sit centred; an unreadable doc says it is one.
import type { RenderElement } from 'claude-code'

import { waitingText } from './connection'
import { SvgOf, type Ctx } from './pane-kit'
import { runPic, type Said } from './sig-talk'
import { themed } from './sig-ink'
import type { Line, RoomView } from './state-types'
import { firstName } from './tr'
import { messageOf } from './traffic'
import { agentOf } from './tx-words'
import { clockText } from './when'
import { chatWords } from './words-chat'
import { paneWords } from './words-pane'
import { shownSystem } from './words-wire'

// Under their bubbles: the drawing's text column in cells, less the button's own padding.
const CHIP_INDENT = 3

export type RunOpts = { lines: Line[]; room: RoomView }

// A line still going out says so, as a warning while the session may not write yet.
function pendingOf(ctx: Ctx, lines: Line[]): { text: string; isWarn: boolean } | undefined {
  if (!lines.some(l => l.receipt === 'pending')) return undefined
  return ctx.model.isConnected ? { text: chatWords().sending, isWarn: false } : { text: waitingText(), isWarn: true }
}

const isAgentLine = (line: Line): boolean => messageOf(line)?.kind === 'agent'

// In the person's own room both sides are them: what tells a line apart is who wrote it, and on which computer.
function labelOf(ctx: Ctx, o: { line: Line; room: RoomView }): string {
  const { line } = o
  if (o.room.kind === 'devices') return `${isAgentLine(line) ? 'Claude' : paneWords().you} · ${line.isMine ? ctx.model.bridge.name : line.authorName}`
  return isAgentLine(line) ? agentOf(line) : firstName(line.authorName)
}

const saidOf = (line: Line): Said => ({ text: messageOf(line)?.text ?? '', quote: line.replyTo, isPending: line.receipt === 'pending' })

// "Go to room · eliti": a shared project room this DM names, one quiet press under the line. The words alone, so
// the button's own hover box is all of it.
function RoomChip(ctx: Ctx, line: Line): RenderElement | null {
  const { Box, Button } = ctx.ui
  const link = line.roomLink
  if (link === undefined) return null
  return (
    <Box key={`room-chip-${line.id}`} flexDirection="row" alignItems="center" paddingLeft={line.isMine ? 0 : CHIP_INDENT} justifyContent={line.isMine ? 'flex-end' : 'flex-start'}>
      <Button key={`goto-${line.id}`} label={`${chatWords().goToRoom} · ${link.repo.split('/')[1] ?? link.repo}`} plain dimColor onPress={() => ctx.on.select(link.roomId)} />
    </Box>
  )
}

function Lone(ctx: Ctx, line: Line): RenderElement {
  const { Box, Text } = ctx.ui
  const m = messageOf(line)
  const text = m === null ? chatWords().unreadable : shownSystem(m.text)
  return <Box key={`msg-${line.id}`} justifyContent="center"><Text {...ctx.look.loText} italic wrap="wrap">{text}</Text></Box>
}

export function Run(ctx: Ctx, o: RunOpts): RenderElement {
  const { Box } = ctx.ui
  const first = o.lines[0] as Line
  const m = messageOf(first)
  if (m === null || m.kind === 'system') return Lone(ctx, first)
  const last = o.lines.at(-1) as Line
  const lastTs = messageOf(last)?.ts ?? m.ts
  // My own lines need no name, unless my AI wrote them or the room is between my own computers.
  const hasHead = !first.isMine || isAgentLine(first) || o.room.kind === 'devices'
  const pic = runPic({
    width: ctx.px, said: o.lines.map(saidOf), hasHead, pending: pendingOf(ctx, o.lines),
    who: { label: labelOf(ctx, { line: first, room: o.room }), name: first.authorName, isAgent: isAgentLine(first), isMine: first.isMine },
    time: clockText(first.isMine ? lastTs : m.ts), tick: last.receipt,
  })
  const drawing = SvgOf(ctx, themed(pic, ctx.look.pin), `msg-${first.id}`)
  const chips = o.lines.map(line => RoomChip(ctx, line)).filter((c): c is RenderElement => c !== null)
  if (chips.length === 0 && drawing !== null) return drawing
  return <Box key={`run-${first.id}`} flexDirection="column" gap={1}>{drawing}{chips}</Box>
}
