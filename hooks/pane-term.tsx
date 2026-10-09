// One room on the terminal, as V2-Terminal lays it: an eyebrow line and a status line, day rules, people's lines
// with their time, each transmission as a ◆ block with │ └ rails, a refusal as one ✕ line, a draft as a TASLAK
// block with its hotkeys, then the prompt line and the chips' hotkeys (the sheet as a numbered list).
import type { RenderElement } from 'claude-code'

import { compactOf, FIRST_ROWS, type Compact } from './answers'
import { POLL_OPEN_MS, TIMELINE_LINES } from './limits'
import { firstLineOf, idsOf, isSameRun } from './pane-chat'
import { placeholderOf } from './pane-compose'
import { isHere, receiptTone, type Ctx } from './pane-kit'
import { checkRows, GATE_WORD, passedOf, statusOf } from './pane-words'
import { CHIP_TYPES, isModeType, supportedSpecs } from './query-menu'
import type { Draft, Line, RoomView } from './state-types'
import { avatarRole } from './theme'
import { firstName, genitive } from './tr'
import { askedArg, itemsOf, joined, messageOf, queryType, type Item, type Tx } from './traffic'
import { clockText, dayKey, dayLabel, secondsText } from './when'

const CHIP_KEYS: Record<string, string> = { status: 's', diff: 'd', tests: 't', log: 'l', branch: 'b' }
const SHEET_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'w', 'y', 'z']

const agentOf = (line: Line | undefined, noun = 'agent\'ı') =>
  (line === undefined ? `karşı tarafın ${noun}` : line.isMine ? 'senin agent\'ın' : `${genitive(firstName(line.authorName))} ${noun}`)

function Top(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const status = statusOf(room, { now: ctx.model.now, isHere: isHere(room, ctx.model.now) })
  const link = ctx.model.isConnected ? `bağlı, ${secondsText(POLL_OPEN_MS).replace(',0', '')}` : 'bağlantı bekleniyor'
  const p = room.project
  const rows = checkRows(room)
  const word = GATE_WORD[room.gate]
  const second = p === undefined
    ? [ctx.model.latencyMs === null ? '' : `sinyal ${secondsText(ctx.model.latencyMs)}`, `okundu bilgisi ${ctx.model.settings.isReceiptsOn ? 'açık' : 'kapalı'}`, link]
    : [`ask ${p.askUsed}/${p.askLimit}`, link]
  return (
    <Box key="term-top" flexDirection="column">
      <Text><Text color={ctx.look.signal.fg}>● TRANSCEIVER</Text>{'  '}<Text bold>{room.title}</Text>{'  '}<Text color={ctx.look.lo}>{status?.text.toLocaleLowerCase('tr') ?? ''}</Text></Text>
      <Text>
        {p === undefined ? null : <Text color={ctx.look.role[word.paint as 'ok'].fg ?? ctx.look.lo}>{`${word.glyph} ${word.label.toLocaleLowerCase('tr')} ${passedOf(rows)}/${rows.length}  ·  `}</Text>}
        <Text color={ctx.look.lo}>{second.filter(Boolean).join('  ·  ')}</Text>
      </Text>
      {p === undefined ? null : <Box flexDirection="row"><Button key={`live-${room.id}`} hotkey="c" label={`canlı ${room.isLive ? 'açık' : 'kapalı'}`} plain onPress={() => ctx.on.toggleLive(room.id)} /></Box>}
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

// "göster" opens the whole answer under its block; "gizle" folds it again.
function More(ctx: Ctx, o: { tx: Tx; body: string }): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const isOpen = ctx.model.expanded.includes(o.tx.id)
  return (
    <Box key="more" flexDirection="column" alignItems="flex-start" paddingLeft={2}>
      {isOpen ? <Text wrap="wrap">{o.body}</Text> : null}
      <Button key={`more-${o.tx.id}`} label={isOpen ? 'gizle' : 'göster'} plain onPress={() => ctx.on.toggleExpanded(o.tx.id)} />
    </Box>
  )
}

function TxBlock(ctx: Ctx, tx: Tx): RenderElement {
  const { Box, Text } = ctx.ui
  const a = joined(tx)
  const q = tx.query === undefined ? null : messageOf(tx.query)
  const type = queryType(tx)
  const arg = askedArg(tx)
  if (a?.isDenied === true) {
    const what = type === 'ask' ? 'soru sordu' : `${arg ?? type} istedi`
    return <Box key={`tx-${tx.id}`} flexDirection="row" gap={1}><Text color={ctx.look.role.danger.fg}>{`✕ ${agentOf(tx.query)} ${what} → erişim yok`}</Text><Box flexGrow={1} /><Text color={ctx.look.lo}>{clockText(a.ts)}</Text></Box>
  }
  const rail = a?.line.isMine === true ? ctx.look.signal.line : ctx.look.role.run.line
  const who = a === null ? 'cevap bekleniyor…' : a.line.isMine ? 'bu makine' : agentOf(a.line, a.tokens > 0 ? 'agent\'ı' : 'makinesi')
  const tokens = a === null ? '' : a.tokens > 0 ? ` · ${a.tokens} token` : ' · 0 token'
  return (
    <Box key={`tx-${tx.id}`} flexDirection="column">
      <Box flexDirection="row" gap={1}><Text color={ctx.look.role.run.fg}>{`◆ ${agentOf(tx.query)} sordu`}</Text><Text color={ctx.look.lo}>{`[${type}]`}</Text><Box flexGrow={1} /><Text color={ctx.look.lo}>{q === null ? '' : clockText(q.ts)}</Text></Box>
      {arg === undefined ? null : <Text><Text color={rail}>│ </Text>{arg}</Text>}
      <Text><Text color={rail}>└ </Text>{who}<Text color={a !== null && a.tokens === 0 ? ctx.look.signal.fg : ctx.look.lo}>{tokens}</Text></Text>
      {a === null ? null : <Text wrap="truncate-end">{`  ${compactText(compactOf(type, a.body))}`}</Text>}
      {a === null ? null : More(ctx, { tx, body: a.body })}
    </Box>
  )
}

function DraftBlock(ctx: Ctx, draft: Draft): RenderElement {
  const { Box, Button, Text } = ctx.ui
  return (
    <Box key={`draft-${draft.qid}`} flexDirection="column">
      <Text><Text color={ctx.look.role.warn.fg}>● TASLAK</Text>{` ${draft.question}`}</Text>
      <Text color={ctx.look.lo}>{`  ${genitive(firstName(draft.asker))} agent'ı soruyor; Gönder bir kez, limitin dışında cevaplar.`}</Text>
      {ctx.model.canSettleDrafts
        ? <Box flexDirection="row" gap={2} paddingLeft={2}>
          <Button key={`draft-yes-${draft.qid}`} hotkey="g" label="Gönder" variant="primary" onPress={() => ctx.on.settleDraft(draft.qid, true)} />
          <Button key={`draft-no-${draft.qid}`} hotkey="v" label="Vazgeç" onPress={() => ctx.on.settleDraft(draft.qid, false)} />
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
  const chips = room.kind !== 'project' ? [] : supportedSpecs().filter(s => CHIP_TYPES.includes(s.type))
  const sheet = room.kind === 'project' && ctx.model.isSheetOpen ? supportedSpecs() : []
  return (
    <Box key="keys" flexDirection="column">
      {sheet.length === 0 ? null : <Text key="sheet-head" color={ctx.look.role.run.fg} bold>{`${room.peerName === undefined ? 'KARŞI TARAFIN' : genitive(room.peerName).toLocaleUpperCase('tr')} AGENT'INA SOR  ·  ${sheet.filter(s => s.type !== 'ask').length} hazır sorgu · 0 token`}</Text>}
      {sheet.map((s, i) => (
        <Box key={`sheet-row-${s.type}`} flexDirection="row" gap={1}>
          <Button key={`sheet-${s.type}`} hotkey={SHEET_KEYS[i]} label={`${s.type}${isModeType(s.type) ? ' …' : ''}`} plain onPress={() => ctx.on.askAgent(room.id, s.type)} />
          <Text color={ctx.look.lo}>{s.desc}</Text>
        </Box>
      ))}
      <Box flexDirection="row" gap={2} flexWrap="wrap">
        {chips.map(s => <Button key={`ask-${s.type}`} hotkey={CHIP_KEYS[s.type]} label={s.type} plain onPress={() => ctx.on.askAgent(room.id, s.type)} />)}
        {room.kind === 'project' ? <Button key={`ask-more-${room.id}`} hotkey="m" label={ctx.model.isSheetOpen ? 'kapat' : 'daha fazla'} plain onPress={() => ctx.on.toggleSheet(room.id)} /> : null}
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
      {ctx.model.isConnected ? null : <Box key="connect-banner" flexDirection="row" gap={1}><Text color={ctx.look.role.warn.fg}>◷ bağlantı bekleniyor; yazdıkların sırada.</Text><Button key="connect-inline" label={ctx.model.waiting.length > 0 ? 'Bağlan ve gönder' : 'Bağlan'} variant="primary" onPress={() => ctx.on.connect()} /></Box>}
      {rule}
      {Prompt(ctx, room)}
      {Keys(ctx, room)}
    </Box>
  )
}
