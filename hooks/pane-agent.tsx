// Agent traffic on the desktop: one transmission card per query (who asked, the type chip and what, then an inset
// answer row: who answered, tokens, how long, and a compact body), a refusal as one Flare line, an agent's own
// note, and an ask past the day's limit waiting for the person as an Amber card.
import type { RenderElement } from 'claude-code'

import { compactOf, FIRST_ROWS, type Compact } from './answers'
import { ANSWER_PREVIEW_LINES } from './limits'
import { Pic, PX_PER_CELL, type Ctx } from './pane-kit'
import { answerMetaPart, compactPart, denialPart, draftHeadPart, tinyFace, txHeadPart } from './sig-agent'
import { eyebrowPiece, glyphPiece, rowPart, textPiece } from './sig-ui'
import type { Draft, Line } from './state-types'
import { avatarRole, initialsOf } from './theme'
import { firstName, genitive } from './tr'
import { askedArg, joined, messageOf, queryType, type Tx } from './traffic'
import { clockText, secondsText } from './when'

const LEAD = 16
// Inside a card: its border and padding, and the inset's rail.
const CARD_CHROME_PX = 2 * PX_PER_CELL + 2
const INSET_CHROME_PX = 3 * PX_PER_CELL + 4
const WIDE_GUTTER_RATIO = 0.24
// What the Göster button takes beside a compact body.
const MORE_PX = 72

function agentOf(line: Line | undefined, noun = 'agent\'ı'): string {
  if (line === undefined) return `Karşı tarafın ${noun}`
  return line.isMine ? 'Senin agent\'ın' : `${genitive(firstName(line.authorName))} ${noun}`
}

function clipLines(text: string, isOpen: boolean): string {
  const lines = text.split('\n')
  if (isOpen || lines.length <= ANSWER_PREVIEW_LINES) return text
  return `${lines.slice(0, ANSWER_PREVIEW_LINES).join('\n')}\n… ${lines.length - ANSWER_PREVIEW_LINES} satır daha`
}

// How many of a search's or a list's rows hide behind "Göster".
const hiddenOf = (c: Compact): number => (c.kind === 'hits' || c.kind === 'list' ? Math.max(0, c.count - FIRST_ROWS) : 0)
function extraOf(c: Compact): string | undefined {
  if (c.kind === 'hits') return `${c.count} eşleşme`
  return c.kind === 'list' ? `${c.count} ${c.noun}` : undefined
}

function MoreButton(ctx: Ctx, o: { tx: Tx; isOpen: boolean }): RenderElement {
  const { Button } = ctx.ui
  return <Button key={`more-${o.tx.id}`} label={o.isOpen ? 'Gizle' : 'Göster'} plain onPress={() => ctx.on.toggleExpanded(o.tx.id)} />
}

// A compact body with "Göster" at its right (a stat, pills), or its first rows and "+n daha · Göster" under them.
function AnswerBody(ctx: Ctx, o: { tx: Tx; body: string; width: number }): RenderElement[] {
  const { Box, Text } = ctx.ui
  const isOpen = ctx.model.expanded.includes(o.tx.id)
  const c = compactOf(queryType(o.tx), o.body)
  const full = <Text key="body" color={ctx.look.hi} wrap="wrap">{clipLines(c.kind === 'text' ? c.text : o.body, isOpen)}</Text>
  const hidden = hiddenOf(c)
  const part = c.kind === 'text' ? null : compactPart(c, { width: o.width - (hidden === 0 ? MORE_PX : 0), shown: FIRST_ROWS })
  if (part === null) return [full]
  if (hidden === 0) {
    return [<Box key="compact" flexDirection="row" alignItems="center">{Pic(ctx, part)}<Box flexGrow={1} />{MoreButton(ctx, { tx: o.tx, isOpen })}</Box>, ...(isOpen ? [full] : [])]
  }
  const more = <Box key="more" flexDirection="row" gap={1} alignItems="center"><Text color={ctx.look.lo}>{`+${hidden} ${c.kind === 'hits' ? 'eşleşme' : 'satır'} daha ·`}</Text>{MoreButton(ctx, { tx: o.tx, isOpen })}</Box>
  return [Pic(ctx, part, 'compact'), more, ...(isOpen ? [full] : [])]
}

function Answer(ctx: Ctx, o: { tx: Tx; width: number }): RenderElement {
  const { Box } = ctx.ui
  const a = joined(o.tx)
  const isMine = a?.line.isMine === true
  const rail = isMine ? ctx.look.signal.line : ctx.look.role.run.line
  if (a === null) return <Box key="inset" backgroundColor={ctx.look.inset} paddingX={1} paddingY={1}>{Pic(ctx, rowPart({ width: o.width, height: 18, left: [textPiece('Cevap bekleniyor…', { size: 11.5, paint: 'lo' })], alt: 'Cevap bekleniyor' }))}</Box>
  const who = isMine ? 'Bu makine cevapladı' : agentOf(a.line, a.tokens > 0 ? 'agent\'ı' : 'makinesi')
  const q = o.tx.query === undefined ? null : messageOf(o.tx.query)
  const c = compactOf(queryType(o.tx), a.body)
  const meta = answerMetaPart({ width: o.width, who, tokens: a.tokens, extra: extraOf(c) ?? (q === null ? undefined : secondsText(a.ts - q.ts)), right: clockText(a.ts) })
  return (
    <Box key="inset" backgroundColor={ctx.look.inset} paddingX={1} paddingY={1}>
      <Box flexDirection="column" borderStyle="quote" borderColor={rail} paddingLeft={1} gap={0} flexGrow={1}>
        {Pic(ctx, meta, 'answer-meta')}
        {AnswerBody(ctx, { tx: o.tx, body: a.body, width: o.width })}
      </Box>
    </Box>
  )
}

function leadOf(line: Line | undefined) {
  if (line === undefined || line.isMine) return glyphPiece('robot', { size: LEAD, paint: 'run', stroke: 1.5 })
  return tinyFace({ initials: initialsOf(line.authorName), paint: avatarRole(line.seed), size: LEAD })
}

// 🔒 Alperen'in agent'ı .env istedi ··· erişim yok 14:21
function DenialRow(ctx: Ctx, o: { tx: Tx; ts: number; width: number }): RenderElement {
  const type = queryType(o.tx)
  const arg = askedArg(o.tx)
  const who = type === 'ask' ? `${agentOf(o.tx.query)} soru sordu` : agentOf(o.tx.query)
  return Pic(ctx, denialPart({ width: o.width, who, what: type === 'ask' ? undefined : arg ?? type, time: clockText(o.ts) }), `tx-${o.tx.id}`)
}

// Mine lean right and theirs left in the wide pane, as bubbles do; the narrow pane gives every card its width.
function placeOf(ctx: Ctx, tx: Tx): { pad: { paddingLeft?: number; paddingRight?: number }; columns: number } {
  if (!ctx.isWide) return { pad: {}, columns: ctx.columns }
  const gutter = Math.round(ctx.columns * WIDE_GUTTER_RATIO)
  return { pad: tx.query?.isMine === true ? { paddingLeft: gutter } : { paddingRight: gutter }, columns: ctx.columns - gutter }
}

export function TxCard(ctx: Ctx, tx: Tx): RenderElement {
  const { Box, Text } = ctx.ui
  const a = joined(tx)
  const where = placeOf(ctx, tx)
  const px = where.columns * PX_PER_CELL
  if (a?.isDenied === true) return <Box key={`tx-${tx.id}`} {...where.pad}>{DenialRow(ctx, { tx, ts: a.ts, width: px })}</Box>
  const q = tx.query === undefined ? null : messageOf(tx.query)
  const type = queryType(tx)
  const arg = askedArg(tx)
  const head = txHeadPart({
    width: px - CARD_CHROME_PX, lead: leadOf(tx.query), eyebrow: `${agentOf(tx.query)} sordu`, type,
    arg: type === 'ask' ? undefined : arg, time: q === null ? '' : clockText(q.ts),
  })
  const border = tx.query?.isMine === true ? ctx.look.role.run.line : ctx.look.line
  return (
    <Box key={`tx-${tx.id}`} {...where.pad}>
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={border} backgroundColor={ctx.look.card}>
        <Box paddingX={1} paddingTop={1}>{Pic(ctx, head, 'tx-head')}</Box>
        {type === 'ask' && arg !== undefined ? <Box paddingX={1}><Text color={ctx.look.hi} wrap="wrap">{arg}</Text></Box> : null}
        {Answer(ctx, { tx, width: px - INSET_CHROME_PX })}
      </Box>
    </Box>
  )
}

// A note an agent posted with the send tool: an Iris card with no question.
export function AgentNote(ctx: Ctx, line: Line): RenderElement {
  const { Box, Text } = ctx.ui
  const m = messageOf(line)
  const head = rowPart({ width: ctx.px - CARD_CHROME_PX, height: 20, left: [leadOf(line), eyebrowPiece(`${agentOf(line)} yazdı`, { paint: 'run' })], right: [textPiece(m === null ? '' : clockText(m.ts), { size: 11, paint: 'lo' })], alt: `${agentOf(line)} yazdı` })
  return (
    <Box key={`msg-${line.id}`} flexDirection="column" borderStyle="round" borderColor={ctx.look.role.run.line} backgroundColor={ctx.look.card} paddingX={1} paddingY={1}>
      {Pic(ctx, head, 'note-head')}
      <Text color={ctx.look.hi} wrap="wrap">{m?.text ?? ''}</Text>
    </Box>
  )
}

// TASLAK · ONAYINI BEKLİYOR: an ask past the day's limit; Gönder answers it once, outside the limit.
export function DraftCard(ctx: Ctx, draft: Draft): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const warn = ctx.look.role.warn
  const room = ctx.model.rooms.find(r => r.id === draft.roomId)
  const meta = room?.project === undefined ? 'günlük sınır doldu' : `ask ${room.project.askUsed}/${room.project.askLimit} doldu`
  return (
    <Box key={`draft-${draft.qid}`} flexDirection="column" gap={1} borderStyle="round" borderColor={warn.line} backgroundColor={warn.tint} paddingX={1} paddingY={1}>
      {Pic(ctx, draftHeadPart({ width: ctx.px - CARD_CHROME_PX, meta }), 'draft-head')}
      <Text color={ctx.look.mid} wrap="wrap">{`Soru: ${draft.question}`}</Text>
      <Text color={ctx.look.hi} wrap="wrap">{`${genitive(firstName(draft.asker))} agent'ı soruyor. Gönder'e basarsan senin agent'ın bir kez, limitin dışında cevaplar.`}</Text>
      {ctx.model.canSettleDrafts
        ? (
          <Box flexDirection="row" gap={1}>
            <Button key={`draft-yes-${draft.qid}`} variant="primary" label="Gönder" onPress={() => ctx.on.settleDraft(draft.qid, true)} />
            <Button key={`draft-no-${draft.qid}`} variant="secondary" label="Vazgeç" onPress={() => ctx.on.settleDraft(draft.qid, false)} />
          </Box>
        )
        : null}
    </Box>
  )
}
