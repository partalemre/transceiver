// The bridge between the person's own computers, in the pane: the one thing to press before it exists, and the head of
// its room once it does (the drawing, where its messages land, and what is left to do on the other computer).
import type { RenderElement } from 'claude-code'

import { isHere, isText, Meta, SvgOf, type Ctx } from './pane-kit'
import { Sentence, Title } from './pane-type'
import { bridgePic } from './sig-rows'
import type { RoomView } from './state-types'
import { agoText } from './when'
import { paneWords } from './words-pane'

export const hasBridge = (ctx: Ctx): boolean => ctx.model.rooms.some(r => r.kind === 'devices')

// The first step: nothing is shared and no link is pasted, so one press is all of it.
export function BridgeCard(ctx: Ctx): RenderElement | null {
  if (hasBridge(ctx)) return null
  const { Box, Button } = ctx.ui
  const w = paneWords()
  return (
    <Box key="bridge-card" flexDirection="column" gap={1} borderStyle="round" borderColor={ctx.look.line} backgroundColor={ctx.look.card} paddingX={isText(ctx) ? 1 : 2} paddingY={isText(ctx) ? 0 : 1}>
      {Title(ctx, { key: 'bridge-title', text: w.bridgeTitle })}
      {Sentence(ctx, { key: 'bridge-body', text: w.bridgeBody })}
      <Box flexDirection="row"><Button key="bridge-connect" label={ctx.model.busy ?? w.bridgeConnect} variant="primary" onPress={() => ctx.on.connectDevices()} /></Box>
    </Box>
  )
}

// Said only when it needs a press: where the messages land is otherwise the quiet default.
function Elsewhere(ctx: Ctx, room: RoomView): RenderElement | null {
  if (ctx.model.bridge.isHere) return null
  const { Box, Button, Text } = ctx.ui
  const w = paneWords()
  return (
    <Box key="bridge-where" flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
      <Box flexGrow={1} flexShrink={1}><Text color={ctx.look.lo} wrap="truncate-end">{w.bridgeElsewhere}</Text></Box>
      <Box flexShrink={0}><Button key={`bridge-take-${room.id}`} label={w.bridgeTake} plain onPress={() => ctx.on.takeBridge()} /></Box>
    </Box>
  )
}

export function BridgeHead(ctx: Ctx, room: RoomView): RenderElement {
  const { Box } = ctx.ui
  const w = paneWords()
  const name = ctx.model.bridge.name
  const peer = room.peerName
  const isAlone = peer === undefined
  const seen = isHere(room, ctx.model.now) ? w.bridgeOnline : room.peerSeenTs > 0 ? agoText(room.peerSeenTs, ctx.model.now) : ''
  const alt = isAlone ? w.bridgeAloneAlt(name) : w.bridgeAlt({ here: name, there: peer })
  const pic = bridgePic({
    width: ctx.px, alt, lastId: room.lastId ?? '', lastIsMine: room.lastIsMine, isLight: ctx.look.isLight,
    here: { name, note: w.bridgeThisOne, isWaiting: false },
    there: { name: peer ?? w.bridgeOther, note: isAlone ? w.bridgeWaiting : seen, isWaiting: isAlone },
  })
  return (
    <Box key="bridge-head" flexDirection="column" gap={1}>
      {SvgOf(ctx, pic, `bridge-${room.id}`) ?? Meta(ctx, alt, `bridge-${room.id}`)}
      {Elsewhere(ctx, room)}
      {isAlone ? Sentence(ctx, { key: 'bridge-next', text: w.bridgeNext, paint: 'lo' }) : null}
    </Box>
  )
}
