// A project room's details, shown only when the person asks ("Details", "Why?"): the gate's four conditions
// as the gate last saw them, the day's ask budget, what this machine answered today, and the live-mode switch with
// its warning. Inline under the head when narrow, a column beside the chat when wide; native Text on every
// surface, so it reads in Claude's theme.
import type { RenderElement } from 'claude-code'

import { PressRow } from './kit/press'
import { isText, SvgOf, type Ctx } from './pane-kit'
import { infoPic, livePic } from './sig-info'
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
      <Text {...ctx.look.loText}>{checkedText(room, ctx.model.now)}</Text>
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
      <Text {...ctx.look.loText} wrap="wrap">{chatWords().budgetNote}</Text>
      <Text {...ctx.look.loText} wrap="wrap">{chatWords().today({ answered: p?.today.answered ?? 0, modelless: p?.today.modelless ?? 0, denied: p?.today.denied ?? 0 })}</Text>
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
      <Text {...ctx.look.loText} wrap="wrap">{chatWords().liveNote}</Text>
    </Box>
  )
}

// The desktop's two cards: the gate with the day's asks, and the live switch pressed as a whole.
function InfoCards(ctx: Ctx, room: RoomView): RenderElement | null {
  const { Box } = ctx.ui
  const p = room.project
  if (p === undefined) return null
  const rows = checkRows(room)
  const word = gateWord(room.gate)
  const w = chatWords()
  const used = p.askUsed
  const gate = { paint: word.paint, label: word.label, passed: `${passedOf(rows)}/${rows.length}`, checks: rows, checked: checkedText(room, ctx.model.now) }
  const budget = { text: w.budget({ used, limit: p.askLimit }), used, limit: p.askLimit, note: w.budgetNote, today: w.today(p.today) }
  const card = SvgOf(ctx, infoPic({ width: ctx.px, gate, budget, pin: ctx.look.pin }), `info-card-${room.id}`)
  const live = SvgOf(ctx, livePic({ width: ctx.px, label: w.live(room.isLive), action: room.isLive ? w.turnOff : w.turnOn, note: w.liveNote, isOn: room.isLive, pin: ctx.look.pin }), `info-live-${room.id}`)
  if (card === null || live === null) return null
  return (
    <Box key="info" flexDirection="column" gap={1}>
      {card}
      {PressRow(ctx.ui, { box: 'live-row', key: `live-${room.id}`, drawing: live, onPress: () => ctx.on.toggleLive(room.id) })}
    </Box>
  )
}

export function RoomInfo(ctx: Ctx, room: RoomView): RenderElement | null {
  const { Box } = ctx.ui
  if (room.project === undefined) return null
  if (!isText(ctx)) return InfoCards(ctx, room)
  return (
    <Box key="info" flexDirection="column" gap={isText(ctx) ? 0 : 1}>
      {Gate(ctx, room)}
      {Today(ctx, room)}
      {Live(ctx, room)}
    </Box>
  )
}
