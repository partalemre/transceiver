// The two views besides rooms and chat. "Yeni sohbet": a friend, a project room or a link, each one line and its
// control. "Ayarlar": read receipts, toasts, the status line, this session's connection, and how sharing works,
// which is where the long explanations live so that no card has to carry them.
import type { RenderElement } from 'claude-code'

import { WAITING } from './connection'
import { ErrorCard } from './pane-cards'
import { isText, Rule, type Ctx } from './pane-kit'
import { Sentence, Title } from './pane-type'
import type { PaneSettings } from './state-types'

function Back(ctx: Ctx, title: string): RenderElement {
  const { Box, Button } = ctx.ui
  return (
    <Box key="back-row" flexDirection="column" gap={1}>
      <Box flexDirection="row"><Button key="back" label="‹ Odalar" plain dimColor onPress={() => ctx.on.back()} /></Box>
      {Title(ctx, { key: 'view-title', text: title })}
    </Box>
  )
}

type FieldOpts = { key: string; title: string; placeholder: string; submit: string; value?: string; onSubmit: (v: string) => void }

// A bold line naming the choice, then its field.
function Field(ctx: Ctx, o: FieldOpts): RenderElement | null {
  if (!('Input' in ctx.ui)) return null
  const { Box, Input, Text } = ctx.ui
  return (
    <Box key={`${o.key}-field`} flexDirection="column" gap={isText(ctx) ? 0 : 1}>
      <Text bold color={ctx.look.hi}>{o.title}</Text>
      <Input key={o.key} placeholder={o.placeholder} value={o.value} submitLabel={o.submit} onSubmit={value => o.onSubmit(value)} />
    </Box>
  )
}

// The project field starts with the session's own repo: the likeliest room, and still editable.
export function AddView(ctx: Ctx): RenderElement {
  const { Box, Button } = ctx.ui
  return (
    <Box key="add" flexDirection="column" gap={2}>
      {Back(ctx, 'Yeni sohbet')}
      {ErrorCard(ctx)}
      <Box key="add-dm-row" flexDirection="column" gap={1}>
        {Sentence(ctx, { key: 'add-dm-body', text: 'Senin için bir kutu açılır; linkini arkadaşına gönderirsin.' })}
        <Box flexDirection="row"><Button key="add-dm" label={ctx.model.busy ?? 'Arkadaş ekle'} variant="primary" onPress={() => ctx.on.addDm()} /></Box>
      </Box>
      {Field(ctx, { key: 'add-repo', title: 'Proje odası', placeholder: 'sahip/repo', submit: 'Aç', value: ctx.model.sessionRepo ?? undefined, onSubmit: v => ctx.on.addProject(v) })}
      {Field(ctx, { key: 'join-link', title: 'Linkim var', placeholder: 'https://claude.ai/artifact/…', submit: 'Katıl', onSubmit: v => ctx.on.join(v) })}
    </Box>
  )
}

type Toggle = { key: keyof PaneSettings; title: string; on: string; off: string }

const TOGGLES: Toggle[] = [
  { key: 'isReceiptsOn', title: 'Okundu bilgisi', on: 'Karşı taraf okuduğunu görür, sen de onunkini.', off: 'Kapalı: ikiniz de yalnızca "ulaştı" görürsünüz.' },
  { key: 'isToastOn', title: 'Bildirimler', on: 'Pane kapalıyken yeni mesajlar köşede görünür.', off: 'Kapalı: yeni mesajlar yalnızca burada görünür.' },
  { key: 'isStatusOn', title: 'Durum satırı', on: 'Okunmamış mesaj sayısı prompt\'un altında durur.', off: 'Kapalı: prompt\'un altında bir şey yazmaz.' },
]

function Row(ctx: Ctx, o: { key: string; mark: RenderElement; title: string; sub: string; button: RenderElement | null }): RenderElement {
  const { Box, Text } = ctx.ui
  return (
    <Box key={o.key} flexDirection="row" alignItems="center" gap={2}>
      {o.mark}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text bold color={ctx.look.hi}>{o.title}</Text>
        <Text color={ctx.look.lo} wrap="wrap">{o.sub}</Text>
      </Box>
      {o.button}
    </Box>
  )
}

function ToggleRow(ctx: Ctx, t: Toggle): RenderElement {
  const { Button, Text } = ctx.ui
  const isOn = ctx.model.settings[t.key]
  const mark = <Text color={isOn ? ctx.look.signal.fg : ctx.look.lo}>{isOn ? '●' : '○'}</Text>
  const button = <Button key={`set-${t.key}`} variant="secondary" label={isOn ? 'Kapat' : 'Aç'} onPress={() => ctx.on.toggleSetting(t.key)} />
  return Row(ctx, { key: `toggle-${t.key}`, mark, title: t.title, sub: isOn ? t.on : t.off, button })
}

function SessionRow(ctx: Ctx): RenderElement {
  const { Button, Text } = ctx.ui
  const isOn = ctx.model.isConnected
  const mark = <Text color={isOn ? ctx.look.role.ok.fg : ctx.look.role.warn.fg}>{isOn ? '✓' : '◷'}</Text>
  const button = isOn ? null : <Button key="connect-settings" variant="primary" label="Bağlan" onPress={() => ctx.on.connect()} />
  return Row(ctx, { key: 'session-row', mark, title: 'Bu oturum', sub: isOn ? 'Bağlı: mesajlar gönderiliyor.' : `Okuyor, yazmıyor: ${WAITING}.`, button })
}

const HELP = [
  'Her kişinin bir odada kendi kutusu vardır: bir claude.ai sayfası. Kutun açılınca linkini claude.ai\'de aç, Paylaş\'a bas ve arkadaşının e-postasını yaz (Viewer yeter); sonra linki ona gönder.',
  'Aynı organizasyondaysanız kutular kendiliğinden bağlanır; değilse ikiniz de karşı tarafın linkini "Linkim var" ile ekleyin.',
  'Okundu bilgisi karşılıklıdır. Hiçbir oturum adı, klasör yolu ya da model adı paylaşılmaz.',
]

export function SettingsView(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  return (
    <Box key="settings" flexDirection="column" gap={2}>
      {Back(ctx, 'Ayarlar')}
      {ErrorCard(ctx)}
      <Box key="settings-rows" flexDirection="column" gap={isText(ctx) ? 0 : 2}>{[...TOGGLES.map(t => ToggleRow(ctx, t)), SessionRow(ctx)]}</Box>
      {Rule(ctx, 'help-rule')}
      <Box key="help" flexDirection="column" gap={1}>
        {Title(ctx, { key: 'help-title', text: 'Nasıl paylaşılır' })}
        {HELP.map((text, i) => Sentence(ctx, { key: `help-${i}`, text, paint: 'lo' }))}
      </Box>
    </Box>
  )
}
