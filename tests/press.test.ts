// A desktop clicks the tree it last painted. Every redraw keeps each button's press handle, so a click on an
// earlier tree still lands.
import { expect, test } from 'claude-code/testing'

import { dmAlperen, dmZeynep, projectEliti, ROOMS } from './pane-fixtures'
import { mountPane, paneProps, paneWorld, startSession } from './pane-world'

const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
const SYNCS = () => ({ ra: dmAlperen(), re: projectEliti(), rz: dmZeynep() })
const NARROW = 58
const WIDE = 90

function handlesOf(node: any, out: Record<string, number> = {}): Record<string, number> {
  if (node === null || typeof node !== 'object') return out
  if (node.press !== undefined && typeof node.props?.key === 'string') out[`${node.type}:${node.props.key}`] = node.press.handle
  for (const child of node.children ?? []) handlesOf(child, out)

  return out
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a redraw keeps every button's press handle`, async ($: any, on: any) => {
    const w = paneWorld(on, { rooms: ALL, syncs: SYNCS() })
    await startSession($, w, { surface, isBypass: true })
    const ui = await mountPane($, { surface, columns: NARROW })
    const before = handlesOf(await ui.drawn())
    await ui.redraw(paneProps(NARROW))
    await ui.redraw(paneProps(WIDE))

    expect(Object.keys(before).length).toBeGreaterThan(0)
    expect(handlesOf(await ui.drawn())).toEqual(before)
  })
}
