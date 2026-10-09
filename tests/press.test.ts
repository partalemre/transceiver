// A redraw hands out new press handles; the desktop keeps a tree that looks the same as the one it holds, so a
// pane without a stamp of its own needs two clicks. Every drawing carries a new hidden stamp.
import { expect, test } from 'claude-code/testing'

import { dmAlperen, dmZeynep, projectEliti, ROOMS } from './pane-fixtures'
import { mountPane, paneWorld, startSession } from './pane-world'

const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
const SYNCS = () => ({ ra: dmAlperen(), re: projectEliti(), rz: dmZeynep() })
const NARROW = 58

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: every drawing of the pane carries a new hidden stamp, so the surface takes the live handles`, async ($: any, on: any) => {
    const w = paneWorld(on, { rooms: ALL, syncs: SYNCS() })
    await startSession($, w, { surface, isBypass: true })
    const ui = await mountPane($, { surface, columns: NARROW })
    const first = await ui.find({ key: 'render-stamp' })
    await ui.redraw()
    const second = await ui.find({ key: 'render-stamp' })

    expect(first?.props.display).toBe('none')
    expect(second?.text).not.toBe(first?.text)
  })
}
