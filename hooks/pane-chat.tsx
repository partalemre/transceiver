// One room: who it is with, the project's gate and live switch, the timeline with day dividers, and the composer
// (or why it cannot take text yet).
import type { RenderElement } from 'claude-code'

import { baseline, sans, TYPE, textEl } from './kit/svg-core'
import { fitText } from './kit/svg-metrics'
import { GROUP_MS, TIMELINE_LINES } from './limits'
import { Bubble } from './pane-bubble'
import { ErrorCard } from './pane-cards'
import { Avatar, isText, kindOf, Meta, Pill, pxOf, SvgOf, type Ctx } from './pane-kit'
import { avatarPart, dividerPart, sigPic, tilePart } from './sig'
import type { Line, RoomView } from './state-types'
import { avatarRole, initialsOf } from './theme'
import { dayKey, dayLabel } from './when'

const HEAD_AVATAR = 36
const HEAD_GAP = 12
const BACK_CELLS = 12

function subOf(room: RoomView): string {
  if (room.kind === 'project') return 'Proje odası'
  return room.isWaiting ? 'Arkadaşın daveti kabul edince başlar' : 'Doğrudan mesaj'
}

function headSvg(ctx: Ctx, room: RoomView, width: number): RenderElement | null {
  const role = room.isWaiting ? 'warn' : avatarRole(room.seed)
  const face = room.kind === 'project' || room.isWaiting
    ? tilePart({ glyph: room.isWaiting ? 'clock' : 'branch', paint: role, size: HEAD_AVATAR })
    : avatarPart({ initials: initialsOf(room.title), paint: role, size: HEAD_AVATAR })
  const x = HEAD_AVATAR + HEAD_GAP
  const w = width - x
  const title = fitText(room.title, w, sans(TYPE.title.size, TYPE.title.weight))
  const sub = fitText(subOf(room), w, sans(TYPE.label.size, TYPE.label.weight))
  const body = [
    face.body,
    textEl({ x, y: baseline(0, HEAD_AVATAR / 2 + 2, TYPE.title.size), text: title, paint: 'hi', ...TYPE.title }),
    textEl({ x, y: baseline(HEAD_AVATAR / 2, HEAD_AVATAR / 2, TYPE.label.size), text: sub, paint: 'lo', ...TYPE.label }),
  ]
  return SvgOf(ctx, sigPic({ body: body.join(''), width, height: HEAD_AVATAR, alt: `${room.title} — ${subOf(room)}` }), 'chat-head')
}

function ChatHead(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const back = ctx.isWide ? null : <Button key="back" label="‹ Odalar" plain onPress={() => ctx.on.back()} />
  const width = pxOf(ctx.columns - (back === null ? 0 : BACK_CELLS))
  const who = isText(ctx)
    ? <Box flexDirection="row" gap={1}>{Avatar(ctx, { name: room.title, seed: room.seed, size: HEAD_AVATAR, kind: kindOf(room) })}<Text bold>{room.title}</Text><Text color={ctx.look.lo}>{subOf(room)}</Text></Box>
    : headSvg(ctx, room, width)
  return <Box key="chat-head" flexDirection="row" alignItems="center" gap={1}>{back}{who}</Box>
}

// Agents of a project room talk only through a confirmed GitHub match; live mode wakes this session for them.
function ProjectBar(ctx: Ctx, room: RoomView): RenderElement | null {
  const { Box, Button } = ctx.ui
  if (room.kind !== 'project') return null
  const gate = room.gate === 'open'
    ? Pill(ctx, { text: `@${room.ghLogin ?? ''} · kapı açık`, tone: 'ok', key: 'gate' })
    : Pill(ctx, { text: 'kapı kapalı', key: 'gate' })
  const live = Pill(ctx, { text: room.isLive ? 'canlı açık' : 'canlı kapalı', tone: room.isLive ? 'run' : undefined, key: 'live-pill' })
  return (
    <Box key="project-bar" flexDirection="column" gap={0}>
      <Box flexDirection="row" alignItems="center" gap={1} flexWrap="wrap">
        {gate}
        {live}
        <Button key={`live-${room.id}`} plain label={room.isLive ? 'Canlıyı kapat' : 'Canlıyı aç'} onPress={() => ctx.on.toggleLive(room.id)} />
      </Box>
      {Meta(ctx, room.isLive
        ? 'Gelen agent mesajları bu oturumu uyandırır; her uyanış token harcar.'
        : 'Açarsan gelen agent mesajları bu oturumu uyandırır (token harcar).')}
    </Box>
  )
}

function Divider(ctx: Ctx, o: { ts: number; key: string }): RenderElement {
  const { Box, Text } = ctx.ui
  const label = dayLabel(o.ts, ctx.model.now)
  if (isText(ctx)) return <Box key={o.key} justifyContent="center"><Text color={ctx.look.lo}>{`── ${label} ──`}</Text></Box>
  return SvgOf(ctx, sigPic(dividerPart({ text: label, width: pxOf(ctx.columns) })), o.key) ?? <Text>{label}</Text>
}

const tsOf = (line: Line): number => (typeof line.message.ts === 'number' ? line.message.ts : 0)

function Timeline(ctx: Ctx, room: RoomView): RenderElement {
  const { Box } = ctx.ui
  const lines = ctx.model.lines.slice(-TIMELINE_LINES)
  const items: RenderElement[] = []
  if (ctx.model.lines.length > lines.length) items.push(Meta(ctx, 'Daha eski mesajlar odanın sayfasında.', 'older'))
  if (lines.length === 0) items.push(Meta(ctx, 'Henüz mesaj yok. İlk mesajı aşağıdan yaz.', 'none'))
  lines.forEach((line, i) => {
    const prev = lines[i - 1]
    const isNewDay = prev === undefined || dayKey(tsOf(prev)) !== dayKey(tsOf(line))
    if (isNewDay) items.push(Divider(ctx, { ts: tsOf(line), key: `day-${line.id}` }))
    const isFirst = isNewDay || prev?.authorUid !== line.authorUid || tsOf(line) - tsOf(prev) > GROUP_MS
    items.push(Bubble(ctx, { line, isFirst, hasNames: room.kind === 'project' }))
  })
  return <Box key="timeline" flexDirection="column" gap={isText(ctx) ? 0 : 1}>{items}</Box>
}

function ConnectBanner(ctx: Ctx): RenderElement | null {
  const { Box, Button, Text } = ctx.ui
  if (ctx.model.isConnected || (ctx.isWide && ctx.model.needsSetup)) return null
  const warn = ctx.look.role.warn
  return (
    <Box key="connect-banner" flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}
      borderStyle="round" borderColor={warn.line} backgroundColor={warn.tint} paddingX={1}>
      <Text color={warn.fg} wrap="wrap">Bu oturum henüz bağlı değil; yazdıkların sırada bekliyor.</Text>
      <Button key="connect-inline" variant="primary" label={ctx.model.busy ?? 'Bağlan'} onPress={() => ctx.on.connect()} />
    </Box>
  )
}

function Composer(ctx: Ctx, room: RoomView): RenderElement {
  const { Box } = ctx.ui
  if (!('Input' in ctx.ui)) return Meta(ctx, `Bu yüzeyde yalnızca okunur. Yazmak için odanın sayfasını aç: ${room.url}`, 'read-only')
  const { Input } = ctx.ui
  const isProject = room.kind === 'project'
  return (
    <Box key="composer" flexDirection="column" gap={0}>
      <Input key={`composer-${room.id}-${ctx.model.composerKey}`} placeholder={isProject ? 'Mesaj yaz ya da /ask ile agent\'a sor…' : 'Mesaj yaz…'}
        submitLabel="Gönder" autoFocus onSubmit={value => ctx.on.send(room.id, value)} />
      {isProject ? Meta(ctx, '/ask <soru> ile karşı tarafın agent\'ına sor · günde 10 soru', 'ask-hint') : null}
    </Box>
  )
}

export function ChatView(ctx: Ctx): RenderElement | null {
  const { Box } = ctx.ui
  const room = ctx.model.rooms.find(r => r.id === ctx.model.activeId)
  if (room === undefined) return null
  return (
    <Box key="chat" flexDirection="column" gap={1} flexGrow={1}>
      {ChatHead(ctx, room)}
      {ProjectBar(ctx, room)}
      {room.isTroubled ? Meta(ctx, 'Bağlantı sorunu: oda şu an okunamıyor, birazdan yeniden denenecek.', 'trouble') : null}
      {Timeline(ctx, room)}
      {ctx.isWide ? null : ErrorCard(ctx)}
      {ConnectBanner(ctx)}
      {Composer(ctx, room)}
    </Box>
  )
}
