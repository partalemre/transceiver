// Every pane the MODZ hub opens draws "← MODZ" first while the hub runs; pressing it writes this mod's `home`.
import { expect, test } from 'claude-code/testing'

import { ROOMS, dmAlperen, dmZeynep, projectEliti } from './pane-fixtures'
import { mountPane, paneWorld, startSession } from './pane-world'

const SURFACES = ['terminal', 'desktop'] as const
const NARROW = 58
const WIDE = 140
const HOME_LABEL = '← MODZ'
const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
const SYNCS = () => ({ ra: dmAlperen(), re: projectEliti(), rz: dmZeynep() })

// A stand-in for the hub: it switches `isOn`, hears `home`, and reports what it heard.
const HUB_STAND_IN = {
  name: 'modz',
  register(on: any) {
    const heard: unknown[] = []
    on('command.run', { command: 'hub-on' }, async ($: any) => {
      await $.state.set({ plugin: 'modz', key: 'isOn' }, true)

      return {}
    })
    on('state.set', { key: 'home' } as any, async (_: any, e: any, next: any) => {
      heard.push(e.value)

      return next(e)
    })
    on('command.run', { command: 'hub-heard' }, async () => ({ text: JSON.stringify(heard) }))
  },
}

for (const surface of SURFACES) {
  for (const columns of [NARROW, WIDE]) {
    test(`${surface} at ${columns} columns: with the hub off the pane draws no modz-home`, { plugins: [HUB_STAND_IN] } as any, async ($: any, on: any) => {
      const w = paneWorld(on, { rooms: ALL, syncs: SYNCS() })
      await startSession($, w, { surface })
      const ui = await mountPane($, { surface, columns })

      expect(await ui.find({ type: 'Button', key: 'modz-home' })).toBeUndefined()
    })

    test(`${surface} at ${columns} columns: with the hub on, modz-home is the first button and a press writes home`, { plugins: [HUB_STAND_IN] } as any, async ($: any, on: any) => {
      const w = paneWorld(on, { rooms: ALL, syncs: SYNCS() })
      await startSession($, w, { surface })
      await $.command.run({ command: 'hub-on', args: '' })
      const ui = await mountPane($, { surface, columns })
      const [first] = await ui.findAll({ type: 'Button' })

      expect(first.props.key).toBe('modz-home')
      expect(first.props.label).toBe(HOME_LABEL)
      await ui.press({ key: 'modz-home' })
      await w.clock.settle()
      const out = await $.command.run({ command: 'hub-heard', args: '' })
      expect(JSON.parse(out.text ?? '')).toEqual([{ at: expect.any(Number) }])
    })
  }
}
