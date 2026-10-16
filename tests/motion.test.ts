// The pane in motion on the desktop (kit/moving.ts): every drawing is an interactive frame that enters as the pane
// opens, keeps its very source while what it shows is unchanged (the pane's clock ticking on included), follows its
// room or message rather than its place, and rings go out of a face's dot while that person is here.
import { expect, test } from 'claude-code/testing'

import { PANE_CLOCK_MS, POLL_OPEN_MS, PRESENCE_MS } from '../hooks/limits'
import { ALPEREN, dmAlperen, dmZeynep, NOW, projectEliti, ROOMS } from './pane-fixtures'
import { mountPane, paneWorld, startSession } from './pane-world'

const NARROW = 55
const WIDE = 140
// The world's clock starts a few polls short of the pane's next minute, so its clock moves on within a few polls.
const POLLS = 3
const START = NOW + PANE_CLOCK_MS - POLLS * POLL_OPEN_MS
const PAST_THE_MINUTE = (POLLS + 1) * POLL_OPEN_MS
const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]

// Alperen was last seen half a minute short of leaving: here as the pane opens, gone once its minute moves on.
function syncs() {
  const ra = dmAlperen()
  const peer = ra.peers[ALPEREN]
  const seenTs = NOW - PRESENCE_MS + PANE_CLOCK_MS / 2
  if (peer !== undefined) ra.peers[ALPEREN] = { ...peer, headTs: seenTs, readTs: seenTs }
  return { ra, re: projectEliti({ isDenied: false }), rz: dmZeynep() }
}

const svgsOf = async (ui: any) => ui.findAll({ type: 'Svg' })
const sources = async (ui: any): Promise<string[]> => (await svgsOf(ui)).map((svg: any) => svg.props.source as string)
const isRinging = (source: string): boolean => source.includes('m-ripple')

async function opened($: any, on: any, columns: number) {
  const world = paneWorld(on, { rooms: ALL, syncs: syncs(), remote: 'git@github.com:partalemre/eliti.git', now: START })
  await startSession($, world, { isBypass: true, surface: 'desktop' })
  await $.command.run({ command: 'transceiver', args: '' })
  const ui = await mountPane($, { surface: 'desktop', columns })
  await world.clock.settle()
  return { world, ui }
}

// Past the minute only Alperen's face changes: it alone is redrawn, with the sweep of a real change.
async function pastTheMinute(world: any, ui: any, first: string[]): Promise<string[]> {
  await world.clock.advance(PAST_THE_MINUTE)
  await world.clock.settle()
  const after = await sources(ui)
  expect(after.filter((_, i) => !isRinging(first[i] ?? ''))).toEqual(first.filter(source => !isRinging(source)))
  expect(after.filter(source => source.includes('m-sweep'))).toHaveLength(first.filter(isRinging).length)
  return after
}

test('desktop: the drawings cascade in as frames, keep their sources as the pane clock ticks on, and enter anew', async ($: any, on: any) => {
  const { world, ui } = await opened($, on, NARROW)
  const svgs = await svgsOf(ui)
  const first = await sources(ui)

  expect(svgs.length).toBeGreaterThan(2)
  expect(svgs.every((svg: any) => svg.props.isInteractive === true && svg.props.width > 0 && svg.props.height > 0)).toBe(true)
  expect(first.every(source => source.includes(':root{color-scheme:light dark}') && source.includes('class="m-in"'))).toBe(true)
  expect(first.filter(isRinging)).toHaveLength(1)

  const after = await pastTheMinute(world, ui, first)
  expect(after.filter(isRinging)).toHaveLength(0)

  // Opened anew, the pane mounts anew.
  await ui.unmount()
  await $.command.run({ command: 'transceiver', args: '' })
  const again = await mountPane($, { surface: 'desktop', columns: NARROW })
  expect((await sources(again)).every(source => source.includes('class="m-in"'))).toBe(true)
})

// Two drawings under one key (every exchange's lead, say) would flip between their sources on every draw.
test('desktop: in a project room beside the rooms, each drawing keeps its own source across a redraw', async ($: any, on: any) => {
  const { world, ui } = await opened($, on, WIDE)
  await ui.press({ key: 'open-re' })
  await world.clock.settle()
  const first = await sources(ui)

  expect(first.filter(isRinging)).toHaveLength(1)
  await pastTheMinute(world, ui, first)
})
