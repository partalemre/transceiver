// Words that carry state (a warning, a refusal, what is wrong) in its colour. On the desktop they are a drawing, so
// the colour follows the app's light or dark appearance as every other drawing does; a native hex would be chosen
// by Claude Code's terminal theme and could sit pale amber on a light panel. The terminal keeps its theme keys.
import type { RenderElement } from 'claude-code'

import { linesPart } from './kit/svg-text'
import type { Role } from './kit/tokens'
import { isText, SvgOf, type Ctx } from './pane-kit'
import { sigPic } from './sig'
import { themed } from './sig-ink'

const SIZE = 13
const LINE_H = 19
const MAX_LINES = 4

// `room`: px kept free at the right for a button on the same line.
export function StateText(ctx: Ctx, o: { key: string; text: string; role: Role; room?: number }): RenderElement {
  const { Text } = ctx.ui
  const fallback = <Text key={o.key} color={ctx.look.role[o.role].fg} wrap="wrap">{o.text}</Text>
  if (isText(ctx)) return fallback
  const part = linesPart({ text: o.text, width: Math.max(1, Math.floor(ctx.px - (o.room ?? 0))), size: SIZE, weight: 400, lineHeight: LINE_H, paint: o.role, maxLines: MAX_LINES })
  return SvgOf(ctx, themed(sigPic({ ...part, height: Math.ceil(part.height) }), ctx.look.pin), o.key) ?? fallback
}
