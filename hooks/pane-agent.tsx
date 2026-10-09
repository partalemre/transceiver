// Agent traffic on the desktop. Each exchange is one line ("Alperen'in agent'ı diff sordu · cevaplandı · 0
// token") that opens on press: the question, who answered with what it cost, and a compact answer whose full text
// opens on a second press. A refusal stays a line in Flare, with nothing behind it. An agent's own note keeps its
// text, and an ask past the day's limit waits for the person as a compact draft. Words are native Text; only the
// lead glyph or face is Svg.
import type { RenderElement } from 'claude-code'

import { compactOf, FIRST_ROWS, type Compact } from './answers'
import { ANSWER_PREVIEW_LINES } from './limits'
import { GlyphPic, Pic, type Ctx } from './pane-kit'
import { tinyFace } from './sig-agent'
import { rowPart } from './sig-ui'
import type { Draft, Line } from './state-types'
import { avatarRole, initialsOf } from './theme'
import { firstName, genitive } from './tr'
import { askedArg, joined, messageOf, queryType, type Tx } from './traffic'
import { agentOf, answererOf, compactText, txSummary } from './tx-words'
import { clockText, secondsText } from './when'

const LEAD = 16
const FULL_SUFFIX = ':full'

// An opened answer's whole text is a second disclosure, kept under its own id.
export const fullIdOf = (txId: string): string => `${txId}${FULL_SUFFIX}`

function clipLines(text: string, isOpen: boolean): string {
  const lines = text.split('\n')
  if (isOpen || lines.length <= ANSWER_PREVIEW_LINES) return text
  return `${lines.slice(0, ANSWER_PREVIEW_LINES).join('\n')}\n… ${lines.length - ANSWER_PREVIEW_LINES} satır daha`
}

// How many of a search's or a list's rows hide behind "Tamamı".
const hiddenOf = (c: Compact): number => (c.kind === 'hits' || c.kind === 'list' ? Math.max(0, c.count - FIRST_ROWS) : 0)

function Toggle(ctx: Ctx, o: { key: string; id: string; open: string; closed: string }): RenderElement {
  const { Button } = ctx.ui
  const isOpen = ctx.model.expanded.includes(o.id)
  return <Button key={o.key} label={isOpen ? o.open : o.closed} plain onPress={() => ctx.on.toggleExpanded(o.id)} />
}

// The compact answer (a stat, counts, the first hits), then "Tamamı" for the whole text.
function AnswerBody(ctx: Ctx, o: { tx: Tx; body: string }): RenderElement[] {
  const { Box, Text } = ctx.ui
  const fullId = fullIdOf(o.tx.id)
  const isFull = ctx.model.expanded.includes(fullId)
  const c = compactOf(queryType(o.tx), o.body)
  const full = <Text key="body" color={ctx.look.hi} wrap="wrap">{clipLines(c.kind === 'text' ? c.text : o.body, isFull)}</Text>
  if (c.kind === 'text') return [full]
  const hidden = hiddenOf(c)
  const noun = c.kind === 'hits' ? 'eşleşme' : 'satır'
  const more = hidden === 0 ? '' : `+${hidden} ${noun} daha`
  const toggle = Toggle(ctx, { key: `more-${o.tx.id}`, id: fullId, open: 'Gizle', closed: 'Tamamı' })
  const row = <Box key="more" flexDirection="row" gap={1} alignItems="center">{more === '' ? null : <Text color={ctx.look.lo}>{more}</Text>}{toggle}</Box>
  return [<Text key="compact" color={ctx.look.hi} wrap="wrap">{compactText(c)}</Text>, row, ...(isFull ? [full] : [])]
}

// "Bu makine cevapladı · 0 token · 0,4 sn ··· 14:12"; a free answer's tokens in the signal colour.
function AnswerMeta(ctx: Ctx, o: { tx: Tx; a: NonNullable<ReturnType<typeof joined>> }): RenderElement {
  const { Box, Text } = ctx.ui
  const { a } = o
  const who = a.line.isMine ? 'Bu makine cevapladı' : answererOf(a)
  const q = o.tx.query === undefined ? null : messageOf(o.tx.query)
  const took = q === null ? '' : ` · ${secondsText(a.ts - q.ts)}`
  return (
    <Box key="answer-meta" flexDirection="row" gap={1}>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={ctx.look.mid} wrap="truncate-end">
          <Text bold>{who}</Text>
          <Text color={a.tokens === 0 ? ctx.look.signal.fg : ctx.look.lo}>{` · ${a.tokens} token`}</Text>
          <Text color={ctx.look.lo}>{took}</Text>
        </Text>
      </Box>
      <Text color={ctx.look.lo}>{clockText(a.ts)}</Text>
    </Box>
  )
}

function Detail(ctx: Ctx, tx: Tx): RenderElement {
  const { Box, Text } = ctx.ui
  const a = joined(tx)
  const question = queryType(tx) === 'ask' ? askedArg(tx) : undefined
  const kids: RenderElement[] = question === undefined ? [] : [<Text key="question" color={ctx.look.hi} wrap="wrap">{question}</Text>]
  if (a === null) kids.push(<Text key="waiting" color={ctx.look.lo}>Cevap bekleniyor…</Text>)
  else kids.push(AnswerMeta(ctx, { tx, a }), ...AnswerBody(ctx, { tx, body: a.body }))
  return <Box key="detail" flexDirection="column" gap={1} backgroundColor={ctx.look.inset} paddingX={1} paddingY={1}>{kids}</Box>
}

// The asker's face, the robot for this side's agent, a lock for a refusal.
function Lead(ctx: Ctx, o: { line: Line | undefined; isDenied: boolean }): RenderElement {
  if (o.isDenied) return GlyphPic(ctx, { glyph: 'lock', paint: 'danger', key: 'lead' })
  if (o.line === undefined || o.line.isMine) return GlyphPic(ctx, { glyph: 'robot', paint: 'run', key: 'lead' })
  const face = tinyFace({ initials: initialsOf(o.line.authorName), paint: avatarRole(o.line.seed), size: LEAD })
  return Pic(ctx, rowPart({ width: LEAD, height: LEAD, left: [face], alt: '' }), 'lead')
}

export function TxLine(ctx: Ctx, tx: Tx): RenderElement {
  const { Box, Text } = ctx.ui
  const s = txSummary(tx)
  const isDenied = s.outcome === 'denied'
  const isOpen = !isDenied && ctx.model.expanded.includes(tx.id)
  return (
    <Box key={`tx-${tx.id}`} flexDirection="column" gap={1}>
      <Box flexDirection="row" alignItems="center" gap={1}>
        {Lead(ctx, { line: tx.query, isDenied })}
        <Box flexGrow={1} flexShrink={1}><Text color={isDenied ? ctx.look.role.danger.fg : ctx.look.mid} wrap="truncate-end">{s.text}</Text></Box>
        {isDenied ? null : Toggle(ctx, { key: `open-tx-${tx.id}`, id: tx.id, open: 'Gizle', closed: 'Göster' })}
      </Box>
      {isOpen ? Detail(ctx, tx) : null}
    </Box>
  )
}

// A note an agent posted with the send tool: who wrote it, then its text on the inset.
export function AgentNote(ctx: Ctx, line: Line): RenderElement {
  const { Box, Text } = ctx.ui
  const m = messageOf(line)
  return (
    <Box key={`msg-${line.id}`} flexDirection="column" gap={1}>
      <Box flexDirection="row" alignItems="center" gap={1}>
        {Lead(ctx, { line, isDenied: false })}
        <Box flexGrow={1}><Text color={ctx.look.role.run.fg} bold>{`${agentOf(line)} yazdı`}</Text></Box>
        <Text color={ctx.look.lo}>{m === null ? '' : clockText(m.ts)}</Text>
      </Box>
      <Box backgroundColor={ctx.look.inset} paddingX={1} paddingY={1}><Text color={ctx.look.hi} wrap="wrap">{m?.text ?? ''}</Text></Box>
    </Box>
  )
}

// An ask past the day's limit: who asks what, then Gönder answers it once, outside the limit, or Vazgeç.
export function DraftCard(ctx: Ctx, draft: Draft): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const warn = ctx.look.role.warn
  return (
    <Box key={`draft-${draft.qid}`} flexDirection="column" gap={1} backgroundColor={warn.tint} paddingX={1} paddingY={1}>
      <Text color={warn.fg} wrap="wrap">{`${genitive(firstName(draft.asker))} agent'ı soruyor · onayını bekliyor`}</Text>
      <Text color={ctx.look.hi} wrap="wrap">{draft.question}</Text>
      {ctx.model.canSettleDrafts
        ? (
          <Box flexDirection="row" gap={1}>
            <Button key={`draft-yes-${draft.qid}`} variant="primary" label="Gönder" onPress={() => ctx.on.settleDraft(draft.qid, true)} />
            <Button key={`draft-no-${draft.qid}`} label="Vazgeç" plain onPress={() => ctx.on.settleDraft(draft.qid, false)} />
          </Box>
        )
        : null}
    </Box>
  )
}
