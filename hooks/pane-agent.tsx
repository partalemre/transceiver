// Agent traffic on the desktop. Each exchange is one line ("Alperen'in agent'ı diff sordu · cevaplandı · 0
// token") that opens on press: the question, who answered with what it cost, and a compact body whose full text
// opens on a second press. A refusal stays a line in Flare, with nothing behind it. An agent's own note keeps its
// text, and an ask past the day's limit waits for the person as a compact draft.
import type { RenderElement } from 'claude-code'

import { compactOf, FIRST_ROWS, type Compact } from './answers'
import { ANSWER_PREVIEW_LINES } from './limits'
import { Pic, PX_PER_CELL, type Ctx } from './pane-kit'
import { answerMetaPart, compactPart, tinyFace, txLinePart } from './sig-agent'
import { eyebrowPiece, glyphPiece, rowPart, textPiece } from './sig-ui'
import type { Draft, Line } from './state-types'
import { avatarRole, initialsOf } from './theme'
import { firstName, genitive } from './tr'
import { askedArg, joined, messageOf, queryType, type Tx } from './traffic'
import { agentOf, txSummary } from './tx-words'
import { clockText, secondsText } from './when'

const LEAD = 16
// What "Göster" takes beside a line, and the padding of an opened exchange.
const TOGGLE_PX = 64
const DETAIL_CHROME_PX = 2 * PX_PER_CELL
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
function extraOf(c: Compact): string | undefined {
  if (c.kind === 'hits') return `${c.count} eşleşme`
  return c.kind === 'list' ? `${c.count} ${c.noun}` : undefined
}

function Toggle(ctx: Ctx, o: { key: string; id: string; open: string; closed: string }): RenderElement {
  const { Button } = ctx.ui
  const isOpen = ctx.model.expanded.includes(o.id)
  return <Button key={o.key} label={isOpen ? o.open : o.closed} plain onPress={() => ctx.on.toggleExpanded(o.id)} />
}

// A compact body (a stat, pills, the first hits), then "Tamamı" for the whole text.
function AnswerBody(ctx: Ctx, o: { tx: Tx; body: string; width: number }): RenderElement[] {
  const { Box, Text } = ctx.ui
  const fullId = fullIdOf(o.tx.id)
  const isFull = ctx.model.expanded.includes(fullId)
  const c = compactOf(queryType(o.tx), o.body)
  const full = <Text key="body" color={ctx.look.hi} wrap="wrap">{clipLines(c.kind === 'text' ? c.text : o.body, isFull)}</Text>
  const part = c.kind === 'text' ? null : compactPart(c, { width: o.width, shown: FIRST_ROWS })
  if (part === null) return [full]
  const hidden = hiddenOf(c)
  const more = hidden === 0 ? '' : `+${hidden} ${c.kind === 'hits' ? 'eşleşme' : 'satır'} daha`
  const toggle = Toggle(ctx, { key: `more-${o.tx.id}`, id: fullId, open: 'Gizle', closed: 'Tamamı' })
  const row = <Box key="more" flexDirection="row" gap={1} alignItems="center">{more === '' ? null : <Text color={ctx.look.lo}>{more}</Text>}{toggle}</Box>
  return [Pic(ctx, part, 'compact'), row, ...(isFull ? [full] : [])]
}

function Detail(ctx: Ctx, o: { tx: Tx; width: number }): RenderElement {
  const { Box, Text } = ctx.ui
  const a = joined(o.tx)
  const question = queryType(o.tx) === 'ask' ? askedArg(o.tx) : undefined
  const kids: RenderElement[] = question === undefined ? [] : [<Text key="question" color={ctx.look.hi} wrap="wrap">{question}</Text>]
  if (a === null) kids.push(<Text key="waiting" color={ctx.look.lo}>Cevap bekleniyor…</Text>)
  else {
    const who = a.line.isMine ? 'Bu makine cevapladı' : agentOf(a.line, a.tokens > 0 ? 'agent\'ı' : 'makinesi')
    const q = o.tx.query === undefined ? null : messageOf(o.tx.query)
    const extra = extraOf(compactOf(queryType(o.tx), a.body)) ?? (q === null ? undefined : secondsText(a.ts - q.ts))
    kids.push(Pic(ctx, answerMetaPart({ width: o.width, who, tokens: a.tokens, extra, right: clockText(a.ts) }), 'answer-meta'))
    kids.push(...AnswerBody(ctx, { tx: o.tx, body: a.body, width: o.width }))
  }
  return <Box key="detail" flexDirection="column" gap={1} backgroundColor={ctx.look.inset} paddingX={1} paddingY={1}>{kids}</Box>
}

function leadOf(line: Line | undefined, isDenied: boolean) {
  if (isDenied) return glyphPiece('lock', { size: LEAD, paint: 'danger' })
  if (line === undefined || line.isMine) return glyphPiece('robot', { size: LEAD, paint: 'run', stroke: 1.5 })
  return tinyFace({ initials: initialsOf(line.authorName), paint: avatarRole(line.seed), size: LEAD })
}

export function TxLine(ctx: Ctx, tx: Tx): RenderElement {
  const { Box } = ctx.ui
  const s = txSummary(tx)
  const isDenied = s.outcome === 'denied'
  const width = ctx.px - (isDenied ? 0 : TOGGLE_PX)
  const line = txLinePart({ width, lead: leadOf(tx.query, isDenied), text: s.text, paint: isDenied ? 'danger' : 'mid' })
  const isOpen = !isDenied && ctx.model.expanded.includes(tx.id)
  return (
    <Box key={`tx-${tx.id}`} flexDirection="column" gap={1}>
      <Box flexDirection="row" alignItems="center">
        {Pic(ctx, line, 'tx-line')}
        <Box flexGrow={1} />
        {isDenied ? null : Toggle(ctx, { key: `open-tx-${tx.id}`, id: tx.id, open: 'Gizle', closed: 'Göster' })}
      </Box>
      {isOpen ? Detail(ctx, { tx, width: ctx.px - DETAIL_CHROME_PX }) : null}
    </Box>
  )
}

// A note an agent posted with the send tool: who wrote it, then its text on the inset.
export function AgentNote(ctx: Ctx, line: Line): RenderElement {
  const { Box, Text } = ctx.ui
  const m = messageOf(line)
  const head = rowPart({ width: ctx.px, height: 20, left: [leadOf(line, false), eyebrowPiece(`${agentOf(line)} yazdı`, { paint: 'run' })], right: [textPiece(m === null ? '' : clockText(m.ts), { size: 11, paint: 'lo' })], alt: `${agentOf(line)} yazdı` })
  return (
    <Box key={`msg-${line.id}`} flexDirection="column" gap={1}>
      {Pic(ctx, head, 'note-head')}
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
