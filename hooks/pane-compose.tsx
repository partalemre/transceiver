// The composer on the desktop: the field (a placeholder addressed to the room) and "Send". A project room adds
// one "ask Leo's agent" button that opens the sheet of every query the protocol takes (one to a row, the free `ask`
// apart in Amber) and a removable mode chip once the field is set to one. A hint line shows only when it has
// something to say (an unknown command, a missing value).
import type { RenderElement } from 'claude-code'

import { ASK_DAILY_LIMIT } from './limits'
import { GlyphPic, Rule, within, type Ctx } from './pane-kit'
import { isModeType, specOf, supportedSpecs, type QuerySpec } from './query-menu'
import type { RoomView } from './state-types'
import { chatWords } from './words-chat'

const ASK_TYPE = 'ask'
// The sheet's border and padding, kept off its rule.
const SHEET_CHROME_CELLS = 4

export function placeholderOf(room: RoomView, mode: string | null): string {
  const arg = mode === null ? undefined : specOf(mode)?.arg
  if (arg !== undefined) return arg.placeholder
  const w = chatWords()
  if (room.kind === 'project') return w.placeProject
  return room.peerName === undefined ? w.placeAnyone : w.placePeer(room.peerName)
}

function AskButton(ctx: Ctx, room: RoomView): RenderElement {
  const { Button } = ctx.ui
  return <Button key={`ask-more-${room.id}`} label={ctx.model.isSheetOpen ? chatWords().close : chatWords().askAgent(room.peerName)} variant="secondary" onPress={() => ctx.on.toggleSheet(room.id)} />
}

// One query a row: its name to press, then what it returns.
function Cell(ctx: Ctx, o: { room: RoomView; spec: QuerySpec }): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const isOn = ctx.model.composeMode === o.spec.type
  return (
    <Box key={`cell-${o.spec.type}`} flexDirection="row" alignItems="center" gap={1} paddingX={1} backgroundColor={isOn ? ctx.look.role.run.tint : undefined}>
      <Button key={`sheet-${o.spec.type}`} label={`${o.spec.type}${isModeType(o.spec.type) ? ' …' : ''}`} plain onPress={() => ctx.on.askAgent(o.room.id, o.spec.type)} />
      <Box flexGrow={1} flexShrink={1}><Text color={isOn ? ctx.look.mid : ctx.look.lo} wrap="truncate-end">{o.spec.desc}</Text></Box>
    </Box>
  )
}

function AskRow(ctx: Ctx, o: { room: RoomView; spec: QuerySpec }): RenderElement {
  const { Box, Button, Text } = ctx.ui
  return (
    <Box key="ask-row" flexDirection="row" alignItems="center" gap={1} paddingX={1}>
      {GlyphPic(ctx, { glyph: 'star', paint: 'warn', key: 'ask-star' })}
      <Box flexDirection="column" alignItems="flex-start" flexGrow={1} flexShrink={1}>
        <Button key={`sheet-${ASK_TYPE}`} label="ask …" plain onPress={() => ctx.on.askAgent(o.room.id, ASK_TYPE)} />
        <Text color={ctx.look.lo} wrap="truncate-end">{o.spec.desc}</Text>
      </Box>
      <Text color={ctx.look.mid}>{chatWords().perDay(ASK_DAILY_LIMIT)}</Text>
    </Box>
  )
}

// Ask Leo's agent ··· 12 ready queries · 0 tokens, the grid, then `ask …` apart.
function Sheet(ctx: Ctx, room: RoomView): RenderElement | null {
  const { Box, Text } = ctx.ui
  if (!ctx.model.isSheetOpen) return null
  const specs = supportedSpecs()
  const typed = specs.filter(s => s.type !== ASK_TYPE)
  const ask = specs.find(s => s.type === ASK_TYPE)
  const title = chatWords().sheetTitle(room.peerName)
  return (
    <Box key="sheet" flexDirection="column" gap={1} borderStyle="round" borderColor={ctx.look.lineStrong} backgroundColor={ctx.look.card} paddingX={1} paddingY={1}>
      <Box key="sheet-head" flexDirection="row" gap={1} paddingX={1}>
        <Box flexGrow={1}><Text color={ctx.look.role.run.fg} bold>{title}</Text></Box>
        <Text color={ctx.look.lo}>{chatWords().ready(typed.length)}</Text>
      </Box>
      <Box flexDirection="column">{typed.map(spec => Cell(ctx, { room, spec }))}</Box>
      {ask === undefined ? null : Rule(within(ctx, ctx.columns - SHEET_CHROME_CELLS), 'sheet-rule')}
      {ask === undefined ? null : AskRow(ctx, { room, spec: ask })}
    </Box>
  )
}

function ModeChip(ctx: Ctx): RenderElement | null {
  const { Box, Button, Text } = ctx.ui
  const mode = ctx.model.composeMode
  if (mode === null) return null
  const run = ctx.look.role.run
  return (
    <Box key="mode-chip" flexDirection="row" alignItems="center" gap={1} borderStyle="round" borderColor={run.line} backgroundColor={run.tint} paddingX={1} flexShrink={0}>
      <Text color={run.fg}>{mode}</Text>
      <Button key="mode-clear" label="×" plain onPress={() => ctx.on.clearMode()} />
    </Box>
  )
}

function HintRow(ctx: Ctx): RenderElement | null {
  const { Text } = ctx.ui
  const hint = ctx.model.hint
  return hint === null ? null : <Text key="hint" color={ctx.look.role.warn.fg} wrap="wrap">{hint}</Text>
}

export function Composer(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Text } = ctx.ui
  if (!('Input' in ctx.ui)) return <Text key="read-only" color={ctx.look.lo} wrap="wrap">{chatWords().readOnly}</Text>
  const { Input, Button } = ctx.ui
  const isProject = room.kind === 'project'
  const mode = ctx.model.composeMode
  return (
    <Box key="composer" flexDirection="column" gap={1}>
      {isProject ? Sheet(ctx, room) : null}
      <Box key="field-row" flexDirection="row" alignItems="center" gap={1}>
        {isProject && mode === null ? AskButton(ctx, room) : null}
        {ModeChip(ctx)}
        <Box flexGrow={1} flexDirection="column">
          <Input key={`composer-${room.id}-${ctx.model.composerKey}`} placeholder={placeholderOf(room, mode)} submitLabel={mode === null ? chatWords().send : chatWords().ask}
            autoFocus onInput={value => ctx.on.type(room.id, value)} onSubmit={value => ctx.on.send(room.id, value)} />
        </Box>
        <Button key={`send-${room.id}`} variant="primary" label={mode === null ? chatWords().send : chatWords().ask} onPress={() => ctx.on.sendTyped(room.id)} />
      </Box>
      {HintRow(ctx)}
    </Box>
  )
}
