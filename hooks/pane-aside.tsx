// A project room's details, shown only when the person asks ("Details", "Why?"): the gate's four conditions
// as the gate last saw them, the day's ask budget, what this machine answered today, and the live-mode switch with
// its warning. Inline under the head when narrow, a column beside the chat when wide; native Text on every
// surface, so it reads in Claude's theme.
import type { RenderElement } from 'claude-code'

import { isText, type Ctx } from './pane-kit'
import { checkedText, checkRows, gateWord, passedOf } from './pane-words'
import type { RoomView } from './state-types'
import { chatWords } from './words-chat'

// A check not yet run is open, then passed or failed.
function markOf(state: boolean | null): string {
  if (state === null) return '○'
  return state ? '✓' : '✕'
}

function Gate(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Text } = ctx.ui
  const rows = checkRows(room)
  const word = gateWord(room.gate)
  return (
    <Box key="info-gate" flexDirection="column">
      <Text color={ctx.look.role[word.paint as 'ok'].fg} bold>{`${word.glyph} ${word.label} · ${passedOf(rows)}/${rows.length}`}</Text>
      {rows.map((r, i) => <Text key={`check-${i}`} color={r.state === false ? ctx.look.role.danger.fg : ctx.look.hi}>{`${markOf(r.state)} ${r.text}`}</Text>)}
      <Text color={ctx.look.lo}>{checkedText(room, ctx.model.now)}</Text>
    </Box>
  )
}

function Today(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Text } = ctx.ui
  const p = room.project
  const used = p?.askUsed ?? 0
  const limit = p?.askLimit ?? 0
  return (
    <Box key="info-today" flexDirection="column">
      <Text color={used >= limit ? ctx.look.role.warn.fg : ctx.look.hi}>{chatWords().budget({ used, limit })}</Text>
      <Text color={ctx.look.lo} wrap="wrap">{chatWords().budgetNote}</Text>
      <Text color={ctx.look.lo} wrap="wrap">{chatWords().today({ answered: p?.today.answered ?? 0, modelless: p?.today.modelless ?? 0, denied: p?.today.denied ?? 0 })}</Text>
    </Box>
  )
}

function Live(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  return (
    <Box key="info-live" flexDirection="column">
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={room.isLive ? ctx.look.signal.fg : ctx.look.hi}>{chatWords().live(room.isLive)}</Text>
        <Button key={`live-${room.id}`} label={room.isLive ? chatWords().turnOff : chatWords().turnOn} plain onPress={() => ctx.on.toggleLive(room.id)} />
      </Box>
      <Text color={ctx.look.lo} wrap="wrap">{chatWords().liveNote}</Text>
    </Box>
  )
}

export function RoomInfo(ctx: Ctx, room: RoomView): RenderElement | null {
  const { Box } = ctx.ui
  if (room.project === undefined) return null
  return (
    <Box key="info" flexDirection="column" gap={isText(ctx) ? 0 : 1}>
      {Gate(ctx, room)}
      {Today(ctx, room)}
      {Live(ctx, room)}
    </Box>
  )
}
