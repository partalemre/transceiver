// One room on the desktop: the head (back, face with presence, name, status, the signal pill or the live switch),
// a project's gate strip, the timeline and the composer. The terminal draws the same room in pane-term.
import type { RenderElement } from 'claude-code'

import { GROUP_MS, TIMELINE_LINES } from './limits'
import { AgentNote, DraftCard, TxCard } from './pane-agent'
import { Bubble } from './pane-bubble'
import { ErrorCard } from './pane-cards'
import { Composer } from './pane-compose'
import { IconButton, isHere, isText, Meta, Pic, PX_PER_CELL, roomFace, Rule, SvgOf, type Ctx } from './pane-kit'
import { TermChat } from './pane-term'
import { GATE_WORD, gateDetail, statusOf } from './pane-words'
import { dividerPart, sigPic, switchPart } from './sig'
import { headLinePart, newRulePart, signalPillPart } from './sig-chat'
import { gateStripPart } from './sig-room'
import { rowPart, textPiece } from './sig-ui'
import type { Line, RoomView } from './state-types'
import { itemsOf, messageOf, type Item, type Tx } from './traffic'
import { agoText, dayKey, dayLabel, secondsText } from './when'

const FACE = 40
const BACK_CELLS = 6
const PILL_CELLS = 10
const LIVE_CELLS = 13

function LiveSwitch(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button } = ctx.ui
  return (
    <Box key="live-switch" flexDirection="row" alignItems="center" gap={1} borderStyle="round" borderColor={ctx.look.lineStrong} paddingX={1} flexShrink={0}>
      {SvgOf(ctx, sigPic(switchPart(room.isLive)), 'live-knob')}
      <Button key={`live-${room.id}`} label="Canlı" plain onPress={() => ctx.on.toggleLive(room.id)} />
    </Box>
  )
}

function rightOf(ctx: Ctx, room: RoomView): { el: RenderElement | null; cells: number } {
  if (room.kind === 'project') return ctx.isWide ? { el: null, cells: 0 } : { el: LiveSwitch(ctx, room), cells: LIVE_CELLS }
  const ms = ctx.model.latencyMs
  if (ms === null || ms <= 0) return { el: null, cells: 0 }
  const isLive = ctx.model.isConnected && !room.isTroubled
  return { el: Pic(ctx, signalPillPart({ text: secondsText(ms), isLive }), 'signal'), cells: PILL_CELLS }
}

function ChatHead(ctx: Ctx, room: RoomView): RenderElement {
  const { Box } = ctx.ui
  const back = ctx.isWide ? null : IconButton(ctx, { key: 'back', label: '‹', onPress: () => ctx.on.back() })
  const right = rightOf(ctx, room)
  const status = statusOf(room, { now: ctx.model.now, isHere: isHere(room, ctx.model.now) })
  const width = ctx.px - ((back === null ? 0 : BACK_CELLS) + right.cells) * PX_PER_CELL
  const face = roomFace(room, { size: FACE, now: ctx.model.now })
  const head = headLinePart({ face, title: room.title, sub: status?.text, subPaint: status?.isHere === true ? 'ok' : 'lo', isMonoTitle: room.kind === 'project', width })
  return (
    <Box key="chat-head" flexDirection="row" alignItems="center" gap={1}>
      {back}
      {Pic(ctx, head, 'chat-head-svg')}
      <Box flexGrow={1} />
      {right.el}
    </Box>
  )
}

// KAPI AÇIK @alperenx collaborator ··· 3 dk önce / ask bugün ━━ 3/10 · 13 modelsiz
function GateStrip(ctx: Ctx, room: RoomView): RenderElement | null {
  const p = room.project
  if (p === undefined || ctx.isWide) return null
  const at = p.checks.checkedAt
  return Pic(ctx, gateStripPart({
    width: ctx.px, tone: GATE_WORD[room.gate], detail: gateDetail(room), ago: at === null ? undefined : agoText(at, ctx.model.now),
    ask: { used: p.askUsed, limit: p.askLimit }, modelless: p.today.modelless,
  }), 'gate-strip')
}

const tsOfLine = (line: Line | undefined): number => (line === undefined ? 0 : messageOf(line)?.ts ?? 0)
export const firstLineOf = (item: Item): Line | undefined => (item.kind === 'line' ? item.line : item.query ?? item.answers[0])
export const idsOf = (item: Item): string[] =>
  (item.kind === 'line' ? [item.line.id] : [item.query?.id, ...item.answers.map(a => a.id)].filter((x): x is string => x !== undefined))

// Two lines are one run when the same person wrote both, as people, within GROUP_MS and on the same day.
export function isSameRun(a: Item | undefined, b: Item | undefined): boolean {
  if (a?.kind !== 'line' || b?.kind !== 'line') return false
  const [x, y] = [messageOf(a.line), messageOf(b.line)]
  if (x?.kind !== 'human' || y?.kind !== 'human') return false
  return a.line.authorUid === b.line.authorUid && y.ts - x.ts <= GROUP_MS && dayKey(x.ts) === dayKey(y.ts)
}

type Slot = { items: Item[]; i: number; room: RoomView; isRuleNext: boolean; isRuleHere: boolean }

function itemEl(ctx: Ctx, o: Slot): RenderElement {
  const item = o.items[o.i]
  if (item?.kind !== 'line') return TxCard(ctx, item as Tx)
  if (messageOf(item.line)?.kind === 'agent') return AgentNote(ctx, item.line)
  const isFirst = o.isRuleHere || !isSameRun(o.items[o.i - 1], item)
  const isLast = o.isRuleNext || !isSameRun(item, o.items[o.i + 1])
  return Bubble(ctx, { line: item.line, isFirst, isLast, room: o.room })
}

// The day's divider before the first item of a day, "n yeni mesaj" before the first unread, then the item.
function slotEls(ctx: Ctx, o: Slot): RenderElement[] {
  const item = o.items[o.i] as Item
  const ts = tsOfLine(firstLineOf(item))
  const prev = o.i > 0 ? firstLineOf(o.items[o.i - 1] as Item) : undefined
  const out: RenderElement[] = []
  if (prev === undefined || dayKey(tsOfLine(prev)) !== dayKey(ts)) out.push(Pic(ctx, dividerPart({ text: dayLabel(ts, ctx.model.now), width: ctx.px }), `day-${idsOf(item)[0] ?? o.i}`))
  const divider = ctx.model.divider
  if (o.isRuleHere && divider !== null) out.push(Pic(ctx, newRulePart({ text: `${divider.count} yeni mesaj`, width: ctx.px }), 'new-rule'))
  return [...out, itemEl(ctx, o)]
}

function Timeline(ctx: Ctx, room: RoomView): RenderElement {
  const { Box } = ctx.ui
  const items = itemsOf(ctx.model.lines.slice(-TIMELINE_LINES))
  const at = (i: number) => { const d = ctx.model.divider; const it = items[i]; return d !== null && it !== undefined && idsOf(it).includes(d.id) }
  const out: RenderElement[] = []
  if (ctx.model.lines.length > TIMELINE_LINES) out.push(Meta(ctx, 'Daha eski mesajlar odanın sayfasında.', 'older'))
  if (items.length === 0) out.push(Meta(ctx, 'Henüz mesaj yok. İlk mesajı aşağıdan yaz.', 'none'))
  items.forEach((_, i) => out.push(...slotEls(ctx, { items, i, room, isRuleHere: at(i), isRuleNext: at(i + 1) })))
  for (const d of ctx.model.drafts.filter(x => x.roomId === room.id)) out.push(DraftCard(ctx, d))
  return <Box key="timeline" flexDirection="column" gap={1}>{out}</Box>
}

function ConnectBanner(ctx: Ctx): RenderElement | null {
  const { Box, Button, Text } = ctx.ui
  if (ctx.model.isConnected || (ctx.isWide && ctx.model.needsSetup)) return null
  const warn = ctx.look.role.warn
  const label = ctx.model.busy ?? (ctx.model.waiting.length > 0 ? 'Bağlan ve gönder' : 'Bağlan')
  return (
    <Box key="connect-banner" flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}
      borderStyle="round" borderColor={warn.line} backgroundColor={warn.tint} paddingX={1}>
      <Text color={warn.fg} wrap="wrap">Bu oturum henüz bağlı değil; yazdıkların sırada bekliyor.</Text>
      <Button key="connect-inline" variant="primary" label={label} onPress={() => ctx.on.connect()} />
    </Box>
  )
}

const TROUBLE = 'Bağlantı sorunu: oda şu an okunamıyor, birazdan yeniden denenecek.'

export function ChatView(ctx: Ctx): RenderElement | null {
  const { Box } = ctx.ui
  const room = ctx.model.rooms.find(r => r.id === ctx.model.activeId)
  if (room === undefined) return null
  if (isText(ctx)) return TermChat(ctx, room)
  const trouble = rowPart({ width: ctx.px, height: 18, left: [textPiece(TROUBLE, { size: 12, paint: 'warn', max: ctx.px })], alt: TROUBLE })
  return (
    <Box key="chat" flexDirection="column" gap={1} flexGrow={1}>
      {ChatHead(ctx, room)}
      {Rule(ctx, 'head-rule')}
      {GateStrip(ctx, room)}
      {room.isTroubled ? Pic(ctx, trouble, 'trouble') : null}
      {Timeline(ctx, room)}
      {ctx.isWide ? null : ErrorCard(ctx)}
      {ConnectBanner(ctx)}
      {Composer(ctx, room)}
    </Box>
  )
}
