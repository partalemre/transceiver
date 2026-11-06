// A new message, above the prompt, in every session that does not have the pane on screen: one pressed line that opens
// the room, the way the prompt area's other notices read (MODZ DESIGN.md §6). It leaves once the room has been read.
import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { BandLine } from '../types'
import { PressRow } from './kit/press'
import { roomRowPic } from './sig-rows'
import { glyphOf } from './pane-kit'
import type { RoomView } from './state-types'
import { rowTime } from './when'

const PX_PER_COLUMN = 6.4
const DISMISS_COLUMNS = 6
const MIN_WIDTH = 200
const MAX_WIDTH = 1200

// The newest room with something unread, while the pane is off screen and this message was not put away.
export function bandOf(o: { rooms: readonly RoomView[]; isShown: boolean; now: number; dismissed: string | null }): BandLine | null {
  if (o.isShown) return null
  const room = o.rooms.find(r => r.unread > 0 && r.lastId !== o.dismissed)
  if (room === undefined) return null
  const name = room.kind === 'project' ? room.repo?.split('/')[1] ?? room.title : room.peerName ?? room.title
  return { roomId: room.id, lastId: room.lastId ?? '', glyph: glyphOf(room), name, preview: room.lastText, time: rowTime(room.lastTs, o.now), unread: room.unread }
}

export type BandOpts = {
  surface: RenderSurface; columns: number; isLight: boolean; line: BandLine; theirs: RenderElement | null
  onOpen: () => void; onDismiss: () => void
}

function Row(ui: ElementTable, o: BandOpts): RenderElement {
  const { Button, Text } = ui
  const { line } = o
  if (o.surface === 'terminal' || !('Svg' in ui)) {
    return <Button key="tx-band-open" plain label={`${line.name}: ${line.preview}`} onPress={o.onOpen} />
  }
  const { Svg } = ui
  const width = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, (o.columns - DISMISS_COLUMNS) * PX_PER_COLUMN)))
  const pic = roomRowPic({ width, glyph: line.glyph, name: line.name, preview: line.preview, time: line.time, unread: line.unread, isWarn: false, isLight: o.isLight })
  return PressRow(ui, { box: 'tx-band-row', key: 'tx-band-open', drawing: <Svg {...pic} />, onPress: o.onOpen }) ?? <Text>{line.name}</Text>
}

export function bandTree(ui: ElementTable, o: BandOpts): RenderElement {
  const { Box, Button } = ui
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        {Row(ui, o)}
        <Button key="tx-band-dismiss" plain dimColor role="dismiss" label="✕" onPress={o.onDismiss} />
      </Box>
      {o.theirs}
    </Box>
  )
}
