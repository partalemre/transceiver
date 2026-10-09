// The composer on the desktop: the field (a placeholder addressed to the room) and "Gönder". A project room adds
// one "Agent'a sor" button that opens the sheet of every query the protocol takes (two to a row, the free `ask`
// apart in Amber) and a removable mode chip once the field is set to one. A hint line shows only when it has
// something to say (an unknown command, a missing value).
import type { RenderElement } from 'claude-code'

import { Pic, PX_PER_CELL, type Ctx } from './pane-kit'
import { isModeType, specOf, supportedSpecs, type QuerySpec } from './query-menu'
import { sheetHeadPart } from './sig-agent'
import { glyphPiece, rowPart, rulePart, textPiece } from './sig-ui'
import type { RoomView } from './state-types'
import { dative, genitive } from './tr'

const SHEET_CHROME_PX = 2 * PX_PER_CELL + 2
const ASK_TYPE = 'ask'

export function placeholderOf(room: RoomView, mode: string | null): string {
  const arg = mode === null ? undefined : specOf(mode)?.arg
  if (arg !== undefined) return arg.placeholder
  if (room.kind === 'project') return 'Odaya yaz'
  return room.peerName === undefined ? 'Mesaj yaz' : `${dative(room.peerName)} yaz`
}

function AskButton(ctx: Ctx, room: RoomView): RenderElement {
  const { Button } = ctx.ui
  return <Button key={`ask-more-${room.id}`} label={ctx.model.isSheetOpen ? 'Kapat' : 'Agent\'a sor'} variant="secondary" onPress={() => ctx.on.toggleSheet(room.id)} />
}

function Cell(ctx: Ctx, o: { room: RoomView; spec: QuerySpec; cellPx: number }): RenderElement {
  const { Box, Button } = ctx.ui
  const isOn = ctx.model.composeMode === o.spec.type
  const desc = rowPart({ width: o.cellPx, height: 16, left: [textPiece(o.spec.desc, { size: 11.5, paint: isOn ? 'mid' : 'lo', max: o.cellPx })], alt: o.spec.desc })
  return (
    <Box key={`cell-${o.spec.type}`} flexDirection="column" alignItems="flex-start" width="50%" paddingX={1} backgroundColor={isOn ? ctx.look.role.run.tint : undefined}>
      <Button key={`sheet-${o.spec.type}`} label={`${o.spec.type}${isModeType(o.spec.type) ? ' …' : ''}`} plain onPress={() => ctx.on.askAgent(o.room.id, o.spec.type)} />
      {Pic(ctx, desc)}
    </Box>
  )
}

function AskRow(ctx: Ctx, o: { room: RoomView; spec: QuerySpec; width: number }): RenderElement {
  const { Box, Button } = ctx.ui
  const desc = rowPart({ width: o.width - 120, height: 16, left: [textPiece(o.spec.desc, { size: 11.5, paint: 'lo', max: o.width - 120 })], alt: o.spec.desc })
  const limit = rowPart({ width: 70, height: 16, left: [], right: [textPiece('günde 10', { size: 11.5, paint: 'mid' })], alt: 'günde 10' })
  return (
    <Box key="ask-row" flexDirection="row" alignItems="center" gap={1} paddingX={1}>
      {Pic(ctx, { ...rowPart({ width: 16, height: 16, left: [glyphPiece('star', { size: 16, paint: 'warn', stroke: 1.5 })], alt: '' }), alt: 'ask' })}
      <Box flexDirection="column" alignItems="flex-start" flexGrow={1}>
        <Button key={`sheet-${ASK_TYPE}`} label="ask …" plain onPress={() => ctx.on.askAgent(o.room.id, ASK_TYPE)} />
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

function HintRow(ctx: Ctx): RenderElement | null {
  const hint = ctx.model.hint
  if (hint === null) return null
  return Pic(ctx, rowPart({ width: ctx.px, height: 16, left: [textPiece(hint, { size: 11.5, paint: 'warn', max: ctx.px })], alt: hint }), 'hint')
}

export function Composer(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Text } = ctx.ui
  if (!('Input' in ctx.ui)) return <Text key="read-only" color={ctx.look.lo} wrap="wrap">{'Bu yüzeyde yalnızca okunur. Yazmak için Transceiver\'ı Claude Code\'da aç.'}</Text>
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
          <Input key={`composer-${room.id}-${ctx.model.composerKey}`} placeholder={placeholderOf(room, mode)} submitLabel={mode === null ? 'Gönder' : 'Sor'}
            autoFocus onInput={value => ctx.on.type(room.id, value)} onSubmit={value => ctx.on.send(room.id, value)} />
        </Box>
        <Button key={`send-${room.id}`} variant="primary" label={mode === null ? 'Gönder' : 'Sor'} onPress={() => ctx.on.sendTyped(room.id)} />
      </Box>
      {HintRow(ctx)}
    </Box>
  )
}
