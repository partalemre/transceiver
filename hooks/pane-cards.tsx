// The cards above the rooms: the empty state ("Telsizini aç"), connect this session (with what waits), invites,
// the GitHub question (with what the gate heard per repo), a room just opened, drafts past the day's limit and
// errors. Desktop cards are Box frames with an Svg head; the terminal draws the same words as lines.
import type { RenderElement } from 'claude-code'

import { DraftCard } from './pane-agent'
import { isText, Pic, PX_PER_CELL, type Ctx } from './pane-kit'
import { radioArtPart, repoPillsPart, stepsPart, cardHeadPart, metaLinePart, tilePart } from './sig-states'
import { linesPart } from './kit/svg-text'
import type { Part } from './kit/svg-core'
import type { Invite } from './state-types'
import { agoText } from './when'

const CARD_PAD = 2
const CARD_CHROME_PX = (CARD_PAD * 2) * PX_PER_CELL + 2
const TILE = 36
const ART_W = 132
const ART_H = 216
const ART_STACK_H = 120
// Below this many px a card stacks the radio over its words.
const ROW_MIN_PX = 420
const MAX_WAITING = 3
const URL_TAIL = 4
// Svg type is measured, not laid out: wrapped lines keep this much px in hand.
const WRAP_SLACK = 28

type Btn = { key: string; label: string; variant?: 'primary' | 'secondary' | 'plain'; onPress: () => void }

function Buttons(ctx: Ctx, buttons: readonly Btn[]): RenderElement {
  const { Box, Button } = ctx.ui
  return (
    <Box key="buttons" flexDirection="row" gap={1} flexWrap="wrap">
      {buttons.map(b => (b.variant === 'plain'
        ? <Button key={b.key} label={b.label} plain onPress={() => b.onPress()} />
        : <Button key={b.key} label={b.label} variant={b.variant ?? 'secondary'} onPress={() => b.onPress()} />))}
    </Box>
  )
}

function Card(ctx: Ctx, o: { key: string; line?: string; children: Array<RenderElement | null> }): RenderElement {
  const { Box } = ctx.ui
  return (
    <Box key={o.key} flexDirection="column" gap={1} borderStyle="round" borderColor={o.line ?? ctx.look.line} backgroundColor={ctx.look.card}
      paddingX={isText(ctx) ? 1 : CARD_PAD} paddingY={isText(ctx) ? 0 : CARD_PAD - 1}>
      {o.children.filter((c): c is RenderElement => c !== null)}
    </Box>
  )
}

const innerOf = (ctx: Ctx) => ctx.px - CARD_CHROME_PX
const body = (ctx: Ctx, text: string, width = innerOf(ctx)): Part => linesPart({ text, width: width - WRAP_SLACK, size: 13.5, weight: 400, lineHeight: 20, paint: 'mid', maxLines: 4 })

// Words as Svg on the desktop, as wrapped text on the terminal.
function Words(ctx: Ctx, o: { key: string; part: Part; text?: string; color?: string }): RenderElement {
  const { Text } = ctx.ui
  if (isText(ctx)) return <Text key={o.key} color={o.color ?? ctx.look.mid} wrap="wrap">{o.text ?? o.part.alt}</Text>
  return Pic(ctx, o.part, o.key)
}

const ONBOARD = 'Arkadaşlarınla Claude\'un içinden yazış. Ortak bir GitHub reposunda agent\'larınız da konuşur, taşıma token harcamaz.'
const STEPS = ['Oda aç', 'Linki e-postayla paylaş', 'Yazış']

// Every first step is a button: no command needs typing. The project and link forms live in "Yeni sohbet".
function startButtons(ctx: Ctx): Btn[] {
  const forms: Btn[] = 'Input' in ctx.ui
    ? [{ key: 'open-add', label: 'Proje odası', onPress: () => ctx.on.openView('add') }, { key: 'open-join', label: 'Linkle katıl', onPress: () => ctx.on.openView('add') }]
    : []
  return [
    { key: 'add-dm', label: 'Arkadaş ekle', variant: 'primary', onPress: () => ctx.on.addDm() },
    ...forms,
    { key: 'open-settings', label: 'Ayarlar', variant: 'plain', onPress: () => ctx.on.openView('settings') },
  ]
}

export function EmptyCard(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  const isRow = innerOf(ctx) >= ROW_MIN_PX
  const textW = isRow ? innerOf(ctx) - ART_W - 2 * PX_PER_CELL : innerOf(ctx)
  const words = [
    Words(ctx, { key: 'empty-head', part: cardHeadPart({ width: textW, eyebrow: 'Başla', paint: 'signal', title: 'Telsizini aç', titleSize: 20 }), text: 'BAŞLA · Telsizini aç', color: ctx.look.signal.fg }),
    Words(ctx, { key: 'empty-body', part: body(ctx, ONBOARD, textW), text: ONBOARD }),
    Words(ctx, { key: 'empty-steps', part: stepsPart({ width: textW, steps: STEPS }), text: STEPS.map((s, i) => `${i + 1} ${s}`).join('  ') }),
    Buttons(ctx, startButtons(ctx)),
  ]
  const art = isText(ctx) ? null : Pic(ctx, radioArtPart({ width: isRow ? ART_W : innerOf(ctx), height: isRow ? ART_H : ART_STACK_H, isLive: true }), 'radio-art')
  return Card(ctx, {
    key: 'empty',
    children: [<Box key="empty-row" flexDirection={isRow ? 'row' : 'column'} gap={2}>{art}<Box flexDirection="column" gap={1} flexGrow={1}>{words}</Box></Box>],
  })
}

const CONNECT = 'Okumak serbest. Yazmak için Claude oturum başına bir kez izin ister; Bağlan\'a basınca o soru gelir, sonra bu oturum boyunca sormaz.'

function WaitingList(ctx: Ctx): RenderElement | null {
  const { Box, Text } = ctx.ui
  const waiting = ctx.model.waiting
  if (waiting.length === 0) return null
  const shown = waiting.slice(-MAX_WAITING)
  const rest = waiting.length - shown.length
  return (
    <Box key="waiting" flexDirection="column" borderStyle="dashed" borderColor={ctx.look.signal.line} backgroundColor={ctx.look.inset} paddingX={1}>
      {rest > 0 ? <Text key="rest" color={ctx.look.lo}>{`+${rest} mesaj daha`}</Text> : null}
      {shown.map((text, i) => (
        <Box key={`wait-${i}`} flexDirection="row" justifyContent="space-between" gap={1}>
          <Text color={ctx.look.hi} wrap="truncate-end">{text}</Text>
          <Text color={ctx.look.lo}>bekliyor</Text>
        </Box>
      ))}
    </Box>
  )
}

export function ConnectCard(ctx: Ctx): RenderElement {
  const n = ctx.model.waiting.length
  const busy = ctx.model.busy
  const head = cardHeadPart({ width: innerOf(ctx), lead: tilePart({ glyph: 'link', paint: 'signal', size: TILE }), eyebrow: 'Bu oturum', paint: 'signal', title: 'Bağlan', meta: busy ?? (n > 0 ? `${n} mesaj bekliyor` : undefined) })
  return Card(ctx, {
    key: 'connect', line: ctx.look.signal.line,
    children: [
      Words(ctx, { key: 'connect-head', part: head, text: `BU OTURUM · Bağlan${n > 0 ? ` · ${n} mesaj bekliyor` : ''}`, color: ctx.look.signal.fg }),
      Words(ctx, { key: 'connect-body', part: body(ctx, CONNECT), text: CONNECT }),
      WaitingList(ctx),
      Buttons(ctx, [
        { key: 'connect', label: busy !== null ? 'Bağlanıyor…' : n > 0 ? 'Bağlan ve gönder' : 'Bağlan', variant: 'primary', onPress: () => ctx.on.connect() },
        { key: 'connect-later', label: 'Şimdi değil', variant: 'plain', onPress: () => ctx.on.dismissConnect() },
      ]),
    ],
  })
}

const shortUrl = (url: string | undefined) => (url === undefined ? '' : `claude.ai/artifact/…${(url.replace(/\/+$/, '').split('/').at(-1) ?? '').slice(-URL_TAIL)}`)
const INVITE_DM = 'Kabul edersen birbirinize buradan yazarsınız. Projelerin, oturumların ve klasörlerin hakkında hiçbir şey paylaşılmaz.'
const INVITE_PROJECT = 'Kabul edersen bu reponun odasına katılırsın. Agent\'lar yalnızca ikiniz de collaborator iseniz ve GitHub adını onaylarsan konuşur.'

export function InviteCard(ctx: Ctx, inv: Invite): RenderElement {
  const isProject = inv.kind === 'project'
  const title = isProject ? `${inv.repo ?? 'Bir proje'} odasına davet edildin` : 'Biri seninle yazışmak istiyor'
  const lead = tilePart({ glyph: isProject ? 'branch' : 'person', paint: 'read', size: TILE })
  const meta = [shortUrl(inv.url), isProject ? 'Proje odası' : 'Doğrudan mesaj', inv.joinedAt === undefined ? '' : agoText(inv.joinedAt, ctx.model.now)].filter(Boolean).join(' · ')
  const words = isProject ? INVITE_PROJECT : INVITE_DM
  return Card(ctx, {
    key: `invite-${inv.id}`,
    children: [
      Words(ctx, { key: 'invite-head', part: cardHeadPart({ width: innerOf(ctx), lead, eyebrow: 'Yeni davet', paint: 'read', title }), text: `YENİ DAVET · ${title}`, color: ctx.look.role.read.fg }),
      Words(ctx, { key: 'invite-body', part: body(ctx, words), text: words }),
      Words(ctx, { key: 'invite-meta', part: metaLinePart({ width: innerOf(ctx), glyph: 'doc', text: meta }), text: meta, color: ctx.look.lo }),
      Buttons(ctx, [
        { key: `accept-${inv.id}`, label: 'Kabul et', variant: 'primary', onPress: () => ctx.on.accept(inv.id) },
        { key: `reject-${inv.id}`, label: 'Reddet', onPress: () => ctx.on.reject(inv.id) },
      ]),
    ],
  })
}

const GH_BODY = 'Evet dersen ortak repolarınızda agent\'larınız konuşabilir. Collaborator olmadığı repolar kapalı kalır.'

export function GhCard(ctx: Ctx): RenderElement | null {
  const ask = ctx.model.ghAsk
  if (ask === null) return null
  const title = `${ask.name} GitHub'da @${ask.gh} mı?`
  const lead = tilePart({ glyph: 'person', paint: 'mid', tint: 'track', line: 'line', size: TILE })
  const repos = ask.repos ?? []
  return Card(ctx, {
    key: 'gh',
    children: [
      Words(ctx, { key: 'gh-head', part: cardHeadPart({ width: innerOf(ctx), lead, eyebrow: 'GITHUB EŞLEŞMESİ · BİR KEZ', paint: 'lo', title }), text: `GITHUB EŞLEŞMESİ · ${title}` }),
      Words(ctx, { key: 'gh-body', part: body(ctx, GH_BODY), text: GH_BODY }),
      repos.length === 0 ? null : Words(ctx, { key: 'gh-repos', part: repoPillsPart({ width: innerOf(ctx), repos }) }),
      Buttons(ctx, [
        { key: 'gh-yes', label: 'Evet, o', variant: 'primary', onPress: () => ctx.on.answerGh(true) },
        { key: 'gh-no', label: 'Hayır', onPress: () => ctx.on.answerGh(false) },
      ]),
    ],
  })
}

const CREATED = '1 · Linki claude.ai\'de aç, Paylaş\'a bas, arkadaşının e-postasını yaz. 2 · Linki ona gönder: Transceiver\'ı açınca davet kendiliğinden görünür.'

export function CreatedCard(ctx: Ctx): RenderElement | null {
  const created = ctx.model.created
  if (created === null) return null
  const { Text } = ctx.ui
  const head = cardHeadPart({ width: innerOf(ctx), lead: tilePart({ glyph: 'signal', paint: 'signal', size: TILE }), eyebrow: 'Oda hazır', paint: 'signal', title: 'Şimdi arkadaşını davet et' })
  return Card(ctx, {
    key: 'created', line: ctx.look.signal.line,
    children: [
      Words(ctx, { key: 'created-head', part: head, text: 'ODA HAZIR · Şimdi arkadaşını davet et', color: ctx.look.signal.fg }),
      Words(ctx, { key: 'created-body', part: body(ctx, CREATED), text: CREATED }),
      <Text key="created-url" color={ctx.look.signal.fg} wrap="truncate-middle">{created.url}</Text>,
      Buttons(ctx, [
        { key: 'copy-link', label: 'Linki kopyala', variant: 'primary', onPress: () => ctx.on.copy(created.url, ctx.surface) },
        { key: 'created-ok', label: 'Tamam', variant: 'plain', onPress: () => ctx.on.dismissCreated() },
      ]),
    ],
  })
}

export function ErrorCard(ctx: Ctx): RenderElement | null {
  const { Box, Button, Text } = ctx.ui
  const error = ctx.model.error
  if (error === null) return null
  const danger = ctx.look.role.danger
  return (
    <Box key="error" flexDirection="row" alignItems="center" gap={1} borderStyle={isText(ctx) ? 'single' : 'round'} borderColor={danger.line} backgroundColor={danger.tint} paddingX={1}>
      <Text color={danger.fg} wrap="wrap">{error}</Text>
      <Box flexGrow={1} />
      <Button key="error-ok" label="Kapat" variant="secondary" onPress={() => ctx.on.dismissError()} />
    </Box>
  )
}

// Every card that applies, most urgent first: an error, then what waits on the person. A draft of the open
// room shows in its timeline instead.
export function Cards(ctx: Ctx): RenderElement[] {
  const m = ctx.model
  const openId = m.view === 'chat' ? m.activeId : null
  const cards: Array<RenderElement | null> = [
    ErrorCard(ctx),
    CreatedCard(ctx),
    m.needsSetup ? ConnectCard(ctx) : null,
    ...m.invites.map(inv => InviteCard(ctx, inv)),
    GhCard(ctx),
    ...m.drafts.filter(d => d.roomId !== openId).map(d => DraftCard(ctx, d)),
  ]
  return cards.filter((c): c is RenderElement => c !== null)
}
