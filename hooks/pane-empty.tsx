// The pane with no rooms yet: a title, one sentence and one thing to press, "Arkadaş ekle". Joining by a link and
// a project room for the session's own GitHub repo are quiet second choices, each opening its one field in place;
// "Proje odası" is offered only inside a GitHub repo. Settings stay one small press away.
import type { RenderElement } from 'claude-code'

import type { Ctx } from './pane-kit'
import { Sentence, Title } from './pane-type'
import type { EmptyForm } from './state-types'

const TITLE = 'Arkadaşlarınla buradan yazış'
const BODY = 'Bir arkadaşını ekle; o kabul edince Claude\'dan çıkmadan yazışırsınız.'

function FormButton(ctx: Ctx, o: { form: EmptyForm; key: string; label: string }): RenderElement {
  const { Button } = ctx.ui
  const isOpen = ctx.model.emptyForm === o.form
  return <Button key={o.key} label={isOpen ? 'Vazgeç' : o.label} plain onPress={() => ctx.on.toggleForm(o.form)} />
}

// The open field: a link to join, or the session's repo for a project room (still editable).
function OpenField(ctx: Ctx): RenderElement | null {
  if (!('Input' in ctx.ui)) return null
  const { Input } = ctx.ui
  const form = ctx.model.emptyForm
  if (form === 'join') {
    return <Input key="join-link" placeholder="https://claude.ai/artifact/…" submitLabel="Katıl" onSubmit={v => ctx.on.join(v)} />
  }
  if (form !== 'project' || ctx.model.sessionRepo === null) return null
  return <Input key="add-repo" placeholder="sahip/repo" value={ctx.model.sessionRepo} submitLabel="Aç" onSubmit={v => ctx.on.addProject(v)} />
}

export function EmptyView(ctx: Ctx): RenderElement {
  const { Box, Button } = ctx.ui
  const hasInput = 'Input' in ctx.ui
  const hasRepo = hasInput && ctx.model.sessionRepo !== null
  return (
    <Box key="empty" flexDirection="column" gap={1} paddingTop={1}>
      {Title(ctx, { key: 'empty-title', text: TITLE })}
      {Sentence(ctx, { key: 'empty-body', text: BODY })}
      <Box key="empty-actions" flexDirection="row" alignItems="center" gap={1} flexWrap="wrap">
        <Button key="add-dm" label={ctx.model.busy ?? 'Arkadaş ekle'} variant="primary" onPress={() => ctx.on.addDm()} />
        {hasInput ? FormButton(ctx, { form: 'join', key: 'open-join', label: 'Linkim var' }) : null}
        {hasRepo ? FormButton(ctx, { form: 'project', key: 'open-project', label: 'Proje odası' }) : null}
      </Box>
      {OpenField(ctx)}
      <Box key="empty-foot" flexDirection="row" paddingTop={1}>
        <Button key="open-settings" label="Ayarlar" plain dimColor onPress={() => ctx.on.openView('settings')} />
      </Box>
    </Box>
  )
}
