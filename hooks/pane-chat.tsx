// One room on the desktop, the conversation first: the head (back, face, name, what is known of the other side; a
// project's "Details"), one notice line only when something is wrong, the timeline and, at the foot of the pane,
// the composer. Lines from one sender form one run; the day and the first unread line each get a divider. A
// project's details open on request. The terminal draws the same room in pane-term.
import type { RenderElement } from 'claude-code'

import { isGitUrl } from './gitbox'
import { GROUP_MS, TIMELINE_LINES } from './limits'
import { DraftCard, TxLine } from './pane-agent'
import { RoomInfo } from './pane-aside'
import { BridgeHead } from './pane-bridge'
import { Run } from './pane-bubble'
import { ErrorCard, GhCard, ShareCard } from './pane-cards'
import { Composer } from './pane-compose'
import { PressRow } from './kit/press'
import { isHere, isText, Meta, SvgOf, type Ctx } from './pane-kit'
import { StateText } from './pane-state'
import { Sentence, Title } from './pane-type'
import { chatHeadPic } from './sig-head'
import { dividerPic } from './sig-talk'
import { TermChat } from './pane-term'
import { noticeOf, statusOf } from './pane-words'
import type { Line, RoomView } from './state-types'
import { itemsOf, messageOf, type Item } from './traffic'
import { dayKey, dayRule } from './when'
import { chatWords } from './words-chat'

// A room that is not a person yet: a project's branch, the computers, a friend still awaited.
const MARK_OF: Record<RoomView['kind'], string> = { project: 'branch', devices: 'laptop', dm: 'clock' }
// Room the native "Details" press takes beside the head.
const DETAILS_PX = 96
// Room the native "Why?" and "Connect" presses take beside their line.
const WHY_PX = 80
const CONNECT_PX = 110

function headPic(ctx: Ctx, room: RoomView) {
  const status = statusOf(room, { now: ctx.model.now, isHere: isHere(room, ctx.model.now) })
  const hasInfo = room.kind === 'project'
  const name = room.kind === 'project' ? room.repo ?? room.title : room.title
  const mark = MARK_OF[room.kind]
  const isPerson = room.kind === 'dm' && !room.isWaiting
  return chatHeadPic({
    width: ctx.px - (hasInfo ? DETAILS_PX : 0), title: name, sub: status?.text ?? '', isSubLive: status?.isHere === true,
    hasBack: !ctx.isWide, face: { kind: isPerson ? 'person' : 'mark', name: room.peerName ?? room.title, mark, isHere: status?.isHere === true }, pin: ctx.look.pin,
  })
}

// Narrow, the whole head is the way back; a project room keeps its "Details" press at the right.
function ChatHead(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button } = ctx.ui
  const drawing = SvgOf(ctx, headPic(ctx, room), `head-pic-${room.id}`)
  const head = drawing === null || ctx.isWide ? drawing : PressRow(ctx.ui, { box: 'back-row', key: 'back', drawing, onPress: () => ctx.on.back() })
  if (room.kind !== 'project') return <Box key="chat-head" flexDirection="row">{head}</Box>
  const label = ctx.model.isInfoOpen ? chatWords().close : chatWords().details
  return (
    <Box key="chat-head" flexDirection="row" alignItems="center">
      {head}
      <Box flexGrow={1} />
      <Button key={`info-${room.id}`} label={label} plain dimColor onPress={() => ctx.on.toggleInfo(room.id)} />
    </Box>
  )
}

function Divider(ctx: Ctx, o: { key: string; text: string; isNew: boolean }): RenderElement {
  return SvgOf(ctx, dividerPic({ width: ctx.px, text: o.text, isNew: o.isNew, pin: ctx.look.pin }), o.key) ?? Meta(ctx, o.text, o.key)
}

// What is wrong, in one line, and the press that explains it when there is one.
export function Notice(ctx: Ctx, room: RoomView): RenderElement | null {
  const { Box, Button, Text } = ctx.ui
  const notice = noticeOf(room)
  if (notice === null) return null
  const why = notice.hasWhy && !ctx.model.isInfoOpen ? <Button key={`why-${room.id}`} label={chatWords().why} plain onPress={() => ctx.on.toggleInfo(room.id)} /> : null
  return (
    <Box key="notice" flexDirection="row" alignItems="center" gap={1}>
      <Box flexGrow={1} flexShrink={1}>{StateText(ctx, { key: 'notice-text', text: notice.text, role: notice.paint, room: why === null ? 0 : WHY_PX })}</Box>
      {why}
    </Box>
  )
}

const tsOfLine = (line: Line | undefined): number => (line === undefined ? 0 : messageOf(line)?.ts ?? 0)
export const firstLineOf = (item: Item): Line | undefined => (item.kind === 'line' ? item.line : item.query ?? item.answers[0])
export const idsOf = (item: Item): string[] =>
  (item.kind === 'line' ? [item.line.id] : [item.query?.id, ...item.answers.map(a => a.id)].filter((x): x is string => x !== undefined))

// Two lines are one run when the same person wrote both, of one kind (a person's words or their AI's), within
// GROUP_MS and on the same day.
export function isSameRun(a: Item | undefined, b: Item | undefined): boolean {
  if (a?.kind !== 'line' || b?.kind !== 'line') return false
  const [x, y] = [messageOf(a.line), messageOf(b.line)]
  if (x === null || y === null || x?.kind === 'system' || y?.kind === 'system' || x?.kind !== y?.kind) return false
  return a.line.authorUid === b.line.authorUid && y.ts - x.ts <= GROUP_MS && dayKey(x.ts) === dayKey(y.ts)
}

// The day's divider before the first item of a day, "n new messages" before the first unread.
function dividersAt(ctx: Ctx, items: Item[], i: number): RenderElement[] {
  const item = items[i] as Item
  const ts = tsOfLine(firstLineOf(item))
  const prev = i > 0 ? firstLineOf(items[i - 1] as Item) : undefined
  const out: RenderElement[] = []
  if (prev === undefined || dayKey(tsOfLine(prev)) !== dayKey(ts)) out.push(Divider(ctx, { key: `day-${idsOf(item)[0] ?? i}`, text: dayRule(ts, ctx.model.now), isNew: false }))
  const divider = ctx.model.divider
  if (divider !== null && idsOf(item).includes(divider.id)) out.push(Divider(ctx, { key: 'new-rule', text: chatWords().newMessages(divider.count), isNew: true }))
  return out
}

// Items in order, a run of one sender's lines gathered into one drawing, broken by a divider.
function threadOf(ctx: Ctx, o: { items: Item[]; room: RoomView }): RenderElement[] {
  const out: RenderElement[] = []
  let run: Line[] = []
  const flush = () => {
    if (run.length > 0) out.push(Run(ctx, { lines: run, room: o.room }))
    run = []
  }
  o.items.forEach((item, i) => {
    const dividers = dividersAt(ctx, o.items, i)
    if (dividers.length > 0 || item.kind === 'tx' || !isSameRun(o.items[i - 1], item)) flush()
    out.push(...dividers)
    if (item.kind === 'tx') out.push(TxLine(ctx, item))
    else run.push(item.line)
  })
  flush()
  return out
}

export function emptyWords(room: RoomView): { title: string; body: string } {
  const w = chatWords()
  const isRepoAlone = room.kind === 'project' && isGitUrl(room.url) && room.peerName === undefined
  return isRepoAlone ? w.repoAlone : { title: w.noMessagesTitle, body: w.noMessages }
}

// An empty room says what happens next. A repo's room fills by itself: a teammate who has MODZ and opens the
// project appears here, nothing to send them.
function Empty(ctx: Ctx, room: RoomView): RenderElement {
  const { Box } = ctx.ui
  const say = emptyWords(room)
  return (
    <Box key="none" flexDirection="column" gap={1} paddingTop={1}>
      {Title(ctx, { key: 'none-title', text: say.title })}
      {Sentence(ctx, { key: 'none-body', text: say.body, paint: 'lo' })}
    </Box>
  )
}

function Timeline(ctx: Ctx, room: RoomView): RenderElement {
  const { Box } = ctx.ui
  const items = itemsOf(ctx.model.lines.slice(-TIMELINE_LINES))
  const out: RenderElement[] = []
  if (ctx.model.lines.length > TIMELINE_LINES) out.push(Meta(ctx, chatWords().older, 'older'))
  if (items.length === 0) out.push(Empty(ctx, room))
  out.push(...threadOf(ctx, { items, room }))
  for (const d of ctx.model.drafts.filter(x => x.roomId === room.id)) out.push(DraftCard(ctx, d))
  return <Box key="timeline" flexDirection="column" gap={1}>{out}</Box>
}

function ConnectBanner(ctx: Ctx): RenderElement | null {
  const { Box, Button, Text } = ctx.ui
  if (ctx.model.isConnected || (ctx.isWide && ctx.model.needsSetup)) return null
  return (
    <Box key="connect-banner" flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
      <Box flexShrink={1}>{StateText(ctx, { key: 'banner-text', text: chatWords().waitingBanner, role: 'warn', room: CONNECT_PX })}</Box>
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
  // As tall as the pane when the host says how tall: the timeline takes the rest, the field rests at the foot.
  const tall = ctx.rows === undefined ? {} : { minHeight: ctx.rows }
  return (
    <Box key="chat" flexDirection="column" gap={1} flexGrow={1} {...tall}>
      {ChatHead(ctx, room)}
      {room.kind === 'devices' ? BridgeHead(ctx, room) : null}
      {Notice(ctx, room)}
      {ShareCard(ctx, room)}
      {ctx.model.ghAsk?.roomId === room.id ? GhCard(ctx) : null}
      {isInfoHere ? RoomInfo(ctx, room) : null}
      <Box key="timeline-grow" flexDirection="column" flexGrow={1} paddingTop={1}>{Timeline(ctx, room)}</Box>
      {ctx.isWide ? null : ErrorCard(ctx)}
      {ConnectBanner(ctx)}
      {Composer(ctx, room)}
    </Box>
  )
}
