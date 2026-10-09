// One room on the terminal, the conversation first: the name and presence, one notice line only when something is
// wrong, the room's details only when asked, day rules, people's lines with their time, each agent exchange as one
// ◆ line that opens on press (a refusal as one ✕ line), a draft with its hotkeys, then the prompt line and its
// keys: the sheet of queries, the details and the way back.
import type { RenderElement } from 'claude-code'

import { compactOf, FIRST_ROWS, type Compact } from './answers'
import { TIMELINE_LINES } from './limits'
import { fullIdOf } from './pane-agent'
import { RoomInfo } from './pane-aside'
import { firstLineOf, idsOf, isSameRun } from './pane-chat'
import { placeholderOf } from './pane-compose'
import { isHere, receiptTone, type Ctx } from './pane-kit'
import { noticeOf, statusOf } from './pane-words'
import { isModeType, supportedSpecs } from './query-menu'
import type { Draft, Line, RoomView } from './state-types'
import { avatarRole } from './theme'
import { firstName, genitive } from './tr'
import { askedArg, itemsOf, joined, messageOf, queryType, type Item, type Tx } from './traffic'
import { agentOf, txSummary } from './tx-words'
import { clockText, dayKey, dayLabel } from './when'

const SHEET_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'w', 'y', 'z']

// Who answered: this machine, the peer's agent (or, at 0 tokens, their machine).
function answererOf(a: NonNullable<ReturnType<typeof joined>>): string {
  return a.line.isMine ? 'bu makine' : agentOf(a.line, a.tokens > 0 ? 'agent\'ı' : 'makinesi')
}

// What is wrong, in one line, and "neden?" when the room's details explain it.
function NoticeLine(ctx: Ctx, room: RoomView): RenderElement | null {
  const { Box, Button, Text } = ctx.ui
  const notice = noticeOf(room)
  if (notice === null) return null
  return (
    <Box key="notice" flexDirection="row" gap={1}>
      <Text color={ctx.look.role[notice.paint].fg} wrap="wrap">{notice.text}</Text>
      {notice.hasWhy && !ctx.model.isInfoOpen ? <Button key={`why-${room.id}`} label="neden?" plain onPress={() => ctx.on.toggleInfo(room.id)} /> : null}
    </Box>
  )
}

function Top(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Text } = ctx.ui
  const status = statusOf(room, { now: ctx.model.now, isHere: isHere(room, ctx.model.now) })
  return (
    <Box key="term-top" flexDirection="column">
      <Text><Text bold>{room.title}</Text>{status === null ? '' : '  '}<Text color={status?.isHere === true ? ctx.look.role.ok.fg : ctx.look.lo}>{status?.text ?? ''}</Text></Text>
      {NoticeLine(ctx, room)}
      {ctx.model.isInfoOpen ? RoomInfo(ctx, room) : null}
    </Box>
  )
}

// A reply's quote above it, a shared room's link under it.
function Extras(ctx: Ctx, line: Line): RenderElement[] {
  const { Box, Button, Text } = ctx.ui
  const link = line.roomLink
  return [
    ...(line.replyTo === undefined ? [] : [<Text key="quote" color={ctx.look.lo} wrap="truncate-end">{`  ↳ ${line.replyTo.name}: ${line.replyTo.text}`}</Text>]),
    ...(link === undefined ? [] : [<Box key="room-link" flexDirection="row" gap={1}><Text color={ctx.look.role.run.fg}>{`  ⌥ ${link.repo}`}</Text><Button key={`goto-${line.id}`} label="Odaya git" plain onPress={() => ctx.on.select(link.roomId)} /></Box>]),
  ]
}

function HumanLine(ctx: Ctx, o: { line: Line; isFirst: boolean }): RenderElement {
  const { Box, Text } = ctx.ui
  const m = messageOf(o.line)
  const name = o.line.isMine ? 'sen' : firstName(o.line.authorName)
  const color = o.line.isMine ? ctx.look.signal.fg : ctx.look.role[avatarRole(o.line.seed)].fg
  const tick = o.line.receipt === undefined ? null : receiptTone(ctx, o.line.receipt)
  const [quote, link] = [o.line.replyTo, o.line.roomLink]
  const extras = Extras(ctx, o.line)
  const row = (
    <Box key="row" flexDirection="row" gap={1}>
      <Text color={color} bold>{o.isFirst ? name : ' '.repeat(name.length)}</Text>
      <Box flexGrow={1}><Text wrap="wrap">{m?.text ?? 'okunamayan mesaj'}</Text></Box>
      <Text color={ctx.look.lo}>{m === null ? '' : clockText(m.ts)}</Text>
      {tick === null ? null : <Text color={tick.color}>{tick.glyph}</Text>}
    </Box>
  )
  if (quote === undefined && link === undefined) return <Box key={`msg-${o.line.id}`} flexDirection="column">{row}</Box>
  return <Box key={`msg-${o.line.id}`} flexDirection="column">{extras.slice(0, quote === undefined ? 0 : 1)}{row}{extras.slice(quote === undefined ? 0 : 1)}</Box>
}

function compactText(c: Compact): string {
  if (c.kind === 'diff') return `${c.stat.files} dosya +${c.stat.added} −${c.stat.removed}`
  if (c.kind === 'tests') return `✓ ${c.passed} geçti · ${c.failed} kaldı`
  if (c.kind === 'hits') return `${c.count} eşleşme · ${c.rows.slice(0, FIRST_ROWS).map(h => h.loc).join(', ')}`
  if (c.kind === 'list') return `${c.count} ${c.noun} · ${c.items.slice(0, FIRST_ROWS).join(', ')}`
  if (c.kind === 'tags') return c.tags.map(t => `${t.tag} ${t.count}`).join(' · ')
  if (c.kind === 'commit') return `${c.subject}${c.stat === null ? '' : ` · ${c.stat.files} dosya +${c.stat.added} −${c.stat.removed}`}`
  return c.text.split('\n').find(r => r.trim() !== '')?.trim() ?? ''
}

// "tamamı" opens the whole answer under its exchange; "gizle" folds it again.
function More(ctx: Ctx, o: { tx: Tx; body: string }): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const id = fullIdOf(o.tx.id)
  const isOpen = ctx.model.expanded.includes(id)
  return (
    <Box key="more" flexDirection="column" alignItems="flex-start" paddingLeft={2}>
      {isOpen ? <Text wrap="wrap">{o.body}</Text> : null}
      <Button key={`more-${o.tx.id}`} label={isOpen ? 'gizle' : 'tamamı'} plain onPress={() => ctx.on.toggleExpanded(id)} />
    </Box>
  )
}

// An opened exchange: the question, who answered at what cost, the compact answer and its whole text.
function TxDetail(ctx: Ctx, tx: Tx): RenderElement[] {
  const { Text } = ctx.ui
  const a = joined(tx)
  const rail = a?.line.isMine === true ? ctx.look.signal.line : ctx.look.role.run.line
  const arg = askedArg(tx)
  const question = arg === undefined ? [] : [<Text key="question"><Text color={rail}>│ </Text>{arg}</Text>]
  if (a === null) return [...question, <Text key="waiting" color={ctx.look.lo}>{'└ cevap bekleniyor…'}</Text>]
  return [
    ...question,
    <Text key="who"><Text color={rail}>└ </Text>{answererOf(a)}<Text color={a.tokens === 0 ? ctx.look.signal.fg : ctx.look.lo}>{` · ${a.tokens} token`}</Text></Text>,
    <Text key="compact" wrap="truncate-end">{`  ${compactText(compactOf(queryType(tx), a.body))}`}</Text>,
    More(ctx, { tx, body: a.body }),
  ]
}

function TxBlock(ctx: Ctx, tx: Tx): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const s = txSummary(tx)
  const isDenied = s.outcome === 'denied'
  const isOpen = !isDenied && ctx.model.expanded.includes(tx.id)
  return (
    <Box key={`tx-${tx.id}`} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text color={isDenied ? ctx.look.role.danger.fg : ctx.look.role.run.fg} wrap="truncate-end">{`${isDenied ? '✕' : '◆'} ${s.text}`}</Text>
        </Box>
        {isDenied ? null : <Button key={`open-tx-${tx.id}`} label={isOpen ? 'gizle' : 'göster'} plain onPress={() => ctx.on.toggleExpanded(tx.id)} />}
      </Box>
      {isOpen ? TxDetail(ctx, tx) : null}
    </Box>
  )
}

function DraftBlock(ctx: Ctx, draft: Draft): RenderElement {
  const { Box, Button, Text } = ctx.ui
  return (
    <Box key={`draft-${draft.qid}`} flexDirection="column">
      <Text color={ctx.look.role.warn.fg}>{`● ${genitive(firstName(draft.asker))} agent'ı soruyor · onayını bekliyor`}</Text>
      <Text wrap="wrap">{`  ${draft.question}`}</Text>
      {ctx.model.canSettleDrafts
        ? <Box flexDirection="row" gap={2} paddingLeft={2}>
          <Button key={`draft-yes-${draft.qid}`} hotkey="g" label="Gönder" variant="primary" onPress={() => ctx.on.settleDraft(draft.qid, true)} />
          <Button key={`draft-no-${draft.qid}`} hotkey="v" label="Vazgeç" plain onPress={() => ctx.on.settleDraft(draft.qid, false)} />
        </Box>
        : null}
    </Box>
  )
}

function itemsEls(ctx: Ctx, items: Item[]): RenderElement[] {
  const { Text } = ctx.ui
  const out: RenderElement[] = []
  const divider = ctx.model.divider
  items.forEach((item, i) => {
    const ts = messageOf(firstLineOf(item) as Line)?.ts ?? 0
    const prev = i > 0 ? messageOf(firstLineOf(items[i - 1] as Item) as Line)?.ts ?? 0 : null
    if (prev === null || dayKey(prev) !== dayKey(ts)) out.push(<Text key={`day-${idsOf(item)[0] ?? i}`} color={ctx.look.line}>{`──── ${dayLabel(ts, ctx.model.now).toLocaleLowerCase('tr')} ────`}</Text>)
    if (divider !== null && idsOf(item).includes(divider.id)) out.push(<Text key="new-rule" color={ctx.look.signal.fg}>{`──── ${divider.count} yeni mesaj ────`}</Text>)
    out.push(item.kind === 'tx' ? TxBlock(ctx, item) : HumanLine(ctx, { line: item.line, isFirst: !isSameRun(items[i - 1], item) }))
  })
  return out
}

function Prompt(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const mode = ctx.model.composeMode
  const Field = 'Input' in ctx.ui ? ctx.ui.Input : null
  const input = Field !== null
    ? <Field key={`composer-${room.id}-${ctx.model.composerKey}`} placeholder={placeholderOf(room, mode)} submitLabel={mode === null ? 'gönder' : 'sor'} onInput={v => ctx.on.type(room.id, v)} onSubmit={v => ctx.on.send(room.id, v)} />
    : <Text color={ctx.look.lo}>{placeholderOf(room, mode)}</Text>
  return (
    <Box key="prompt" flexDirection="row" gap={1} alignItems="center">
      <Text color={ctx.look.signal.fg}>›</Text>
      {mode === null ? null : <Text color={ctx.look.role.run.fg}>{`[${mode}]`}</Text>}
      {mode === null ? null : <Button key="mode-clear" hotkey="x" label="normal" plain onPress={() => ctx.on.clearMode()} />}
      <Box flexGrow={1}>{input}</Box>
    </Box>
  )
}

function Keys(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const isProject = room.kind === 'project'
  const sheet = isProject && ctx.model.isSheetOpen ? supportedSpecs() : []
  return (
    <Box key="keys" flexDirection="column">
      {sheet.map((s, i) => (
        <Box key={`sheet-row-${s.type}`} flexDirection="row" gap={1}>
          <Button key={`sheet-${s.type}`} hotkey={SHEET_KEYS[i]} label={`${s.type}${isModeType(s.type) ? ' …' : ''}`} plain onPress={() => ctx.on.askAgent(room.id, s.type)} />
          <Text color={ctx.look.lo}>{s.desc}</Text>
        </Box>
      ))}
      <Box flexDirection="row" gap={2} flexWrap="wrap">
        {isProject ? <Button key={`ask-more-${room.id}`} hotkey="a" label={ctx.model.isSheetOpen ? 'kapat' : 'agent\'a sor'} plain onPress={() => ctx.on.toggleSheet(room.id)} /> : null}
        {isProject ? <Button key={`info-${room.id}`} hotkey="i" label={ctx.model.isInfoOpen ? 'ayrıntıları kapat' : 'ayrıntılar'} plain onPress={() => ctx.on.toggleInfo(room.id)} /> : null}
        <Button key="back" hotkey="o" label="‹ odalar" plain onPress={() => ctx.on.back()} />
      </Box>
      {ctx.model.hint === null ? null : <Text color={ctx.look.role.warn.fg} wrap="wrap">{ctx.model.hint}</Text>}
    </Box>
  )
}

export function TermChat(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const items = itemsOf(ctx.model.lines.slice(-TIMELINE_LINES))
  const rule = <Text key="rule" color={ctx.look.line}>{'─'.repeat(Math.max(1, ctx.columns))}</Text>
  return (
    <Box key="chat" flexDirection="column" gap={0}>
      {Top(ctx, room)}
      {items.length === 0 ? <Text key="none" color={ctx.look.lo}>Henüz mesaj yok. İlk mesajı aşağıdan yaz.</Text> : null}
      {itemsEls(ctx, items)}
      {ctx.model.drafts.filter(d => d.roomId === room.id).map(d => DraftBlock(ctx, d))}
      {ctx.model.error === null ? null : <Text key="error" color={ctx.look.role.danger.fg} wrap="wrap">{`✕ ${ctx.model.error}`}</Text>}
      {ctx.model.isConnected ? null : <Box key="connect-banner" flexDirection="row" gap={1}><Text color={ctx.look.role.warn.fg}>◷ bağlantı bekleniyor; yazdıkların sırada.</Text><Button key="connect-inline" label="Bağlan" variant="primary" onPress={() => ctx.on.connect()} /></Box>}
      {rule}
      {Prompt(ctx, room)}
      {Keys(ctx, room)}
    </Box>
  )
}
