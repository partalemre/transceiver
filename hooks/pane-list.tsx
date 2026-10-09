// The rooms: a title with "+ Yeni", the cards, then one list newest first (face, name, time, the last line with
// its receipt, the unread badge, the open room tinted). PROJELER and KİŞİLER head it only when both kinds are there.
// The foot holds "Ayarlar", and a status only when something is wrong. The terminal draws the same as lines.
import type { RenderElement } from 'claude-code'

import { Cards } from './pane-cards'
import { EmptyView } from './pane-empty'
import { isText, Pic, PX_PER_CELL, receiptTone, roomFace, ticksOf, type Ctx } from './pane-kit'
import { Title } from './pane-type'
import { badgePart } from './sig'
import { previewPart, sectionPart, statusPart } from './sig-rail'
import type { RoomView } from './state-types'
import { rowTime } from './when'

const FACE = 36
const FACE_CELLS = 5
const NEW_CELLS = 9
const FOOT_CELLS = 10
// A row's padding and the badge beside its second line.
const ROW_CHROME_CELLS = 2
const BADGE_CELLS = 4

const BOX_BLOCKED = 'kutusu henüz seninle paylaşılmadı'
const TROUBLED = 'bağlantı sorunu · yeniden deneniyor'

// A project's branch, a DM nobody joined yet, any other room.
function rowGlyph(room: RoomView): string {
  if (room.kind === 'project') return '⌥'
  return room.isWaiting ? '◷' : '●'
}

// A row's second line: what is wrong with the room, else its last message (or why there is none yet).
function lineOf(room: RoomView): { text: string; isWarn: boolean } {
  if (room.isTroubled) return { text: TROUBLED, isWarn: true }
  if (room.isBoxBlocked) return { text: BOX_BLOCKED, isWarn: true }
  if (room.lastText !== '') return { text: room.lastText, isWarn: false }
  return { text: room.isWaiting ? 'Arkadaşın kabul edince burada yazışırsınız' : 'Henüz mesaj yok', isWarn: false }
}

const hasTicks = (room: RoomView): boolean => room.lastIsMine && room.lastText !== '' && !room.isTroubled && !room.isBoxBlocked

function previewOf(room: RoomView, width: number) {
  const line = lineOf(room)
  if (line.isWarn) return previewPart({ width, text: line.text, isUnread: false, paint: 'warn' })
  return previewPart({ width, text: line.text, isUnread: room.unread > 0, ticks: hasTicks(room) ? ticksOf(room.lastReceipt) : undefined })
}

function TextRow(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const tick = room.lastReceipt === undefined || !hasTicks(room) ? null : receiptTone(ctx, room.lastReceipt)
  const line = lineOf(room)
  return (
    <Box key={`row-${room.id}`} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={room.kind === 'project' ? ctx.look.role.run.fg : ctx.look.lo}>{rowGlyph(room)}</Text>
        <Button key={`open-${room.id}`} label={room.title} plain onPress={() => ctx.on.select(room.id)} />
        <Box flexGrow={1} />
        {room.unread > 0 ? <Text color={ctx.look.signal.fg} bold>{`(${room.unread})`}</Text> : null}
        <Text color={ctx.look.lo}>{rowTime(room.lastTs, ctx.model.now)}</Text>
      </Box>
      <Text color={line.isWarn ? ctx.look.role.warn.fg : ctx.look.lo} wrap="truncate-end">{`  ${tick === null ? '' : `${tick.glyph} `}${line.text}`}</Text>
    </Box>
  )
}

export function RoomRow(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  if (isText(ctx)) return TextRow(ctx, room)
  const isActive = room.id === ctx.model.activeId && ctx.model.view === 'chat'
  const hasUnread = room.unread > 0
  const width = (ctx.columns - FACE_CELLS - ROW_CHROME_CELLS - (hasUnread ? BADGE_CELLS : 0)) * PX_PER_CELL
  const face = roomFace(room, { size: FACE, now: ctx.model.now, isMuted: room.kind === 'project' && room.gate === 'closed' })
  return (
    <Box key={`row-${room.id}`} flexDirection="row" gap={1} alignItems="center" paddingX={1} backgroundColor={isActive ? ctx.look.card : undefined}>
      {Pic(ctx, face, `av-${room.id}`)}
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Button key={`open-${room.id}`} label={room.kind === 'project' ? room.repo?.split('/')[1] ?? room.title : room.title} plain onPress={() => ctx.on.select(room.id)} />
          <Text color={hasUnread ? ctx.look.signal.fg : ctx.look.lo} bold={hasUnread}>{rowTime(room.lastTs, ctx.model.now)}</Text>
        </Box>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          {Pic(ctx, previewOf(room, width), `preview-${room.id}`)}
          {hasUnread ? Pic(ctx, badgePart(room.unread), `badge-${room.id}`) : null}
        </Box>
      </Box>
    </Box>
  )
}

function Top(ctx: Ctx): RenderElement {
  const { Box, Button } = ctx.ui
  return (
    <Box key="list-head" flexDirection="row" alignItems="center" gap={1}>
      {Title(ctx, { key: 'list-title', text: 'Sohbetler', width: (ctx.columns - NEW_CELLS) * PX_PER_CELL })}
      <Box flexGrow={1} />
      <Button key="open-add" label="+ Yeni" plain onPress={() => ctx.on.openView('add')} />
    </Box>
  )
}

function Section(ctx: Ctx, o: { key: string; title: string | null; rooms: RoomView[] }): RenderElement | null {
  const { Box, Text } = ctx.ui
  if (o.rooms.length === 0) return null
  const label = isText(ctx)
    ? <Text key={`${o.key}-label`} color={ctx.look.lo} bold>{o.title?.toLocaleUpperCase('tr')}</Text>
    : Pic(ctx, sectionPart({ width: ctx.px, text: o.title ?? '' }), `${o.key}-label`)
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
  return m.isConnected || m.needsSetup ? null : { text: 'bağlantı bekleniyor', paint: 'warn' }
}

function Foot(ctx: Ctx): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const status = statusOf(ctx)
  const color = status?.paint === 'warn' ? ctx.look.role.warn.fg : ctx.look.signal.fg
  const line = isText(ctx)
    ? <Text key="foot-status" color={color}>{`● ${status?.text}`}</Text>
    : Pic(ctx, statusPart({ width: (ctx.columns - FOOT_CELLS) * PX_PER_CELL, text: status?.text ?? '', paint: status?.paint ?? 'lo' }), 'foot-status')
  return (
    <Box key="foot" flexDirection="row" alignItems="center" gap={1}>
      {status === null ? null : line}
      <Box flexGrow={1} />
      <Button key="open-settings" label="Ayarlar" plain dimColor onPress={() => ctx.on.openView('settings')} />
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
      {isMixed ? Section(ctx, { key: 'projects', title: 'Projeler', rooms: projects }) : null}
      {Section(ctx, isMixed ? { key: 'people', title: 'Kişiler', rooms: people } : { key: 'all', title: null, rooms })}
      <Box flexGrow={1} />
      {Foot(ctx)}
    </Box>
  )
}
