// The pane's reading type, on every surface: a title and a sentence as native Text, so the host draws them in the
// theme Claude is set to. (Svg takes its palette from the OS's colour scheme, which can differ from Claude's and
// leave the words unreadable.)
import type { RenderElement } from 'claude-code'

import type { Ctx } from './pane-kit'

export type TypeOpts = { key: string; text: string }

export function Title(ctx: Ctx, o: TypeOpts): RenderElement {
  const { Text } = ctx.ui
  return <Text key={o.key} bold color={ctx.look.hi} wrap="wrap">{o.text}</Text>
}

export function Sentence(ctx: Ctx, o: TypeOpts & { paint?: 'mid' | 'lo' }): RenderElement {
  const { Text } = ctx.ui
  return <Text key={o.key} color={ctx.look[o.paint ?? 'mid']} wrap="wrap">{o.text}</Text>
}
