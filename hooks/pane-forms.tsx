// The two views besides rooms and chat: "Yeni sohbet" (a DM, a project room, joining by link) and "Ayarlar"
// (read receipts, toasts, the status line, and this session's connection).
import type { RenderElement } from 'claude-code'

import { WAITING } from './connection'
import { ButtonRow } from './kit/ui'
import { ErrorCard } from './pane-cards'
import { Frame, Head, isText, Meta, pxOf, SvgOf, type Ctx } from './pane-kit'
import { chipPart, sigPic, switchPart } from './sig'
import type { PaneSettings } from './state-types'

function BackRow(ctx: Ctx, o: { eyebrow: string; title: string }): RenderElement {
  const { Box, Button } = ctx.ui
  return (
    <Box key="back-row" flexDirection="column" gap={1}>
      <Box flexDirection="row"><Button key="back" label="‹ Odalar" plain onPress={() => ctx.on.back()} /></Box>
      {Head(ctx, { glyph: 'radio', tone: 'signal', eyebrow: o.eyebrow, headline: o.title, meta: ctx.model.busy ?? '', width: pxOf(ctx.columns) })}
    </Box>
  )
}

type FieldOpts = { key: string; placeholder: string; submit: string; value?: string; onSubmit: (v: string) => void }

function Field(ctx: Ctx, o: FieldOpts): RenderElement | null {
  if (!('Input' in ctx.ui)) return null
  const { Input } = ctx.ui
  return <Input key={o.key} placeholder={o.placeholder} value={o.value} submitLabel={o.submit} onSubmit={value => o.onSubmit(value)} />
}

export function AddView(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  const isBusy = ctx.model.busy !== null
  const dm = Frame(ctx, {
    key: 'add-dm', tone: 'signal',
    children: [
      Head(ctx, { glyph: 'radio', tone: 'signal', eyebrow: 'Doğrudan mesaj', headline: 'Arkadaşını ekle', sub: 'Senin için bir oda açılır. claude.ai\'de Paylaş menüsünden arkadaşını e-postasıyla davet edersin; o kabul edince yazışırsınız.' }),
      ButtonRow(ctx.ui, ctx.surface, ctx.look.isLight, {
        buttons: [{ key: 'add-dm', label: isBusy ? ctx.model.busy ?? '' : 'Arkadaş ekle', variant: 'primary', onPress: () => ctx.on.addDm() }],
      }),
    ],
  })
  const project = Frame(ctx, {
    key: 'add-project',
    children: [
      Head(ctx, { glyph: 'branch', tone: 'run', eyebrow: 'Proje odası', headline: 'Ortak bir repo için', sub: 'İkiniz de o reponun collaborator\'üyseniz agent\'larınız proje hakkında soru sorup cevaplayabilir; geri kalan her şey kapalı kalır.' }),
      // The session's own repo is written in already: the likeliest room, and still editable.
      Field(ctx, { key: 'add-repo', placeholder: 'sahip/repo', submit: 'Aç', value: ctx.model.sessionRepo ?? undefined, onSubmit: v => ctx.on.addProject(v) }),
    ],
  })
  const join = Frame(ctx, {
    key: 'add-join',
    children: [
      Head(ctx, { glyph: 'plug', tone: 'read', eyebrow: 'Davet linki', headline: 'Linkle katıl', sub: 'Başka bir organizasyondan gelen davetler listede görünmez. Sana gönderilen oda linkini buraya yapıştır.' }),
      Field(ctx, { key: 'join-link', placeholder: 'https://claude.ai/artifact/…', submit: 'Katıl', onSubmit: v => ctx.on.join(v) }),
    ],
  })
  return (
    <Box key="add" flexDirection="column" gap={1}>
      {BackRow(ctx, { eyebrow: 'Yeni sohbet', title: 'Kiminle yazışmak istersin?' })}
      {ErrorCard(ctx)}
      {dm}
      {'Input' in ctx.ui ? project : null}
      {'Input' in ctx.ui ? join : null}
    </Box>
  )
}

type Toggle = { key: keyof PaneSettings; title: string; on: string; off: string }

const TOGGLES: Toggle[] = [
  { key: 'isReceiptsOn', title: 'Okundu bilgisi', on: 'Karşı taraf okuduğunu görür, sen de onunkini (mavi ✓✓).', off: 'Kapalı: ikiniz de yalnızca ✓✓ "ulaştı" görürsünüz.' },
  { key: 'isToastOn', title: 'Bildirimler', on: 'Pane kapalıyken yeni mesajlar köşede kısaca görünür.', off: 'Kapalı: yeni mesajlar yalnızca burada görünür.' },
  { key: 'isStatusOn', title: 'Durum satırı', on: 'Okunmamış mesaj sayısı prompt\'un altında durur.', off: 'Kapalı: prompt\'un altında hiçbir şey yazmaz.' },
]

function ToggleRow(ctx: Ctx, t: Toggle): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const isOn = ctx.model.settings[t.key]
  const mark = isText(ctx)
    ? <Text color={isOn ? ctx.look.signal.fg : ctx.look.lo}>{isOn ? '●' : '○'}</Text>
    : SvgOf(ctx, sigPic(switchPart(isOn)), `switch-${t.key}`)
  return (
    <Box key={`toggle-${t.key}`} flexDirection="row" alignItems="center" gap={2}>
      {mark}
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color={ctx.look.hi}>{t.title}</Text>
        <Text color={ctx.look.lo} wrap="wrap">{isOn ? t.on : t.off}</Text>
      </Box>
      <Button key={`set-${t.key}`} variant="secondary" label={isOn ? 'Kapat' : 'Aç'} onPress={() => ctx.on.toggleSetting(t.key)} />
    </Box>
  )
}

function SessionRow(ctx: Ctx): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const isOn = ctx.model.isConnected
  const mark = isText(ctx)
    ? <Text color={isOn ? ctx.look.role.ok.fg : ctx.look.role.warn.fg}>{isOn ? '✓' : '◷'}</Text>
    : SvgOf(ctx, sigPic(chipPart({ glyph: isOn ? 'check' : 'clock', paint: isOn ? 'ok' : 'warn' })), 'session-chip')
  return (
    <Box key="session-row" flexDirection="row" alignItems="center" gap={2}>
      {mark}
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color={ctx.look.hi}>Bu oturum</Text>
        <Text color={ctx.look.lo} wrap="wrap">{isOn ? 'Bağlı: mesajlar ve okundu bilgisi gönderiliyor.' : `Okuyor, yazmıyor: ${WAITING}.`}</Text>
      </Box>
      {isOn ? null : <Button key="connect-settings" variant="primary" label="Bağlan" onPress={() => ctx.on.connect()} />}
    </Box>
  )
}

export function SettingsView(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  return (
    <Box key="settings" flexDirection="column" gap={1}>
      {BackRow(ctx, { eyebrow: 'Ayarlar', title: 'Gizlilik ve bildirimler' })}
      {ErrorCard(ctx)}
      {Frame(ctx, { key: 'settings-card', children: [...TOGGLES.map(t => ToggleRow(ctx, t)), SessionRow(ctx)] })}
      {Meta(ctx, 'Okundu bilgisi karşılıklıdır: kapatırsan sen de karşı tarafınkini görmezsin. Hiçbir oturum adı, klasör yolu ya da model adı paylaşılmaz.', 'settings-note')}
    </Box>
  )
}
