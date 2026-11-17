// The pane's reading type, on every surface: a title and a sentence as native Text, in the app's own ink (quiet words
// dim), so they read on whatever ground the panel has.
import type { RenderElement } from 'claude-code'

import type { Ctx } from './pane-kit'
import { paneWords } from './words-pane'

export type TypeOpts = { key: string; text: string }

export function Title(ctx: Ctx, o: TypeOpts): RenderElement {
  const { Text } = ctx.ui
  return <Text key={o.key} bold color={ctx.look.hi} wrap="wrap">{o.text}</Text>
}

// A small dim "Beta" beside the pane's title: this mod is still in beta.
export function BetaTag(ctx: Ctx, key: string): RenderElement {
  const { Text } = ctx.ui
  return <Text key={key} {...ctx.look.loText}>{paneWords().beta}</Text>
}

export function Sentence(ctx: Ctx, o: TypeOpts & { paint?: 'mid' | 'lo' }): RenderElement {
  const { Text } = ctx.ui
  const ink = o.paint === 'lo' ? ctx.look.loText : { color: ctx.look.mid }
  return <Text key={o.key} {...ink} wrap="wrap">{o.text}</Text>
}
