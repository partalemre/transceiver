// The mod is in beta: the pane's head says so, on both surfaces and in both languages.
import { expect, test } from 'claude-code/testing'

import { ROOMS, dmAlperen, dmZeynep, projectEliti } from './pane-fixtures'
import { mountPane, paneWorld, startSession } from './pane-world'

const SURFACES = ['terminal', 'desktop'] as const
const NARROW = 58
const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
const SYNCS = () => ({ ra: dmAlperen(), re: projectEliti(), rz: dmZeynep() })

// The pane's head: a drawing on the desktop, whose alt carries the words, and a title line on the terminal.
const headOf = async (ui: any): Promise<unknown> => ui.drawn()

for (const surface of SURFACES) {
  for (const isEnglish of [true, false]) {
    const language = isEnglish ? 'English' : 'Turkish'

    test(`${surface} in ${language}: the rooms head says Beta in its head`, async ($: any, on: any) => {
      const w = paneWorld(on, { rooms: ALL, syncs: SYNCS(), isEnglish })
      await startSession($, w, { surface })
      const ui = await mountPane($, { surface, columns: NARROW })

      expect(JSON.stringify(await headOf(ui))).toContain('Beta')
    })

    test(`${surface} in ${language}: the empty pane says Beta in its head`, async ($: any, on: any) => {
      const w = paneWorld(on, { rooms: [], syncs: {}, isEnglish })
      await startSession($, w, { surface })
      const ui = await mountPane($, { surface, columns: NARROW })

      expect(JSON.stringify(await headOf(ui))).toContain('Beta')
    })
  }
}
