// One room on the desktop, the conversation first: the head (back, face, name, presence; a project's "Details"),
// one notice line only when something is wrong, the timeline and the composer. A project's details (the gate's
// checks, the budget, today's counts, live mode) open on request. The terminal draws the same room in pane-term.
import type { RenderElement } from 'claude-code'

import { GROUP_MS, TIMELINE_LINES } from './limits'
import { AgentNote, DraftCard, TxLine } from './pane-agent'
import { RoomInfo } from './pane-aside'
import { Bubble } from './pane-bubble'
import { ErrorCard, GhCard, ShareCard } from './pane-cards'
import { Composer } from './pane-compose'
import { isHere, isText, Meta, Pic, roomFace, Rule, type Ctx } from './pane-kit'
import { TermChat } from './pane-term'
import { noticeOf, statusOf } from './pane-words'
import type { Line, RoomView } from './state-types'
import { itemsOf, messageOf, type Item, type Tx } from './traffic'
import { dayKey, dayRule } from './when'
import { chatWords } from './words-chat'

const FACE = 40

function ChatHead(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const hasInfo = room.kind === 'project'
  const status = statusOf(room, { now: ctx.model.now, isHere: isHere(room, ctx.model.now) })
  return (
    <Box key="chat-head" flexDirection="row" alignItems="center" gap={1}>
      {ctx.isWide ? null : <Button key="back" label="‹" plain onPress={() => ctx.on.back()} />}
      {Pic(ctx, roomFace(room, { size: FACE, now: ctx.model.now }), `chat-face-${room.id}`)}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text bold color={ctx.look.hi} wrap="truncate-end">{room.title}</Text>
        {status === null ? null : <Text color={status.isHere ? ctx.look.role.ok.fg : ctx.look.lo} wrap="truncate-end">{status.text}</Text>}
      </Box>
      {hasInfo ? <Button key={`info-${room.id}`} label={ctx.model.isInfoOpen ? chatWords().close : chatWords().details} plain dimColor onPress={() => ctx.on.toggleInfo(room.id)} /> : null}
    </Box>
  )
}

// A centred line of text between messages: the day, or where the unread ones begin.
function Divider(ctx: Ctx, o: { key: string; text: string; color?: string }): RenderElement {
  const { Box, Text } = ctx.ui
  return <Box key={o.key} flexDirection="row" justifyContent="center"><Text color={o.color ?? ctx.look.lo} bold>{o.text}</Text></Box>
}

// What is wrong, in one line, and the press that explains it when there is one.
export function Notice(ctx: Ctx, room: RoomView): RenderElement | null {
  const { Box, Button, Text } = ctx.ui
  const notice = noticeOf(room)
  if (notice === null) return null
  const tone = ctx.look.role[notice.paint]
  const why = notice.hasWhy && !ctx.model.isInfoOpen ? <Button key={`why-${room.id}`} label={chatWords().why} plain onPress={() => ctx.on.toggleInfo(room.id)} /> : null
  return (
    <Box key="notice" flexDirection="row" alignItems="center" gap={1}>
      <Box flexGrow={1} flexShrink={1}><Text color={tone.fg} wrap="wrap">{notice.text}</Text></Box>
      {why}
    </Box>
  )
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
  if (item?.kind !== 'line') return TxLine(ctx, item as Tx)
  if (messageOf(item.line)?.kind === 'agent') return AgentNote(ctx, item.line)
  const isFirst = o.isRuleHere || !isSameRun(o.items[o.i - 1], item)
  const isLast = o.isRuleNext || !isSameRun(item, o.items[o.i + 1])
  return Bubble(ctx, { line: item.line, isFirst, isLast, room: o.room })
}

// The day's divider before the first item of a day, "n new messages" before the first unread, then the item.
function slotEls(ctx: Ctx, o: Slot): RenderElement[] {
  const item = o.items[o.i] as Item
  const ts = tsOfLine(firstLineOf(item))
  const prev = o.i > 0 ? firstLineOf(o.items[o.i - 1] as Item) : undefined
  const out: RenderElement[] = []
  if (prev === undefined || dayKey(tsOfLine(prev)) !== dayKey(ts)) out.push(Divider(ctx, { key: `day-${idsOf(item)[0] ?? o.i}`, text: dayRule(ts, ctx.model.now) }))
  const divider = ctx.model.divider
  if (o.isRuleHere && divider !== null) out.push(Divider(ctx, { key: 'new-rule', text: chatWords().newMessages(divider.count), color: ctx.look.signal.fg }))
  return [...out, itemEl(ctx, o)]
}

function Timeline(ctx: Ctx, room: RoomView): RenderElement {
  const { Box } = ctx.ui
  const items = itemsOf(ctx.model.lines.slice(-TIMELINE_LINES))
  const at = (i: number) => { const d = ctx.model.divider; const it = items[i]; return d !== null && it !== undefined && idsOf(it).includes(d.id) }
  const out: RenderElement[] = []
  if (ctx.model.lines.length > TIMELINE_LINES) out.push(Meta(ctx, chatWords().older, 'older'))
  if (items.length === 0) out.push(Meta(ctx, chatWords().noMessages, 'none'))
  items.forEach((_, i) => out.push(...slotEls(ctx, { items, i, room, isRuleHere: at(i), isRuleNext: at(i + 1) })))
  for (const d of ctx.model.drafts.filter(x => x.roomId === room.id)) out.push(DraftCard(ctx, d))
  return <Box key="timeline" flexDirection="column" gap={1}>{out}</Box>
}

function ConnectBanner(ctx: Ctx): RenderElement | null {
  const { Box, Button, Text } = ctx.ui
  if (ctx.model.isConnected || (ctx.isWide && ctx.model.needsSetup)) return null
  const warn = ctx.look.role.warn
  return (
    <Box key="connect-banner" flexDirection="row" alignItems="center" justifyContent="space-between" gap={1} backgroundColor={warn.tint} paddingX={1}>
      <Text color={warn.fg} wrap="wrap">{chatWords().waitingBanner}</Text>
      <Button key="connect-inline" variant="primary" label={ctx.model.busy === null ? chatWords().connect : chatWords().connecting} onPress={() => ctx.on.connect()} />
    </Box>
  )
}

export function ChatView(ctx: Ctx): RenderElement | null {
  const { Box } = ctx.ui
  const room = ctx.model.rooms.find(r => r.id === ctx.model.activeId)
  if (room === undefined) return null
  if (isText(ctx)) return TermChat(ctx, room)
  const isInfoHere = ctx.model.isInfoOpen && !ctx.isWide
  return (
    <Box key="chat" flexDirection="column" gap={1} flexGrow={1}>
      {ChatHead(ctx, room)}
      {Rule(ctx, 'head-rule')}
      {Notice(ctx, room)}
      {ShareCard(ctx, room)}
      {ctx.model.ghAsk?.roomId === room.id ? GhCard(ctx) : null}
      {isInfoHere ? RoomInfo(ctx, room) : null}
      {isInfoHere ? Rule(ctx, 'info-rule') : null}
      {Timeline(ctx, room)}
      {ctx.isWide ? null : ErrorCard(ctx)}
      {ConnectBanner(ctx)}
      {Composer(ctx, room)}
    </Box>
  )
}
