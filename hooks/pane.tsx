// The `transceiver` pane: one view at a time when narrow (rooms → chat, "Yeni sohbet", "Ayarlar"); when wide the
// rooms rail and the chat, and a project room's details beside it once asked for. Pure:
// register.tsx's render hook hands in the element table, the model and the handlers.
import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { PaneHandlers } from './actions'
import { RoomInfo } from './pane-aside'
import { ChatView } from './pane-chat'
import { AddView, SettingsView } from './pane-forms'
import { Meta, pxOf, type Ctx } from './pane-kit'
import { RoomsColumn } from './pane-list'
import { Sentence, Title } from './pane-type'
import type { PaneModel } from './state-types'
import { lookOf } from './theme'

// From this many cells the rooms stay beside the chat.
export const WIDE_COLUMNS = 104
const RAIL_COLUMNS = 36
const ASIDE_COLUMNS = 33
const PAD = 2
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

// With nothing picked, the wide middle says what to do rather than stand empty.
function Placeholder(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  return (
    <Box key="placeholder" flexDirection="column" gap={1} paddingTop={2}>
      {Title(ctx, { key: 'placeholder-title', text: 'Bir sohbet seç' })}
      {Sentence(ctx, { key: 'placeholder-body', text: 'Soldaki listeden bir oda aç.', paint: 'lo' })}
    </Box>
  )
}

const sized = (ctx: Ctx, columns: number): Ctx => ({ ...ctx, columns, px: pxOf(columns) })

function Wide(ctx: Ctx, pad: number): RenderElement {
  const { Box } = ctx.ui
  const room = ctx.model.view === 'chat' ? ctx.model.rooms.find(r => r.id === ctx.model.activeId) : undefined
  const hasAside = room?.kind === 'project' && ctx.model.isInfoOpen
  const asideColumns = hasAside ? ASIDE_COLUMNS : 0
  const main = sized(ctx, Math.max(MIN_COLUMNS, ctx.columns - RAIL_COLUMNS - asideColumns - pad * 2 - (hasAside ? pad * 2 : 0)))
  const rail = sized(ctx, RAIL_COLUMNS - pad)
  return (
    <Box flexDirection="row" width={ctx.columns}>
      <Box key="rail" flexDirection="column" width={RAIL_COLUMNS} flexShrink={0} backgroundColor={ctx.look.inset} paddingX={pad / 2} paddingY={pad}>
        {RoomsColumn(rail)}
      </Box>
      <Box key="main" flexDirection="column" flexGrow={1} paddingX={pad} paddingY={pad / 2}>{MainView(main) ?? Placeholder(main)}</Box>
      {hasAside && room !== undefined
        ? <Box key="aside-col" flexDirection="column" width={ASIDE_COLUMNS} flexShrink={0} paddingX={pad} paddingY={pad}>{RoomInfo(sized(ctx, ASIDE_COLUMNS - pad * 2), room)}</Box>
        : null}
    </Box>
  )
}

export function drawPane(ui: ElementTable, o: DrawOpts): RenderElement {
  const hasRooms = o.model.rooms.length > 0 || o.model.invites.length > 0
  const columns = Math.max(MIN_COLUMNS, hasRooms ? o.columns : Math.min(o.columns, SINGLE_MAX_COLUMNS))
  const isText = o.surface === 'terminal' || !('Svg' in ui)
  const look = lookOf({ isText, isLight: o.isLight })
  const pad = isText ? 0 : PAD
  const isWide = columns >= WIDE_COLUMNS
  const ctx: Ctx = { ui, surface: o.surface, look, columns, px: pxOf(columns), isWide, model: o.model, on: o.on }
  const { Box } = ui
  if (isWide) return <Box flexDirection="column" width={columns} backgroundColor={look.sheet}>{Wide(ctx, pad)}</Box>
  const inner = sized(ctx, columns - pad * 2)
  return (
    <Box flexDirection="column" gap={1} width={columns} paddingX={pad} paddingY={pad / 2} backgroundColor={look.sheet}>
      {MainView(inner) ?? RoomsColumn(inner)}
      {o.surface === 'mobile' ? Meta(inner, 'Telefonda yalnızca okunur; yazmak için odanın sayfasını aç.', 'mobile-note') : null}
    </Box>
  )
}
