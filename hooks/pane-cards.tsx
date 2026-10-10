// The cards above the rooms, each one thing to decide: connect this session, an invite, the GitHub question, a
// mailbox just opened, drafts past the day's limit and errors. A card is a title or a sentence and its buttons;
// the long explanations live in Ayarlar. The terminal draws the same words as lines.
import type { RenderElement } from 'claude-code'

import { DraftCard } from './pane-agent'
import { isText, type Ctx } from './pane-kit'
import { Sentence, Title } from './pane-type'
import type { Invite, RoomView } from './state-types'

const CARD_PAD = 2

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

const CONNECT = 'Yazmak için bu oturumda bir kez izin ver.'
const CONNECT_WAITING = 'Yazdıkların bekliyor; göndermek için bu oturumda bir kez izin ver.'

export function ConnectCard(ctx: Ctx): RenderElement {
  const text = ctx.model.waiting.length > 0 ? CONNECT_WAITING : CONNECT
  return Card(ctx, {
    key: 'connect', line: ctx.look.signal.line,
    children: [
      Sentence(ctx, { key: 'connect-body', text }),
      Buttons(ctx, [
        { key: 'connect', label: ctx.model.busy === null ? 'Bağlan' : 'Bağlanıyor…', variant: 'primary', onPress: () => ctx.on.connect() },
        { key: 'connect-later', label: 'Şimdi değil', variant: 'plain', onPress: () => ctx.on.dismissConnect() },
      ]),
    ],
  })
}

const INVITE_DM = 'Kabul edersen birbirinize buradan yazarsınız.'
const INVITE_PROJECT = 'Agent\'lar yalnızca ikiniz de collaborator iseniz konuşur.'

export function InviteCard(ctx: Ctx, inv: Invite): RenderElement {
  const isProject = inv.kind === 'project'
  const title = isProject ? `${inv.repo ?? 'Bir proje'} odasına davet edildin` : 'Biri seninle yazışmak istiyor'
  return Card(ctx, {
    key: `invite-${inv.id}`,
    children: [
      Title(ctx, { key: 'invite-title', text: title }),
      Sentence(ctx, { key: 'invite-body', text: isProject ? INVITE_PROJECT : INVITE_DM }),
      Buttons(ctx, [
        { key: `accept-${inv.id}`, label: 'Kabul et', variant: 'primary', onPress: () => ctx.on.accept(inv.id) },
        { key: `reject-${inv.id}`, label: 'Reddet', onPress: () => ctx.on.reject(inv.id) },
      ]),
    ],
  })
}

const GH_BODY = 'Evet dersen ortak repolarınızda agent\'larınız konuşabilir.'

export function GhCard(ctx: Ctx): RenderElement | null {
  const ask = ctx.model.ghAsk
  if (ask === null) return null
  const repos = ask.repos ?? []
  // What GitHub already said about this login, where the gate asked: a fact to decide on.
  const heard = repos.map(r => `${r.repo.split('/')[1] ?? r.repo}: ${r.isCollaborator ? 'collaborator' : 'değil'}`).join(' · ')
  const pills = repos.length === 0 ? null : Sentence(ctx, { key: 'gh-repos', text: `GitHub'a göre ${heard}`, paint: 'lo' })
  return Card(ctx, {
    key: 'gh',
    children: [
      Title(ctx, { key: 'gh-title', text: `${ask.name} GitHub'da @${ask.gh} mı?` }),
      Sentence(ctx, { key: 'gh-body', text: GH_BODY }),
      pills,
      Buttons(ctx, [
        { key: 'gh-yes', label: 'Evet, o', variant: 'primary', onPress: () => ctx.on.answerGh(true) },
        { key: 'gh-no', label: 'Hayır', onPress: () => ctx.on.answerGh(false) },
      ]),
    ],
  })
}

export function CreatedCard(ctx: Ctx): RenderElement | null {
  const created = ctx.model.created
  if (created === null) return null
  const { Text } = ctx.ui
  return Card(ctx, {
    key: 'created', line: ctx.look.signal.line,
    children: [
      Title(ctx, { key: 'created-title', text: 'Kutun hazır.' }),
      <Text key="created-url" color={ctx.look.signal.fg} wrap="truncate-middle">{created.url}</Text>,
      Buttons(ctx, [
        { key: 'copy-link', label: 'Linki kopyala', variant: 'primary', onPress: () => ctx.on.copy(created.url, ctx.surface) },
        { key: 'created-ok', label: 'Tamam', variant: 'plain', onPress: () => ctx.on.dismissCreated() },
      ]),
    ],
  })
}

// Until the other side has seen one of this mailbox's lines, the steps that let them: share it, send the link.
export function ShareCard(ctx: Ctx, room: RoomView): RenderElement | null {
  if (!room.isUnseen) return null
  const { Text } = ctx.ui
  return Card(ctx, {
    key: 'share', line: ctx.look.signal.line,
    children: [
      Title(ctx, { key: 'share-title', text: 'Arkadaşın bu kutuyu henüz okumadı' }),
      Sentence(ctx, { key: 'share-body', text: 'Linki claude.ai’de aç, Paylaş’tan onun e-postasını ekle, sonra linki ona gönder. O, Transceiver’da “Linkim var”a yapıştırır.', paint: 'lo' }),
      <Text key="share-url" color={ctx.look.signal.fg} wrap="truncate-middle">{room.url}</Text>,
      Buttons(ctx, [{ key: `share-copy-${room.id}`, label: 'Linki kopyala', variant: 'primary', onPress: () => ctx.on.copy(room.url, ctx.surface) }]),
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
