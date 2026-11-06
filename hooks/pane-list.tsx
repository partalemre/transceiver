// The rooms: a title with "+ New", the cards, then one list newest first (face, name, time, the last line with
// its receipt, the unread badge, the open room tinted). PROJECTS and PEOPLE head it only when both kinds are there.
// The foot holds "Settings", and a status only when something is wrong. The terminal draws the same as lines.
import type { RenderElement } from 'claude-code'

import { waitingText } from './connection'
import { Cards } from './pane-cards'
import { EmptyView } from './pane-empty'
import { paneHead } from './kit/pane-head'
import { PressRow } from './kit/press'
import { BridgeCard } from './pane-bridge'
import { glyphOf, isText, receiptTone, SvgOf, type Ctx } from './pane-kit'
import { Title } from './pane-type'
import { roomRowPic, themed } from './sig-rows'
import type { RoomView } from './state-types'
import { rowTime } from './when'
import { paneWords } from './words-pane'

// What a row's face and padding take, and its unread badge: the second line is cut to the rest, so it never wraps.
const ROW_CHROME_CELLS = 8
const BADGE_CELLS = 4

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`)

// A project's branch, a DM nobody joined yet, any other room.
function rowGlyph(room: RoomView): string {
  if (room.kind === 'project') return '⌥'
  if (room.kind === 'devices') return '⇄'
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

const shortName = (room: RoomView): string => (room.kind === 'project' ? room.repo?.split('/')[1] ?? room.title : room.title)

// A room on the desktop is one pressed line (kit/press.tsx): its mark, name, last line, time and unread count. The open
// room sits on the card colour.
export function RoomRow(ctx: Ctx, room: RoomView): RenderElement {
  const { Box } = ctx.ui
  if (isText(ctx)) return TextRow(ctx, room)
  const line = lineOf(room)
  const pic = roomRowPic({
    width: ctx.px, glyph: glyphOf(room), name: shortName(room), preview: line.text, time: rowTime(room.lastTs, ctx.model.now),
    unread: room.unread, isWarn: line.isWarn, isLight: ctx.look.isLight,
  })
  const isActive = room.id === ctx.model.activeId && ctx.model.view === 'chat'
  const drawing = SvgOf(ctx, pic, `row-pic-${room.id}`)
  if (drawing === null) return TextRow(ctx, room)
  return (
    <Box key={`row-${room.id}`} backgroundColor={isActive ? ctx.look.card : undefined}>
      {PressRow(ctx.ui, { box: `press-${room.id}`, key: `open-${room.id}`, drawing, onPress: () => ctx.on.select(room.id) })}
    </Box>
  )
}

// The pane's head, as every mod pane opens (kit/pane-head.ts): the row pressed on the hub, grown.
function Top(ctx: Ctx): RenderElement {
  const { Text } = ctx.ui
  const unread = ctx.model.rooms.reduce((n, r) => n + r.unread, 0)
  const meta = [unread > 0 ? paneWords().unreadMeta(unread) : '', paneWords().beta].filter(Boolean).join(' · ')
  if (isText(ctx)) return Title(ctx, { key: 'list-title', text: `Transceiver · ${meta}` })
  const pic = paneHead({ glyph: 'bell', title: 'Transceiver', meta, tone: unread > 0 ? 'live' : 'idle', width: ctx.px })
  return SvgOf(ctx, themed(pic, ctx.look.isLight), 'list-head') ?? <Text key="list-head">Transceiver</Text>
}

function Section(ctx: Ctx, o: { key: string; title: string | null; rooms: RoomView[] }): RenderElement | null {
  const { Box, Text } = ctx.ui
  if (o.rooms.length === 0) return null
  const label = <Text key={`${o.key}-label`} color={ctx.look.lo} bold>{o.title ?? ''}</Text>
  return (
    <Box key={o.key} flexDirection="column" gap={0}>
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
      <Button key="open-add" label={paneWords().newRoom} plain dimColor onPress={() => ctx.on.openView('add')} />
      <Button key="open-settings" label={paneWords().settings} plain dimColor onPress={() => ctx.on.openView('settings')} />
    </Box>
  )
}

export function RoomsColumn(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  const rooms = ctx.model.rooms
  if (rooms.length === 0) return <Box key="rooms" flexDirection="column" gap={1}>{Top(ctx)}{Cards(ctx)}{EmptyView(ctx)}</Box>
  const projects = rooms.filter(r => r.kind === 'project')
  const people = rooms.filter(r => r.kind === 'dm')
  const devices = rooms.filter(r => r.kind === 'devices')
  const isMixed = projects.length > 0 && people.length > 0
  return (
    <Box key="rooms" flexDirection="column" gap={1} flexGrow={1}>
      {Top(ctx)}
      {Cards(ctx)}
      {BridgeCard(ctx)}
      {Section(ctx, { key: 'devices', title: null, rooms: devices })}
      {isMixed ? Section(ctx, { key: 'projects', title: paneWords().projects, rooms: projects }) : null}
      {isMixed ? Section(ctx, { key: 'people', title: paneWords().people, rooms: people }) : Section(ctx, { key: 'all', title: null, rooms: [...projects, ...people] })}
      <Box flexGrow={1} />
      {Foot(ctx)}
    </Box>
  )
}
