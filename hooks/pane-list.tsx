// The rooms rail: the brand head with "+", the cards, the rooms under PROJELER and KİŞİLER (face, name, time, a
// second line with its receipt or the gate's dot, the unread badge, the open room tinted), and the connection
// footer with "Ayarlar". The terminal draws the same rail as lines.
import type { RenderElement } from 'claude-code'

import { POLL_OPEN_MS } from './limits'
import { Cards, EmptyCard } from './pane-cards'
import { IconButton, isText, Pic, PX_PER_CELL, receiptTone, roomFace, ticksOf, type Ctx } from './pane-kit'
import { projectLine } from './pane-words'
import { badgePart } from './sig'
import { brandPart, footerPart, previewPart, sectionPart } from './sig-rail'
import type { RoomView } from './state-types'
import { rowTime, secondsText } from './when'

const FACE = 36
const FACE_CELLS = 5
const PLUS_CELLS = 5
// A row's padding and the badge beside its second line.
const ROW_CHROME_CELLS = 2
const BADGE_CELLS = 4

const GATE_DOT: Record<RoomView['gate'], string> = { open: 'ok', closed: 'line-strong', unknown: 'warn' }

// A project's branch, a DM nobody joined yet, any other room.
function rowGlyph(room: RoomView): string {
  if (room.kind === 'project') return '⌥'
  return room.isWaiting ? '◷' : '●'
}

function previewOf(ctx: Ctx, room: RoomView, width: number) {
  if (room.isTroubled) return previewPart({ width, text: 'bağlantı sorunu · yeniden deneniyor', isUnread: false, paint: 'warn' })
  if (room.kind === 'project') return previewPart({ width, text: projectLine(room), isUnread: false, paint: room.gate === 'open' ? 'mid' : 'lo', dot: GATE_DOT[room.gate] })
  if (room.lastText === '') {
    return previewPart({ width, text: room.isWaiting ? 'Arkadaşın kabul edince burada yazışırsınız' : 'Henüz mesaj yok', isUnread: false })
  }
  return previewPart({ width, text: room.lastText, isUnread: room.unread > 0, ticks: room.lastIsMine ? ticksOf(room.lastReceipt) : undefined })
}

function TextRow(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const tick = room.lastReceipt === undefined || !room.lastIsMine ? null : receiptTone(ctx, room.lastReceipt)
  const glyph = rowGlyph(room)
  return (
    <Box key={`row-${room.id}`} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={room.kind === 'project' ? ctx.look.role.run.fg : ctx.look.lo}>{glyph}</Text>
        <Button key={`open-${room.id}`} label={room.title} plain onPress={() => ctx.on.select(room.id)} />
        <Box flexGrow={1} />
        {room.unread > 0 ? <Text color={ctx.look.signal.fg} bold>{`(${room.unread})`}</Text> : null}
        <Text color={ctx.look.lo}>{rowTime(room.lastTs, ctx.model.now)}</Text>
      </Box>
      <Text color={ctx.look.lo} wrap="truncate-end">{`  ${tick === null ? '' : `${tick.glyph} `}${room.kind === 'project' ? projectLine(room) : room.lastText}`}</Text>
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
          {Pic(ctx, previewOf(ctx, room, width), `preview-${room.id}`)}
          {hasUnread ? Pic(ctx, badgePart(room.unread), `badge-${room.id}`) : null}
        </Box>
      </Box>
    </Box>
  )
}

function Brand(ctx: Ctx): RenderElement {
  const { Box, Text } = ctx.ui
  const hasRooms = ctx.model.rooms.length > 0
  const plus = hasRooms ? IconButton(ctx, { key: 'open-add', label: '+', onPress: () => ctx.on.openView('add') }) : null
  const brand = isText(ctx)
    ? <Text key="brand" color={ctx.look.signal.fg} bold>((·)) TRANSCEIVER  <Text color={ctx.look.hi}>Sohbetler</Text></Text>
    : Pic(ctx, brandPart({ width: (ctx.columns - (hasRooms ? PLUS_CELLS : 0)) * PX_PER_CELL, title: 'Sohbetler' }), 'brand')
  return <Box key="list-head" flexDirection="row" alignItems="center" gap={1}>{brand}<Box flexGrow={1} />{plus}</Box>
}

function Section(ctx: Ctx, o: { key: string; title: string; rooms: RoomView[] }): RenderElement | null {
  const { Box, Text } = ctx.ui
  if (o.rooms.length === 0) return null
  const label = isText(ctx) ? <Text key={`${o.key}-label`} color={ctx.look.lo} bold>{o.title.toLocaleUpperCase('tr')}</Text> : Pic(ctx, sectionPart({ width: ctx.px, text: o.title }), `${o.key}-label`)
  return (
    <Box key={o.key} flexDirection="column" gap={isText(ctx) ? 0 : 1}>
      {label}
      {o.rooms.map(room => RoomRow(ctx, room))}
    </Box>
  )
}

// ● Bağlı · yoklama 1 sn ··· Ayarlar
function Footer(ctx: Ctx): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const m = ctx.model
  const text = m.busy ?? (m.isConnected ? `Bağlı · yoklama ${secondsText(POLL_OPEN_MS).replace(',0', '')}` : 'bağlantı bekleniyor')
  const paint = m.isConnected ? 'signal' : 'warn'
  const line = isText(ctx)
    ? <Text key="footer-text" color={m.isConnected ? ctx.look.signal.fg : ctx.look.role.warn.fg}>{`● ${text}`}</Text>
    : Pic(ctx, footerPart({ width: (ctx.columns - 10) * PX_PER_CELL, text, paint }), 'footer')
  return (
    <Box key="footer" flexDirection="row" alignItems="center" gap={1}>
      {line}
      <Box flexGrow={1} />
      <Button key="open-settings" label="Ayarlar" plain onPress={() => ctx.on.openView('settings')} />
    </Box>
  )
}

export function RoomsColumn(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  const rooms = ctx.model.rooms
  if (rooms.length === 0) {
    return <Box key="rooms" flexDirection="column" gap={1}>{Cards(ctx)}{EmptyCard(ctx)}</Box>
  }
  return (
    <Box key="rooms" flexDirection="column" gap={1} flexGrow={1}>
      {Brand(ctx)}
      {Cards(ctx)}
      {Section(ctx, { key: 'projects', title: 'Projeler', rooms: rooms.filter(r => r.kind === 'project') })}
      {Section(ctx, { key: 'people', title: 'Kişiler', rooms: rooms.filter(r => r.kind === 'dm') })}
      <Box flexGrow={1} />
      {Footer(ctx)}
    </Box>
  )
}
