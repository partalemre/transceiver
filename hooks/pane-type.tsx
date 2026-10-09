// The pane's type scale, on every screen: a screen's title, a card's title and a sentence. Svg on the desktop, so
// each sits on the kit's sizes and weights; a line of text on the terminal.
import type { RenderElement } from 'claude-code'

import { linesPart } from './kit/svg-text'
import { isText, Pic, type Ctx } from './pane-kit'

const SCREEN = { size: 20, weight: 650, lineHeight: 26 }
const CARD = { size: 15, weight: 620, lineHeight: 20 }
const BODY = { size: 13.5, weight: 400, lineHeight: 20 }
const TITLE_LINES = 2
const BODY_LINES = 4
// Svg type is measured, not laid out: wrapped lines keep this much px in hand.
const WRAP_SLACK = 16

// `width` (px) when the words sit inside a frame; the part's own width otherwise.
export type TypeOpts = { key: string; text: string; width?: number }

export function Title(ctx: Ctx, o: TypeOpts & { isCard?: boolean }): RenderElement {
  const { Text } = ctx.ui
  if (isText(ctx)) return <Text key={o.key} bold color={ctx.look.hi} wrap="wrap">{o.text}</Text>
  const type = o.isCard === true ? CARD : SCREEN
  return Pic(ctx, linesPart({ text: o.text, width: (o.width ?? ctx.px) - WRAP_SLACK, ...type, paint: 'hi', maxLines: TITLE_LINES }), o.key)
}

export function Sentence(ctx: Ctx, o: TypeOpts & { paint?: 'mid' | 'lo' }): RenderElement {
  const { Text } = ctx.ui
  const paint = o.paint ?? 'mid'
  if (isText(ctx)) return <Text key={o.key} color={ctx.look[paint]} wrap="wrap">{o.text}</Text>
  return Pic(ctx, linesPart({ text: o.text, width: (o.width ?? ctx.px) - WRAP_SLACK, ...BODY, paint, maxLines: BODY_LINES }), o.key)
}
