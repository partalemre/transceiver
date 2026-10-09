// The cards above the rooms: connect this session, invites, the GitHub question, a room just opened, asks past the
// day's limit, and errors. Each is one Frame: header, one sentence, at most one primary button.
import type { RenderElement } from 'claude-code'

import { ButtonRow } from './kit/ui'
import type { ButtonSpec } from './kit/ui'
import { Frame, Head, type Ctx, type HeadSpec } from './pane-kit'
import type { Draft, Invite } from './state-types'

const QUESTION_CHARS = 120

function Card(ctx: Ctx, o: { key: string; head: HeadSpec; buttons: ButtonSpec[]; isDanger?: boolean; extra?: RenderElement | null }): RenderElement {
  return Frame(ctx, {
    key: o.key, tone: o.head.tone, isDanger: o.isDanger,
    children: [Head(ctx, o.head), o.extra ?? null, ButtonRow(ctx.ui, ctx.surface, ctx.look.isLight, { buttons: o.buttons })],
  })
}

export function ConnectCard(ctx: Ctx): RenderElement {
  const isBusy = ctx.model.busy !== null
  return Card(ctx, {
    key: 'connect',
    head: {
      glyph: 'plug', tone: 'signal', eyebrow: 'Bu oturum', meta: isBusy ? ctx.model.busy ?? '' : undefined,
      headline: 'Bağlan ve yazmaya başla',
      sub: 'Mesaj göndermek için Claude bu oturumda bir kez onay ister. Okumak onaysız çalışır; o zamana kadar yazdıkların sırada bekler.',
    },
    buttons: [
      { key: 'connect', label: isBusy ? 'Bağlanıyor…' : 'Bağlan', variant: 'primary', onPress: () => ctx.on.connect() },
      { key: 'connect-later', label: 'Şimdi değil', variant: 'plain', onPress: () => ctx.on.dismissConnect() },
    ],
  })
}

export function InviteCard(ctx: Ctx, inv: Invite): RenderElement {
  const isProject = inv.kind === 'project'
  return Card(ctx, {
    key: `invite-${inv.id}`,
    head: {
      glyph: isProject ? 'branch' : 'bell', tone: 'read', eyebrow: isProject ? 'Proje daveti' : 'Davet',
      headline: isProject ? `${inv.repo ?? 'Bir proje'} odasına davet edildin` : 'Biri seninle yazışmak istiyor',
      sub: 'Kabul edersen yazışabilirsiniz. Oturumların, klasörlerin ve repoların hakkında hiçbir şey paylaşılmaz.',
    },
    buttons: [
      { key: `accept-${inv.id}`, label: 'Kabul et', variant: 'primary', onPress: () => ctx.on.accept(inv.id) },
      { key: `reject-${inv.id}`, label: 'Reddet', variant: 'secondary', onPress: () => ctx.on.reject(inv.id) },
    ],
  })
}

export function GhCard(ctx: Ctx): RenderElement | null {
  const ask = ctx.model.ghAsk
  if (ask === null) return null
  return Card(ctx, {
    key: 'gh',
    head: {
      glyph: 'shield', tone: 'ok', eyebrow: 'GitHub eşleşmesi',
      headline: `${ask.name} GitHub'da ${ask.gh} mi?`,
      sub: 'Evet dersen ortak repolarınızda agent\'larınız konuşabilir. Collaborator olmadığı repolar kapalı kalır.',
    },
    buttons: [
      { key: 'gh-yes', label: 'Evet, o', variant: 'primary', onPress: () => ctx.on.answerGh(true) },
      { key: 'gh-no', label: 'Hayır', variant: 'secondary', onPress: () => ctx.on.answerGh(false) },
    ],
  })
}

export function CreatedCard(ctx: Ctx): RenderElement | null {
  const created = ctx.model.created
  if (created === null) return null
  const { Text } = ctx.ui
  return Card(ctx, {
    key: 'created',
    head: {
      glyph: 'radio', tone: 'signal', eyebrow: 'Oda hazır', headline: 'Şimdi arkadaşını davet et',
      sub: '1 · Linki claude.ai\'de aç, Paylaş\'a bas, arkadaşının e-postasını yaz. 2 · Linki ona gönder: Transceiver\'ı açınca davet kendiliğinden görünür.',
    },
    extra: <Text key="created-url" color={ctx.look.signal.fg} wrap="truncate-middle">{created.url}</Text>,
    buttons: [
      { key: 'copy-link', label: 'Linki kopyala', variant: 'primary', onPress: e => ctx.on.copy(created.url, e.surface) },
      { key: 'created-ok', label: 'Tamam', variant: 'plain', onPress: () => ctx.on.dismissCreated() },
    ],
  })
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export function DraftCard(ctx: Ctx, draft: Draft): RenderElement {
  const buttons: ButtonSpec[] = ctx.model.canSettleDrafts
    ? [
        { key: `draft-yes-${draft.qid}`, label: 'Cevapla', variant: 'primary', onPress: () => ctx.on.settleDraft(draft.qid, true) },
        { key: `draft-no-${draft.qid}`, label: 'Reddet', variant: 'secondary', onPress: () => ctx.on.settleDraft(draft.qid, false) },
      ]
    : []
  return Card(ctx, {
    key: `draft-${draft.qid}`,
    head: {
      glyph: 'clock', tone: 'warn', eyebrow: 'Günlük soru limiti doldu', meta: draft.asker,
      headline: clip(draft.question, QUESTION_CHARS),
      sub: 'Bu soru senin onayını bekliyor. Cevaplarsan agent bir kez, limitin dışında çalışır.',
    },
    buttons,
  })
}

export function ErrorCard(ctx: Ctx): RenderElement | null {
  const error = ctx.model.error
  if (error === null) return null
  return Card(ctx, {
    key: 'error', isDanger: true,
    head: { glyph: 'x', tone: 'danger', eyebrow: 'Hata', headline: error },
    buttons: [{ key: 'error-ok', label: 'Kapat', variant: 'secondary', onPress: () => ctx.on.dismissError() }],
  })
}

// Every card that applies, most urgent first: an error, then what waits on the person.
export function Cards(ctx: Ctx): RenderElement[] {
  const m = ctx.model
  const cards: Array<RenderElement | null> = [
    ErrorCard(ctx),
    CreatedCard(ctx),
    m.needsSetup ? ConnectCard(ctx) : null,
    ...m.invites.map(inv => InviteCard(ctx, inv)),
    GhCard(ctx),
    ...m.drafts.map(d => DraftCard(ctx, d)),
  ]
  return cards.filter((c): c is RenderElement => c !== null)
}

