// The rooms column: the brand header, the cards, then one row per room (avatar, name, time, last message with
// its receipt, unread badge), or the empty state with the ways in.
import type { RenderElement } from 'claude-code'

import { ButtonRow } from './kit/ui'
import { Cards } from './pane-cards'
import { Avatar, BRAND, Frame, Head, innerPx, isText, kindOf, latencyText, pxOf, receiptTone, SvgOf, type Ctx } from './pane-kit'
import { badgePart, sigPic, stepsPart } from './sig'
import type { RoomView } from './state-types'
import { rowTime } from './when'

const AVATAR = 34
// What a row leaves for the preview: avatar, gaps, padding and the badge.
const ROW_CHROME = 12

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text)

function summary(ctx: Ctx): string {
  const rooms = ctx.model.rooms
  const unread = rooms.reduce((n, r) => n + r.unread, 0)
  if (rooms.length === 0) return 'Henüz oda yok'
  return unread > 0 ? `${rooms.length} oda · ${unread} okunmamış` : `${rooms.length} oda · hepsi okundu`
}

export function ListHead(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  const m = ctx.model
  const meta = m.busy ?? (m.isConnected || m.rooms.length === 0 ? latencyText(m.latencyMs) : 'bağlantı bekleniyor')
  const hasRooms = m.rooms.length > 0
  return (
    <Box key="list-head" flexDirection="column" gap={1}>
      {Head(ctx, { glyph: 'radio', tone: 'signal', eyebrow: BRAND, meta, headline: 'Sohbetler', sub: summary(ctx), width: pxOf(ctx.columns) })}
      {hasRooms
        ? ButtonRow(ctx.ui, ctx.surface, ctx.look.isLight, {
            buttons: [
              { key: 'open-add', label: 'Yeni sohbet', variant: 'secondary', onPress: () => ctx.on.openView('add') },
              { key: 'open-settings', label: 'Ayarlar', variant: 'plain', onPress: () => ctx.on.openView('settings') },
            ],
          })
        : null}
    </Box>
  )
}

function Preview(ctx: Ctx, room: RoomView): RenderElement {
  const { Text } = ctx.ui
  if (room.isTroubled) return <Text color={ctx.look.role.warn.fg} wrap="truncate-end">bağlantı sorunu · yeniden deneniyor</Text>
  if (room.lastText === '') {
    const hint = room.isWaiting ? 'Arkadaşın kabul edince burada yazışırsınız' : room.kind === 'project' ? 'Henüz mesaj yok · ilk soruyu sor' : 'Henüz mesaj yok'
    return <Text color={ctx.look.lo} italic wrap="truncate-end">{hint}</Text>
  }
  const tick = room.lastReceipt === undefined ? null : receiptTone(ctx, room.lastReceipt)
  return (
    <Text color={room.unread > 0 ? ctx.look.mid : ctx.look.lo} wrap="truncate-end">
      {tick === null ? null : <Text color={tick.color}>{`${tick.glyph} `}</Text>}
      {clip(room.lastText, ctx.columns - ROW_CHROME - (tick === null ? 0 : tick.glyph.length + 1))}
    </Text>
  )
}

function Unread(ctx: Ctx, room: RoomView): RenderElement | null {
  const { Text } = ctx.ui
  if (room.unread === 0) return null
  if (isText(ctx)) return <Text color={ctx.look.signal.fg} bold>{`(${room.unread})`}</Text>
  return SvgOf(ctx, sigPic(badgePart(room.unread)), `badge-${room.id}`)
}

export function RoomRow(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const isActive = room.id === ctx.model.activeId && ctx.model.view === 'chat'
  const hasUnread = room.unread > 0
  return (
    <Box key={`row-${room.id}`} flexDirection="row" gap={1} alignItems="center" paddingX={1}
      backgroundColor={isActive ? ctx.look.signal.tint : undefined}>
      {Avatar(ctx, { name: room.title, seed: room.seed, size: AVATAR, kind: kindOf(room), key: `av-${room.id}` })}
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Button key={`open-${room.id}`} plain onPress={() => ctx.on.select(room.id)}>
            <Text bold color={ctx.look.hi}>{room.title}</Text>
          </Button>
          <Text color={hasUnread ? ctx.look.signal.fg : ctx.look.lo}>{rowTime(room.lastTs, ctx.model.now)}</Text>
        </Box>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          {Preview(ctx, room)}
          {Unread(ctx, room)}
        </Box>
      </Box>
    </Box>
  )
}

const STEPS = [
  { title: 'Arkadaşını ekle', sub: 'Senin için bir oda açılır, adresi claude.ai\'de.' },
  { title: 'Linki paylaş', sub: 'Paylaş menüsünden e-postasıyla davet et.' },
  { title: 'Yazış', sub: 'Mesajlar anında burada; taşıma token harcamaz.' },
]

function Steps(ctx: Ctx): RenderElement {
  const { Box, Text } = ctx.ui
  if (!isText(ctx)) return SvgOf(ctx, sigPic(stepsPart({ steps: STEPS, width: innerPx(ctx.columns) })), 'steps') ?? <Box />
  return (
    <Box key="steps" flexDirection="column">
      {STEPS.map((s, i) => <Text key={`step-${i}`}><Text color={ctx.look.signal.fg} bold>{`${i + 1} `}</Text><Text bold>{s.title}</Text><Text color={ctx.look.lo}>{` · ${s.sub}`}</Text></Text>)}
    </Box>
  )
}

export function EmptyRooms(ctx: Ctx): RenderElement {
  const hasInput = 'Input' in ctx.ui
  return Frame(ctx, {
    key: 'empty', tone: 'signal',
    children: [
      Head(ctx, {
        glyph: 'radio', tone: 'signal', eyebrow: 'Başla', headline: 'Telsizini aç',
        sub: 'Arkadaşlarınla Claude\'un içinden yazış. Ortak bir GitHub reposunda agent\'larınız da konuşabilir.',
      }),
      Steps(ctx),
      ButtonRow(ctx.ui, ctx.surface, ctx.look.isLight, {
        buttons: [
          { key: 'add-dm', label: 'Arkadaş ekle', variant: 'primary', onPress: () => ctx.on.addDm() },
          ...(hasInput ? [{ key: 'open-add', label: 'Proje ya da link', variant: 'secondary' as const, onPress: () => ctx.on.openView('add') }] : []),
        ],
      }),
    ],
  })
}

export function RoomsColumn(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  const rooms = ctx.model.rooms
  return (
    <Box key="rooms" flexDirection="column" gap={1}>
      {ListHead(ctx)}
      {Cards(ctx)}
      {rooms.length === 0
        ? EmptyRooms(ctx)
        : <Box key="room-list" flexDirection="column" gap={isText(ctx) ? 0 : 1}>{rooms.map(room => RoomRow(ctx, room))}</Box>}
    </Box>
  )
}
