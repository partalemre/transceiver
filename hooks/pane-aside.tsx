// A project room's details, shown only when the person asks ("Ayrıntılar", "Neden?"): the gate's four conditions
// as the gate last saw them, the day's ask budget, what this machine answered today, and the live-mode switch with
// its warning. Inline under the head when narrow, a column beside the chat when wide.
import type { RenderElement } from 'claude-code'

import { isText, Pic, Rule, SvgOf, type Ctx } from './pane-kit'
import { checkedText, checkRows, GATE_WORD, passedOf } from './pane-words'
import { sigPic, switchPart } from './sig'
import { budgetPart, checklistPart, statsPart } from './sig-room'
import { eyebrowPiece, rowPart } from './sig-ui'
import type { RoomView } from './state-types'

const BUDGET_NOTE = 'Gece yarısı sıfırlanır. Dolunca cevap taslağa düşer.'
const LIVE_NOTE = 'Açıkken gelen agent mesajı bu repodaki boşta oturumu uyandırır. Her uyanış token harcar.'

function LiveRow(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  return (
    <Box key="aside-live" flexDirection="column" gap={1}>
      <Box flexDirection="row" alignItems="center" gap={1}>
        {Pic(ctx, rowPart({ width: 120, height: 18, left: [eyebrowPiece('Canlı mod', { paint: 'lo' })], alt: 'Canlı mod' }), 'live-label')}
        <Box flexGrow={1} />
        {SvgOf(ctx, sigPic(switchPart(room.isLive)), 'live-knob')}
        <Button key={`live-${room.id}`} label={room.isLive ? 'Kapat' : 'Aç'} plain onPress={() => ctx.on.toggleLive(room.id)} />
      </Box>
      <Text color={ctx.look.mid} wrap="wrap">{LIVE_NOTE}</Text>
    </Box>
  )
}

// A check not yet run is open, then passed or failed.
function markOf(state: boolean | null): string {
  if (state === null) return '○'
  return state ? '✓' : '✕'
}

// The same on the terminal, as lines.
function TextAside(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const p = room.project
  const rows = checkRows(room)
  const word = GATE_WORD[room.gate]
  return (
    <Box key="info" flexDirection="column">
      <Text color={ctx.look.role[word.paint as 'ok'].fg} bold>{`${word.glyph} ${word.label} · ${passedOf(rows)}/${rows.length}`}</Text>
      {rows.map((r, i) => <Text key={`check-${i}`} color={r.state === false ? ctx.look.role.danger.fg : undefined}>{`${markOf(r.state)} ${r.text}`}</Text>)}
      <Text color={ctx.look.lo}>{checkedText(room, ctx.model.now)}</Text>
      <Text>{`Ask bütçesi ${p?.askUsed ?? 0}/${p?.askLimit ?? 0} bugün`}</Text>
      <Text color={ctx.look.lo}>{`bugün: ${p?.today.answered ?? 0} sorgu · ${p?.today.modelless ?? 0} 0 token · ${p?.today.denied ?? 0} reddedildi`}</Text>
      <Box flexDirection="row" gap={1}>
        <Text>{`canlı ${room.isLive ? 'açık' : 'kapalı'}`}</Text>
        <Button key={`live-${room.id}`} label={room.isLive ? 'Kapat' : 'Aç'} plain onPress={() => ctx.on.toggleLive(room.id)} />
      </Box>
    </Box>
  )
}

export function RoomInfo(ctx: Ctx, room: RoomView): RenderElement | null {
  const { Box } = ctx.ui
  const p = room.project
  if (p === undefined) return null
  if (isText(ctx)) return TextAside(ctx, room)
  const rows = checkRows(room)
  const word = GATE_WORD[room.gate]
  const tone = { paint: word.paint, label: `${word.label} · ${passedOf(rows)}/${rows.length}` }
  const stats = [
    { value: p.today.answered, label: 'sorgu', paint: 'hi' },
    { value: p.today.modelless, label: '0 token', paint: 'signal' },
    { value: p.today.denied, label: 'reddedildi', paint: 'danger' },
  ]
  return (
    <Box key="info" flexDirection="column" gap={2}>
      {Pic(ctx, checklistPart({ width: ctx.px, tone, checks: rows, meta: checkedText(room, ctx.model.now) }), 'aside-gate')}
      {Rule(ctx, 'aside-rule-1')}
      {Pic(ctx, budgetPart({ width: ctx.px, used: p.askUsed, limit: p.askLimit, note: BUDGET_NOTE }), 'aside-budget')}
      {Rule(ctx, 'aside-rule-2')}
      {Pic(ctx, statsPart({ width: ctx.px, stats }), 'aside-stats')}
      {Rule(ctx, 'aside-rule-3')}
      {LiveRow(ctx, room)}
    </Box>
  )
}
