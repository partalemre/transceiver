// The two views besides rooms and chat. "New chat": a friend, a project room or a link, each one line and its
// control. "Settings": read receipts, toasts, the status line, this session's connection, and how sharing works,
// which is where the long explanations live so that no card has to carry them.
import type { RenderElement } from 'claude-code'

import { waitingText } from './connection'
import { ErrorCard } from './pane-cards'
import { isText, Rule, type Ctx } from './pane-kit'
import { Sentence, Title } from './pane-type'
import type { PaneSettings } from './state-types'
import { paneWords } from './words-pane'

function Back(ctx: Ctx, title: string): RenderElement {
  const { Box, Button } = ctx.ui
  return (
    <Box key="back-row" flexDirection="column" gap={1}>
      <Box flexDirection="row"><Button key="back" label={paneWords().rooms} plain dimColor onPress={() => ctx.on.back()} /></Box>
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
  const w = paneWords()
  return (
    <Box key="add" flexDirection="column" gap={2}>
      {Back(ctx, w.newChat)}
      {ErrorCard(ctx)}
      <Box key="add-dm-row" flexDirection="column" gap={1}>
        {Sentence(ctx, { key: 'add-dm-body', text: w.addDmBody })}
        <Box flexDirection="row"><Button key="add-dm" label={ctx.model.busy ?? w.addFriend} variant="primary" onPress={() => ctx.on.addDm()} /></Box>
      </Box>
      {Field(ctx, { key: 'add-repo', title: w.projectRoom, placeholder: w.repoPlaceholder, submit: w.open, value: ctx.model.sessionRepo ?? undefined, onSubmit: v => ctx.on.addProject(v) })}
      {Field(ctx, { key: 'join-link', title: w.haveLink, placeholder: 'https://claude.ai/artifact/…', submit: w.join, onSubmit: v => ctx.on.join(v) })}
    </Box>
  )
}

type Toggle = { key: keyof PaneSettings; title: string; on: string; off: string }

function toggles(): Toggle[] {
  const w = paneWords()
  return [{ key: 'isReceiptsOn', ...w.receipts }, { key: 'isToastOn', ...w.toasts }, { key: 'isStatusOn', ...w.statusLine }]
}

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
  const button = <Button key={`set-${t.key}`} variant="secondary" label={isOn ? paneWords().turnOff : paneWords().turnOn} onPress={() => ctx.on.toggleSetting(t.key)} />
  return Row(ctx, { key: `toggle-${t.key}`, mark, title: t.title, sub: isOn ? t.on : t.off, button })
}

function SessionRow(ctx: Ctx): RenderElement {
  const { Button, Text } = ctx.ui
  const w = paneWords()
  const isOn = ctx.model.isConnected
  const mark = <Text color={isOn ? ctx.look.role.ok.fg : ctx.look.role.warn.fg}>{isOn ? '✓' : '◷'}</Text>
  const button = isOn ? null : <Button key="connect-settings" variant="primary" label={w.connectButton} onPress={() => ctx.on.connect()} />
  return Row(ctx, { key: 'session-row', mark, title: w.thisSession, sub: isOn ? w.connected : w.readOnly(waitingText()), button })
}

export function SettingsView(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  const w = paneWords()
  return (
    <Box key="settings" flexDirection="column" gap={2}>
      {Back(ctx, w.settings)}
      {ErrorCard(ctx)}
      <Box key="settings-rows" flexDirection="column" gap={isText(ctx) ? 0 : 2}>{[...toggles().map(t => ToggleRow(ctx, t)), SessionRow(ctx)]}</Box>
      {Rule(ctx, 'help-rule')}
      <Box key="help" flexDirection="column" gap={1}>
        {Title(ctx, { key: 'help-title', text: w.howSharing })}
        {w.help.map((text, i) => Sentence(ctx, { key: `help-${i}`, text, paint: 'lo' }))}
      </Box>
    </Box>
  )
}
