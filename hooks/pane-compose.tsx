// The composer on the desktop: in a project room the "Agent'ına sor" chips and their sheet (every query the
// protocol takes, two to a row, the free `ask` apart in Amber), then the field (a removable mode chip when it is
// set to a query, a placeholder addressed to the room), the send button and a hint row.
import type { RenderElement } from 'claude-code'

import { Pic, PX_PER_CELL, type Ctx } from './pane-kit'
import { CHIP_TYPES, isModeType, specOf, supportedSpecs, type QuerySpec } from './query-menu'
import { sheetHeadPart } from './sig-agent'
import { glyphPiece, rowPart, rulePart, textPiece } from './sig-ui'
import type { RoomView } from './state-types'
import { dative, genitive } from './tr'

const SHEET_CHROME_PX = 2 * PX_PER_CELL + 2
const ASK_TYPE = 'ask'

export function placeholderOf(room: RoomView, mode: string | null): string {
  const arg = mode === null ? undefined : specOf(mode)?.arg
  if (arg !== undefined) return arg.placeholder
  if (room.kind === 'project') return 'Odaya yaz, /ask ile agent\'a sor'
  return room.peerName === undefined ? 'Mesaj yaz' : `${dative(room.peerName)} yaz`
}

export function hintOf(ctx: Ctx, room: RoomView): { left: string; right: string } {
  if (ctx.model.composeMode !== null) return { left: 'Enter sorar · × normal mesaja döner', right: '/grep /file /ask …' }
  if (room.kind === 'project') return { left: 'Enter gönderir', right: '/status /diff /ask …' }
  return { left: 'Enter gönderir', right: `okundu bilgisi ${ctx.model.settings.isReceiptsOn ? 'açık' : 'kapalı'}` }
}

function Chip(ctx: Ctx, o: { key: string; label: string; onPress: () => void; isOn?: boolean }): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const run = ctx.look.role.run
  return (
    <Box key={`${o.key}-chip`} borderStyle="round" borderColor={run.line} backgroundColor={o.isOn === true ? run.line : run.tint} flexShrink={0}>
      <Button key={o.key} plain onPress={() => o.onPress()}><Text color={run.fg}>{o.label}</Text></Button>
    </Box>
  )
}

function Chips(ctx: Ctx, room: RoomView): RenderElement {
  const { Box } = ctx.ui
  const types = supportedSpecs().filter(s => CHIP_TYPES.includes(s.type))
  const label = textPiece('Agent\'ına sor', { size: 11.5, paint: 'lo' })
  return (
    <Box key="chips" flexDirection="row" alignItems="center" gap={1} flexWrap="wrap">
      {Pic(ctx, rowPart({ width: label.width, height: 18, left: [label], alt: 'Agent\'ına sor' }), 'chips-label')}
      {types.map(s => Chip(ctx, { key: `ask-${s.type}`, label: s.type, onPress: () => ctx.on.askAgent(room.id, s.type) }))}
      {Chip(ctx, { key: `ask-more-${room.id}`, label: ctx.model.isSheetOpen ? 'Kapat' : 'Daha fazla', isOn: ctx.model.isSheetOpen, onPress: () => ctx.on.toggleSheet(room.id) })}
    </Box>
  )
}

function Cell(ctx: Ctx, o: { room: RoomView; spec: QuerySpec; cellPx: number }): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const isOn = ctx.model.composeMode === o.spec.type
  const desc = rowPart({ width: o.cellPx, height: 16, left: [textPiece(o.spec.desc, { size: 11.5, paint: isOn ? 'mid' : 'lo', max: o.cellPx })], alt: o.spec.desc })
  return (
    <Box key={`cell-${o.spec.type}`} flexDirection="column" alignItems="flex-start" width="50%" paddingX={1} backgroundColor={isOn ? ctx.look.role.run.tint : undefined}>
      <Button key={`sheet-${o.spec.type}`} plain onPress={() => ctx.on.askAgent(o.room.id, o.spec.type)}>
        <Text color={ctx.look.role.run.fg}>{`${o.spec.type}${isModeType(o.spec.type) ? ' …' : ''}`}</Text>
      </Button>
      {Pic(ctx, desc)}
    </Box>
  )
}

function AskRow(ctx: Ctx, o: { room: RoomView; spec: QuerySpec; width: number }): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const desc = rowPart({ width: o.width - 120, height: 16, left: [textPiece(o.spec.desc, { size: 11.5, paint: 'lo', max: o.width - 120 })], alt: o.spec.desc })
  const limit = rowPart({ width: 70, height: 16, left: [], right: [textPiece('günde 10', { size: 11.5, paint: 'mid' })], alt: 'günde 10' })
  return (
    <Box key="ask-row" flexDirection="row" alignItems="center" gap={1} paddingX={1}>
      {Pic(ctx, { ...rowPart({ width: 16, height: 16, left: [glyphPiece('star', { size: 16, paint: 'warn', stroke: 1.5 })], alt: '' }), alt: 'ask' })}
      <Box flexDirection="column" alignItems="flex-start" flexGrow={1}>
        <Button key={`sheet-${ASK_TYPE}`} plain onPress={() => ctx.on.askAgent(o.room.id, ASK_TYPE)}><Text color={ctx.look.role.warn.fg}>ask …</Text></Button>
        {Pic(ctx, desc)}
      </Box>
      {Pic(ctx, limit)}
    </Box>
  )
}

// ALPEREN'İN AGENT'INA SOR ··· 12 hazır sorgu · 0 token, the grid, then `ask …` apart.
function Sheet(ctx: Ctx, room: RoomView): RenderElement | null {
  const { Box } = ctx.ui
  if (!ctx.model.isSheetOpen) return null
  const specs = supportedSpecs()
  const typed = specs.filter(s => s.type !== ASK_TYPE)
  const ask = specs.find(s => s.type === ASK_TYPE)
  const width = ctx.px - SHEET_CHROME_PX
  const title = `${room.peerName === undefined ? 'Karşı tarafın' : genitive(room.peerName)} agent'ına sor`
  return (
    <Box key="sheet" flexDirection="column" gap={1} borderStyle="round" borderColor={ctx.look.lineStrong} backgroundColor={ctx.look.card} paddingX={1} paddingY={1}>
      <Box paddingX={1}>{Pic(ctx, sheetHeadPart({ width: width - 2 * PX_PER_CELL, title, meta: `${typed.length} hazır sorgu · 0 token` }), 'sheet-head')}</Box>
      <Box flexDirection="row" flexWrap="wrap" rowGap={1}>{typed.map(spec => Cell(ctx, { room, spec, cellPx: width / 2 - 2 * PX_PER_CELL }))}</Box>
      {ask === undefined ? null : Pic(ctx, rulePart(width), 'sheet-rule')}
      {ask === undefined ? null : AskRow(ctx, { room, spec: ask, width })}
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

function HintRow(ctx: Ctx, room: RoomView): RenderElement {
  const hint = ctx.model.hint
  const words = hintOf(ctx, room)
  const part = hint !== null
    ? rowPart({ width: ctx.px, height: 16, left: [textPiece(hint, { size: 11.5, paint: 'warn', max: ctx.px })], alt: hint })
    : rowPart({ width: ctx.px, height: 16, left: [textPiece(words.left, { size: 11.5, paint: 'lo' })], right: [textPiece(words.right, { size: 11.5, paint: 'lo', isMono: room.kind === 'project' })], alt: `${words.left} · ${words.right}` })
  return Pic(ctx, part, 'hint')
}

export function Composer(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Text } = ctx.ui
  if (!('Input' in ctx.ui)) return <Text key="read-only" color={ctx.look.lo} wrap="wrap">{`Bu yüzeyde yalnızca okunur. Yazmak için odanın sayfasını aç: ${room.url}`}</Text>
  const { Input, Button } = ctx.ui
  const isProject = room.kind === 'project'
  const mode = ctx.model.composeMode
  return (
    <Box key="composer" flexDirection="column" gap={1}>
      {isProject ? Sheet(ctx, room) : null}
      {isProject ? Chips(ctx, room) : null}
      <Box key="field-row" flexDirection="row" alignItems="center" gap={1}>
        {ModeChip(ctx)}
        <Box flexGrow={1} flexDirection="column">
          <Input key={`composer-${room.id}-${ctx.model.composerKey}`} placeholder={placeholderOf(room, mode)} submitLabel={mode === null ? 'Gönder' : 'Sor'}
            autoFocus onInput={value => ctx.on.type(room.id, value)} onSubmit={value => ctx.on.send(room.id, value)} />
        </Box>
        <Button key={`send-${room.id}`} variant="primary" label={mode === null ? 'Gönder' : 'Sor'} onPress={() => ctx.on.sendTyped(room.id)} />
      </Box>
      {HintRow(ctx, room)}
    </Box>
  )
}
