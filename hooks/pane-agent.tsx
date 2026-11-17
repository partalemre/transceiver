// AI traffic on the desktop. Each exchange is a question and its answer (sig-tx.ts): who asked, what, who answered
// with what it cost; a press opens the compact answer, a second its whole text. A refusal says so in Flare, with
// nothing behind it. An ask past the day's limit waits for the person as a compact draft.
import type { RenderElement } from 'claude-code'

import { compactOf, FIRST_ROWS, type Compact } from './answers'
import { ANSWER_PREVIEW_LINES } from './limits'
import { SvgOf, type Ctx } from './pane-kit'
import { StateText } from './pane-state'
import { specOf } from './query-menu'
import { txPic, type TxOutcome } from './sig-tx'
import type { Draft } from './state-types'
import { firstName } from './tr'
import { askedArg, joined, messageOf, queryType, type Tx } from './traffic'
import { agentOf, answererOf, compactText, viewLabel } from './tx-words'
import { clockText, secondsText } from './when'
import { chatWords } from './words-chat'
import { tokensText } from './words-count'
import { shownWire } from './words-wire'

// The drawing's text column in cells (sig-talk TALK.textX), so the press and the answer line up under the question.
const TEXT_CELLS = 4
const FULL_SUFFIX = ':full'

// An opened answer's whole text is a second disclosure, kept under its own id.
export const fullIdOf = (txId: string): string => `${txId}${FULL_SUFFIX}`

function clipLines(text: string, isOpen: boolean): string {
  const lines = text.split('\n')
  if (isOpen || lines.length <= ANSWER_PREVIEW_LINES) return text
  return `${lines.slice(0, ANSWER_PREVIEW_LINES).join('\n')}\n${chatWords().moreLines(lines.length - ANSWER_PREVIEW_LINES)}`
}

// How many of a search's or a list's rows hide behind "Show all".
const hiddenOf = (c: Compact): number => (c.kind === 'hits' || c.kind === 'list' ? Math.max(0, c.count - FIRST_ROWS) : 0)

function Toggle(ctx: Ctx, o: { key: string; id: string; open: string; closed: string }): RenderElement {
  const { Button } = ctx.ui
  const isOpen = ctx.model.expanded.includes(o.id)
  return <Button key={o.key} label={isOpen ? o.open : o.closed} plain onPress={() => ctx.on.toggleExpanded(o.id)} />
}

// The compact answer (a stat, counts, the first hits), then "Show all" for the whole text.
function AnswerBody(ctx: Ctx, o: { tx: Tx; body: string }): RenderElement[] {
  const { Box, Text } = ctx.ui
  const fullId = fullIdOf(o.tx.id)
  const isFull = ctx.model.expanded.includes(fullId)
  const c = compactOf(queryType(o.tx), o.body)
  const full = <Text key="body" color={ctx.look.hi} wrap="wrap">{clipLines(shownWire(c.kind === 'text' ? c.text : o.body), isFull)}</Text>
  if (c.kind === 'text') return [full]
  const w = chatWords()
  const hidden = hiddenOf(c)
  const more = hidden === 0 ? '' : w.moreHidden({ n: hidden, isHits: c.kind === 'hits' })
  const toggle = Toggle(ctx, { key: `more-${o.tx.id}`, id: fullId, open: w.hide, closed: w.showAll })
  const row = <Box key="more" flexDirection="row" gap={1} alignItems="center">{more === '' ? null : <Text {...ctx.look.loText}>{more}</Text>}{toggle}</Box>
  return [<Text key="compact" color={ctx.look.hi} wrap="wrap">{compactText(c)}</Text>, row, ...(isFull ? [full] : [])]
}

// What the answer said: its compact form and, on a second press, the whole text. The drawing above already says who
// answered and what it cost.
function Detail(ctx: Ctx, tx: Tx): RenderElement {
  const { Box } = ctx.ui
  const a = joined(tx)
  return <Box key="detail" flexDirection="column" gap={1}>{a === null ? [] : AnswerBody(ctx, { tx, body: a.body })}</Box>
}

// The question as asked: a free question's own words, else what the query reads (and what it was given).
function questionOf(tx: Tx): string {
  if (tx.query === undefined) return chatWords().earlierQuestion
  const arg = askedArg(tx)
  const type = queryType(tx)
  if (type === 'ask') return arg ?? specOf('ask')?.desc ?? ''
  const desc = specOf(type)?.desc ?? type
  return arg === undefined ? desc : `${desc} · ${arg}`
}

// How it ended, in a line: who answered and what it cost, that it waits, or that it was refused.
function answerOf(tx: Tx): { text: string; outcome: TxOutcome } {
  const a = joined(tx)
  if (a === null) return { text: chatWords().waitingAnswer, outcome: 'waiting' }
  if (a.isDenied) return { text: chatWords().refused, outcome: 'denied' }
  const q = tx.query === undefined ? null : messageOf(tx.query)
  const who = a.line.isMine ? chatWords().thisMachine : answererOf(a)
  const took = q === null ? '' : ` · ${secondsText(a.ts - q.ts)}`
  return { text: `${who} · ${tokensText(a.tokens)}${took}`, outcome: 'answered' }
}

// One exchange: the question→answer drawing, then the press that opens the answer itself.
export function TxLine(ctx: Ctx, tx: Tx): RenderElement {
  const { Box } = ctx.ui
  const end = answerOf(tx)
  const asker = tx.query ?? tx.answers[0]
  const ts = asker === undefined ? 0 : messageOf(asker)?.ts ?? 0
  const pic = txPic({
    width: ctx.px, pin: ctx.look.pin, time: clockText(ts), question: questionOf(tx), answer: end.text, outcome: end.outcome,
    asker: { label: chatWords().aiAsked(agentOf(tx.query)), name: tx.query?.authorName ?? '', isAgent: true },
  })
  const isOpen = end.outcome === 'answered' && ctx.model.expanded.includes(tx.id)
  const toggle = end.outcome === 'answered' ? Toggle(ctx, { key: `open-tx-${tx.id}`, id: tx.id, open: chatWords().hide, closed: viewLabel(tx) }) : null
  return (
    <Box key={`tx-${tx.id}`} flexDirection="column" gap={isOpen ? 1 : 0}>
      {SvgOf(ctx, pic, `tx-pic-${tx.id}`)}
      {toggle === null ? null : <Box flexDirection="row" paddingLeft={TEXT_CELLS}>{toggle}</Box>}
      {isOpen ? <Box paddingLeft={TEXT_CELLS + 1}>{Detail(ctx, tx)}</Box> : null}
    </Box>
  )
}

// An ask past the day's limit: who asks what, then Send answers it once, outside the limit, or Cancel.
export function DraftCard(ctx: Ctx, draft: Draft): RenderElement {
  const { Box, Button, Text } = ctx.ui
  return (
    <Box key={`draft-${draft.qid}`} flexDirection="column" gap={1} paddingX={1} paddingY={1}>
      {StateText(ctx, { key: `draft-head-${draft.qid}`, text: chatWords().asking(firstName(draft.asker)), role: 'warn' })}
      <Text color={ctx.look.hi} wrap="wrap">{draft.question}</Text>
      {ctx.model.canSettleDrafts
        ? (
          <Box flexDirection="row" gap={1}>
            <Button key={`draft-yes-${draft.qid}`} variant="primary" label={chatWords().send} onPress={() => ctx.on.settleDraft(draft.qid, true)} />
            <Button key={`draft-no-${draft.qid}`} label={chatWords().cancel} plain onPress={() => ctx.on.settleDraft(draft.qid, false)} />
          </Box>
        )
        : null}
    </Box>
  )
}
