// One timeline entry: a person's message as a bubble (mine in signal, theirs on the card colour, time and receipt
// inside), agent traffic as an Iris card (a question, an answer, a denial in Flare), a system line, or an
// unreadable doc.
import type { RenderElement } from 'claude-code'

import { ANSWER_PREVIEW_LINES } from './limits'
import { Avatar, isText, pxOf, receiptTone, SvgOf, type Ctx } from './pane-kit'
import type { Message, QueryType } from './protocol'
import { eyebrowLine, sigPic } from './sig'
import type { Line } from './state-types'
import { avatarRole } from './theme'
import { clockText } from './when'

const AVATAR = 24
const AVATAR_CELLS = 3
// The empty side of a bubble, so mine and theirs never line up into one column.
const GUTTER = 6

const QUERY_LABEL: Record<QueryType, string> = {
  status: 'git durumu', log: 'son commit\'ler', branch: 'dal', diff: 'değişiklikler',
  file: 'dosya', tests: 'testler', plan: 'plan', ask: 'soru',
}

export type BubbleOpts = { line: Line; isFirst: boolean; hasNames: boolean }

const isMessage = (m: Line['message']): m is Message & Line['message'] => !('isUnreadable' in m)

function Stamp(ctx: Ctx, line: Line, ts: number): RenderElement {
  const { Box, Text } = ctx.ui
  const tick = line.receipt === undefined ? null : receiptTone(ctx, line.receipt)
  return (
    <Box flexDirection="row" justifyContent="flex-end" gap={1}>
      <Text color={ctx.look.lo}>{clockText(ts)}</Text>
      {tick === null ? null : <Text color={tick.color}>{tick.glyph}</Text>}
    </Box>
  )
}

// Mine to the right with the gutter on the left; theirs to the left behind their avatar (first of a run only).
function Side(ctx: Ctx, o: { line: Line; isFirst: boolean; body: RenderElement }): RenderElement {
  const { Box } = ctx.ui
  const { line } = o
  if (line.isMine) {
    return <Box key={`msg-${line.id}`} flexDirection="row" justifyContent="flex-end" paddingLeft={GUTTER}>{o.body}</Box>
  }
  const face = o.isFirst ? Avatar(ctx, { name: line.authorName, seed: line.seed, size: AVATAR }) : <Box width={isText(ctx) ? 1 : AVATAR_CELLS} flexShrink={0} />
  return (
    <Box key={`msg-${line.id}`} flexDirection="row" justifyContent="flex-start" alignItems="flex-start" gap={1} paddingRight={GUTTER}>
      {face}
      {o.body}
    </Box>
  )
}

function HumanBubble(ctx: Ctx, o: BubbleOpts, m: Message): RenderElement {
  const { Box, Text } = ctx.ui
  const { line } = o
  const tone = line.isMine ? ctx.look.signal : { tint: ctx.look.card, line: ctx.look.line }
  const nameColor = ctx.look.role[avatarRole(line.seed)].fg
  const body = (
    <Box flexDirection="column" borderStyle="round" borderColor={tone.line} backgroundColor={tone.tint} paddingX={1}>
      {o.hasNames && o.isFirst && !line.isMine ? <Text bold color={nameColor}>{line.authorName}</Text> : null}
      <Text color={ctx.look.hi} wrap="wrap">{m.text}</Text>
      {Stamp(ctx, line, m.ts)}
    </Box>
  )
  return Side(ctx, { line, isFirst: o.isFirst, body })
}

function clipLines(text: string): string {
  const lines = text.split('\n')
  if (lines.length <= ANSWER_PREVIEW_LINES) return text
  return `${lines.slice(0, ANSWER_PREVIEW_LINES).join('\n')}\n… ${lines.length - ANSWER_PREVIEW_LINES} satır daha`
}

type AgentSpec = { eyebrow: string; text: string; isDenied: boolean; isCode: boolean }

function agentSpec(m: Message): AgentSpec {
  if (m.kind === 'query') {
    const type = m.query?.type ?? 'ask'
    const text = type === 'ask' ? m.query?.question ?? m.text : type === 'file' ? m.query?.path ?? m.text : m.text || QUERY_LABEL[type]
    return { eyebrow: type === 'ask' ? 'Agent sorusu' : `Agent sorusu · ${QUERY_LABEL[type]}`, text, isDenied: false, isCode: type === 'file' }
  }
  if (m.kind === 'answer') {
    const isDenied = m.answer?.ok === false
    return { eyebrow: isDenied ? 'Agent cevabı · erişim yok' : 'Agent cevabı', text: clipLines(m.answer?.body ?? m.text), isDenied, isCode: !isDenied }
  }
  return { eyebrow: 'Agent mesajı', text: m.text, isDenied: false, isCode: false }
}

function AgentHead(ctx: Ctx, o: { spec: AgentSpec; meta: string; columns: number }): RenderElement {
  const { Text } = ctx.ui
  const tone = o.spec.isDenied ? ctx.look.role.danger : ctx.look.role.run
  if (isText(ctx)) return <Text color={tone.fg} bold>{`◆ ${o.spec.eyebrow.toLocaleUpperCase('tr')}  `}<Text color={ctx.look.lo}>{o.meta}</Text></Text>
  const paint = o.spec.isDenied ? 'danger' : 'run'
  return SvgOf(ctx, sigPic(eyebrowLine({ text: o.spec.eyebrow, paint, width: pxOf(o.columns), meta: o.meta }))) ?? <Text>{o.spec.eyebrow}</Text>
}

function AgentCard(ctx: Ctx, o: BubbleOpts, m: Message): RenderElement {
  const { Box, Text } = ctx.ui
  const spec = agentSpec(m)
  const tone = spec.isDenied ? ctx.look.role.danger : ctx.look.role.run
  const tokens = m.kind === 'answer' && (m.answer?.tokens ?? 0) > 0 ? ` · ${m.answer?.tokens} token` : ''
  // Mine carry the time and receipt at the foot, as a bubble does; theirs say who and when up top.
  const who = o.line.isMine ? o.line.authorName : `${o.line.authorName.split(' ')[0] ?? ''} · ${clockText(m.ts)}`
  const meta = `${who}${tokens}`
  const columns = Math.max(1, ctx.columns - GUTTER - AVATAR_CELLS - 4)
  const text = spec.isCode && !isText(ctx)
    ? <Box backgroundColor={ctx.look.inset} paddingX={1}><Text color={ctx.look.mid} wrap="wrap">{spec.text}</Text></Box>
    : <Text color={spec.isDenied ? tone.fg : ctx.look.hi} wrap="wrap">{spec.text}</Text>
  const body = (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={tone.line} backgroundColor={tone.tint} paddingX={1}>
      {AgentHead(ctx, { spec, meta, columns })}
      {text}
      {o.line.receipt === undefined ? null : Stamp(ctx, o.line, m.ts)}
    </Box>
  )
  return Side(ctx, { line: o.line, isFirst: true, body })
}

export function Bubble(ctx: Ctx, o: BubbleOpts): RenderElement {
  const { Box, Text } = ctx.ui
  const m = o.line.message
  if (!isMessage(m)) {
    return <Box key={`msg-${o.line.id}`} paddingLeft={AVATAR_CELLS + 1}><Text color={ctx.look.lo} italic>okunamayan mesaj</Text></Box>
  }
  if (m.kind === 'system') {
    return <Box key={`msg-${o.line.id}`} justifyContent="center"><Text color={ctx.look.lo} italic wrap="wrap">{m.text}</Text></Box>
  }
  return m.kind === 'human' ? HumanBubble(ctx, o, m) : AgentCard(ctx, o, m)
}
