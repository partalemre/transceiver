// The pane with no rooms yet: a title, one sentence and one thing to press, "Add a friend". Joining by a link and
// a project room for the session's own GitHub repo are quiet second choices, each opening its one field in place;
// "Project room" is offered only inside a GitHub repo. Settings stay one small press away.
import type { RenderElement } from 'claude-code'

import type { Ctx } from './pane-kit'
import { BetaTag, Sentence, Title } from './pane-type'
import type { EmptyForm } from './state-types'
import { paneWords } from './words-pane'

function FormButton(ctx: Ctx, o: { form: EmptyForm; key: string; label: string }): RenderElement {
  const { Button } = ctx.ui
  const isOpen = ctx.model.emptyForm === o.form
  return <Button key={o.key} label={isOpen ? paneWords().cancel : o.label} plain onPress={() => ctx.on.toggleForm(o.form)} />
}

// The open field: a link to join, or the session's repo for a project room (still editable).
function OpenField(ctx: Ctx): RenderElement | null {
  if (!('Input' in ctx.ui)) return null
  const { Input } = ctx.ui
  const form = ctx.model.emptyForm
  if (form === 'join') {
    return <Input key="join-link" placeholder="https://claude.ai/artifact/…" submitLabel={paneWords().join} onSubmit={v => ctx.on.join(v)} />
  }
  if (form !== 'project' || ctx.model.sessionRepo === null) return null
  return <Input key="add-repo" placeholder={paneWords().repoPlaceholder} value={ctx.model.sessionRepo} submitLabel={paneWords().open} onSubmit={v => ctx.on.addProject(v)} />
}

export function EmptyView(ctx: Ctx): RenderElement {
  const { Box, Button } = ctx.ui
  const hasInput = 'Input' in ctx.ui
  const hasRepo = hasInput && ctx.model.sessionRepo !== null
  const w = paneWords()
  return (
    <Box key="empty" flexDirection="column" gap={1} paddingTop={1}>
      <Box key="empty-head" flexDirection="row" alignItems="center" gap={1}>
        {Title(ctx, { key: 'empty-title', text: w.emptyTitle })}
        {BetaTag(ctx, 'empty-beta')}
      </Box>
      {Sentence(ctx, { key: 'empty-body', text: w.emptyBody })}
      <Box key="empty-actions" flexDirection="row" alignItems="center" gap={1} flexWrap="wrap">
        <Button key="add-dm" label={ctx.model.busy ?? w.addFriend} variant="primary" onPress={() => ctx.on.addDm()} />
        {hasInput ? FormButton(ctx, { form: 'join', key: 'open-join', label: w.haveLink }) : null}
        {hasRepo ? FormButton(ctx, { form: 'project', key: 'open-project', label: w.projectRoom }) : null}
      </Box>
      {OpenField(ctx)}
      <Box key="empty-foot" flexDirection="row" paddingTop={1}>
        <Button key="open-settings" label={w.settings} plain dimColor onPress={() => ctx.on.openView('settings')} />
      </Box>
    </Box>
  )
}
