// The rooms: a title with "+ New", the cards, then one list newest first (face, name, time, the last line with
// its receipt, the unread badge, the open room tinted). PROJECTS and PEOPLE head it only when both kinds are there.
// The foot holds "Settings", and a status only when something is wrong. The terminal draws the same as lines.
import type { RenderElement } from 'claude-code'

import { waitingText } from './connection'
import { upper } from './kit/lang'
import { Cards } from './pane-cards'
import { EmptyView } from './pane-empty'
import { isText, Pic, receiptTone, roomFace, type Ctx } from './pane-kit'
import { BetaTag, Title } from './pane-type'
import type { RoomView } from './state-types'
import { rowTime } from './when'
import { paneWords } from './words-pane'

const FACE = 36

// What a row's face and padding take, and its unread badge: the second line is cut to the rest, so it never wraps.
const ROW_CHROME_CELLS = 8
const BADGE_CELLS = 4

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`)

// A project's branch, a DM nobody joined yet, any other room.
function rowGlyph(room: RoomView): string {
  if (room.kind === 'project') return '⌥'
  return room.isWaiting ? '◷' : '●'
}

// A row's second line: what is wrong with the room, else its last message (or why there is none yet).
function lineOf(room: RoomView): { text: string; isWarn: boolean } {
  const w = paneWords()
  if (room.isTroubled) return { text: w.troubled, isWarn: true }
  if (room.isBoxBlocked) return { text: w.boxBlocked, isWarn: true }
  if (room.lastText !== '') return { text: room.lastText, isWarn: false }
  return { text: room.isWaiting ? w.acceptsSoon : w.noMessages, isWarn: false }
}

const hasTicks = (room: RoomView): boolean => room.lastIsMine && room.lastText !== '' && !room.isTroubled && !room.isBoxBlocked

// What is wrong in amber; an unread last message bright; any other dim.
function secondColor(ctx: Ctx, o: { room: RoomView; isWarn: boolean }): string | undefined {
  if (o.isWarn) return ctx.look.role.warn.fg
  return o.room.unread > 0 ? ctx.look.hi : ctx.look.lo
}

// The second line as text: its receipt, then what is wrong or the last message, cut to one line.
function SecondLine(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Text } = ctx.ui
  const tick = room.lastReceipt === undefined || !hasTicks(room) ? null : receiptTone(ctx, room.lastReceipt)
  const line = lineOf(room)
  return (
    <Box key="second" flexDirection="row" gap={1} flexGrow={1} flexShrink={1}>
      {tick === null ? null : <Text color={tick.color}>{tick.glyph}</Text>}
      <Box flexGrow={1} flexShrink={1}><Text color={secondColor(ctx, { room, isWarn: line.isWarn })} wrap="truncate-end">{clip(line.text, ctx.columns - ROW_CHROME_CELLS - (room.unread > 0 ? BADGE_CELLS : 0))}</Text></Box>
    </Box>
  )
}

function TextRow(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  return (
    <Box key={`row-${room.id}`} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={room.kind === 'project' ? ctx.look.role.run.fg : ctx.look.lo}>{rowGlyph(room)}</Text>
        <Button key={`open-${room.id}`} label={room.title} plain onPress={() => ctx.on.select(room.id)} />
        <Box flexGrow={1} />
        {room.unread > 0 ? <Text color={ctx.look.signal.fg} bold>{`(${room.unread})`}</Text> : null}
        <Text color={ctx.look.lo}>{rowTime(room.lastTs, ctx.model.now)}</Text>
      </Box>
      <Box paddingLeft={2}>{SecondLine(ctx, room)}</Box>
    </Box>
  )
}

// The unread count on the signal colour, as Text so the host draws it in Claude's theme.
function Badge(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Text } = ctx.ui
  return <Box key={`badge-${room.id}`} backgroundColor={ctx.look.signal.fg} paddingX={1} flexShrink={0}><Text color={ctx.look.sheet} bold>{String(room.unread)}</Text></Box>
}

export function RoomRow(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  if (isText(ctx)) return TextRow(ctx, room)
  const isActive = room.id === ctx.model.activeId && ctx.model.view === 'chat'
  const hasUnread = room.unread > 0
  const face = roomFace(room, { size: FACE, now: ctx.model.now, isMuted: room.kind === 'project' && room.gate === 'closed' })
  return (
    <Box key={`row-${room.id}`} flexDirection="row" gap={1} alignItems="center" paddingX={1} backgroundColor={isActive ? ctx.look.card : undefined}>
      {Pic(ctx, face, `av-${room.id}`)}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Button key={`open-${room.id}`} label={room.kind === 'project' ? room.repo?.split('/')[1] ?? room.title : room.title} plain onPress={() => ctx.on.select(room.id)} />
          <Text color={hasUnread ? ctx.look.signal.fg : ctx.look.lo} bold={hasUnread}>{rowTime(room.lastTs, ctx.model.now)}</Text>
        </Box>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          {SecondLine(ctx, room)}
          {hasUnread ? Badge(ctx, room) : null}
        </Box>
      </Box>
    </Box>
  )
}

function Top(ctx: Ctx): RenderElement {
  const { Box, Button } = ctx.ui
  return (
    <Box key="list-head" flexDirection="row" alignItems="center" gap={1}>
      {Title(ctx, { key: 'list-title', text: paneWords().chats })}
      {BetaTag(ctx, 'list-beta')}
      <Box flexGrow={1} />
      <Button key="open-add" label={paneWords().newRoom} plain onPress={() => ctx.on.openView('add')} />
    </Box>
  )
}

function Section(ctx: Ctx, o: { key: string; title: string | null; rooms: RoomView[] }): RenderElement | null {
  const { Box, Text } = ctx.ui
  if (o.rooms.length === 0) return null
  const label = <Text key={`${o.key}-label`} color={ctx.look.lo} bold>{o.title === null ? '' : upper(o.title)}</Text>
  return (
    <Box key={o.key} flexDirection="column" gap={isText(ctx) ? 0 : 1}>
      {o.title === null ? null : label}
      {o.rooms.map(room => RoomRow(ctx, room))}
    </Box>
  )
}

// Only what is wrong or under way: a step in flight, or a session that may not write while its card is gone.
function statusOf(ctx: Ctx): { text: string; paint: 'signal' | 'warn' } | null {
  const m = ctx.model
  if (m.busy !== null) return { text: m.busy, paint: 'signal' }
  return m.isConnected || m.needsSetup ? null : { text: waitingText(), paint: 'warn' }
}

function Foot(ctx: Ctx): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const status = statusOf(ctx)
  const color = status?.paint === 'warn' ? ctx.look.role.warn.fg : ctx.look.signal.fg
  const line = <Text key="foot-status" color={color}>{`● ${status?.text}`}</Text>
  return (
    <Box key="foot" flexDirection="row" alignItems="center" gap={1}>
      {status === null ? null : line}
      <Box flexGrow={1} />
      <Button key="open-settings" label={paneWords().settings} plain dimColor onPress={() => ctx.on.openView('settings')} />
    </Box>
  )
}

export function RoomsColumn(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  const rooms = ctx.model.rooms
  if (rooms.length === 0) return <Box key="rooms" flexDirection="column" gap={1}>{Cards(ctx)}{EmptyView(ctx)}</Box>
  const projects = rooms.filter(r => r.kind === 'project')
  const people = rooms.filter(r => r.kind === 'dm')
  const isMixed = projects.length > 0 && people.length > 0
  return (
    <Box key="rooms" flexDirection="column" gap={1} flexGrow={1}>
      {Top(ctx)}
      {Cards(ctx)}
      {isMixed ? Section(ctx, { key: 'projects', title: paneWords().projects, rooms: projects }) : null}
      {Section(ctx, isMixed ? { key: 'people', title: paneWords().people, rooms: people } : { key: 'all', title: null, rooms })}
      <Box flexGrow={1} />
      {Foot(ctx)}
    </Box>
  )
}
