// The `transceiver` pane: one view at a time when narrow (rooms → chat, "Yeni sohbet", "Ayarlar"), the rooms
// beside the chat when wide. Pure: register.tsx's render hook hands in the element table, the model and the
// handlers.
import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { PaneHandlers } from './actions'
import { ChatView } from './pane-chat'
import { AddView, SettingsView } from './pane-forms'
import { Head, Meta, pxOf, type Ctx } from './pane-kit'
import { RoomsColumn } from './pane-list'
import type { PaneModel } from './state-types'
import { lookOf } from './theme'

// From this many cells the rooms stay beside the chat; the rooms column takes LIST_COLUMNS of them.
export const WIDE_COLUMNS = 104
const LIST_COLUMNS = 38
const COLUMN_GAP = 3
const MIN_COLUMNS = 24
// With no rooms yet there is nothing to put beside a chat: one column, no wider than reads well.
const SINGLE_MAX_COLUMNS = 72

export type DrawOpts = {
  surface: RenderSurface
  columns: number
  isLight: boolean
  model: PaneModel
  on: PaneHandlers
}

function MainView(ctx: Ctx): RenderElement | null {
  const view = ctx.model.view
  if (view === 'add') return AddView(ctx)
  if (view === 'settings') return SettingsView(ctx)
  if (view === 'chat') return ChatView(ctx)
  return null
}

// With nothing picked, the wide right side says what to do rather than stand empty.
function Placeholder(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  return (
    <Box key="placeholder" flexDirection="column" gap={1} paddingTop={2}>
      {Head(ctx, {
        glyph: 'radio', tone: 'signal', eyebrow: 'Kanal açık', headline: 'Bir sohbet seç',
        sub: 'Soldan bir odaya gir; mesajlar anında burada akar.', width: pxOf(ctx.columns),
      })}
    </Box>
  )
}

function Wide(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  const left = { ...ctx, columns: LIST_COLUMNS, px: pxOf(LIST_COLUMNS) }
  const rightColumns = Math.max(MIN_COLUMNS, ctx.columns - LIST_COLUMNS - COLUMN_GAP)
  const right = { ...ctx, columns: rightColumns, px: pxOf(rightColumns) }
  return (
    <Box flexDirection="row" gap={COLUMN_GAP}>
      <Box flexDirection="column" width={LIST_COLUMNS} flexShrink={0}>{RoomsColumn(left)}</Box>
      <Box flexDirection="column" flexGrow={1}>{MainView(right) ?? Placeholder(right)}</Box>
    </Box>
  )
}

export function drawPane(ui: ElementTable, o: DrawOpts): RenderElement {
  const hasRooms = o.model.rooms.length > 0 || o.model.invites.length > 0
  const columns = Math.max(MIN_COLUMNS, hasRooms ? o.columns : Math.min(o.columns, SINGLE_MAX_COLUMNS))
  const isWide = columns >= WIDE_COLUMNS
  const look = lookOf({ isText: o.surface === 'terminal' || !('Svg' in ui), isLight: o.isLight })
  const ctx: Ctx = { ui, surface: o.surface, look, columns, px: pxOf(columns), isWide, model: o.model, on: o.on }
  const { Box } = ui
  const body = isWide ? Wide(ctx) : MainView(ctx) ?? RoomsColumn(ctx)
  return (
    <Box flexDirection="column" gap={1} width={columns}>
      {body}
      {o.surface === 'mobile' ? Meta(ctx, 'Telefonda yalnızca okunur; yazmak için odanın sayfasını aç.', 'mobile-note') : null}
    </Box>
  )
}
