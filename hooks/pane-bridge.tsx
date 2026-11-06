// The bridge between the person's own computers, in the pane: the one thing to press before it exists, and the head of
// its room once it does (the drawing, where its messages land, and what is left to do on the other computer).
import type { RenderElement } from 'claude-code'

import { isText, Meta, SvgOf, type Ctx } from './pane-kit'
import { Sentence, Title } from './pane-type'
import { bridgePic } from './sig-rows'
import type { RoomView } from './state-types'
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

function Where(ctx: Ctx, room: RoomView): RenderElement {
  const { Box, Button, Text } = ctx.ui
  const w = paneWords()
  const isHere = ctx.model.bridge.isHere
  return (
    <Box key="bridge-where" flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
      <Box flexGrow={1} flexShrink={1}><Text color={ctx.look.lo} wrap="wrap">{isHere ? w.bridgeHere : w.bridgeElsewhere}</Text></Box>
      {isHere ? null : <Box flexShrink={0}><Button key={`bridge-take-${room.id}`} label={w.bridgeTake} plain onPress={() => ctx.on.takeBridge()} /></Box>}
    </Box>
  )
}

export function BridgeHead(ctx: Ctx, room: RoomView): RenderElement {
  const { Box } = ctx.ui
  const w = paneWords()
  const there = room.peerName ?? null
  const here = ctx.model.bridge.name
  const alt = there === null ? w.bridgeAloneAlt(here) : w.bridgeAlt({ here, there })
  const pic = bridgePic({ width: ctx.px, here, there, waitWord: w.bridgeWaiting, alt, lastId: room.lastId ?? '', lastIsMine: room.lastIsMine, isLight: ctx.look.isLight })
  return (
    <Box key="bridge-head" flexDirection="column" gap={1}>
      {SvgOf(ctx, pic, `bridge-${room.id}`) ?? Meta(ctx, alt, `bridge-${room.id}`)}
      {Where(ctx, room)}
      {there === null ? Sentence(ctx, { key: 'bridge-next', text: w.bridgeNext }) : null}
    </Box>
  )
}
