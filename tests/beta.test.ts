// The mod is in beta: the pane's head says so, on both surfaces and in both languages.
import { expect, test } from 'claude-code/testing'

import { ROOMS, dmAlperen, dmZeynep, projectEliti } from './pane-fixtures'
import { mountPane, paneWorld, startSession } from './pane-world'

const SURFACES = ['terminal', 'desktop'] as const
const NARROW = 58
const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
const SYNCS = () => ({ ra: dmAlperen(), re: projectEliti(), rz: dmZeynep() })

const betas = async (ui: any): Promise<unknown[]> => ui.findAll({ type: 'Text', text: 'Beta' })

// The head's title is a Text before the label, in one row.
const headOf = async (ui: any, key: string): Promise<any> => ui.find({ type: 'Box', key })

for (const surface of SURFACES) {
  for (const isEnglish of [true, false]) {
    const language = isEnglish ? 'English' : 'Turkish'

    test(`${surface} in ${language}: the rooms head draws Beta beside its title`, async ($: any, on: any) => {
      const w = paneWorld(on, { rooms: ALL, syncs: SYNCS(), isEnglish })
      await startSession($, w, { surface })
      const ui = await mountPane($, { surface, columns: NARROW })

      expect(await betas(ui)).toHaveLength(1)
      expect(JSON.stringify(await headOf(ui, 'list-head'))).toContain('Beta')
    })

    test(`${surface} in ${language}: the empty pane draws Beta beside its title`, async ($: any, on: any) => {
      const w = paneWorld(on, { rooms: [], syncs: {}, isEnglish })
      await startSession($, w, { surface })
      const ui = await mountPane($, { surface, columns: NARROW })

      expect(await betas(ui)).toHaveLength(1)
      expect(JSON.stringify(await headOf(ui, 'empty-head'))).toContain('Beta')
    })
  }
}
