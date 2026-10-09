// Draws every state of the pane through the real plugin, for bin/preview: dark and light, a docked pane (narrow)
// and a wide one, desktop and terminal. Each test prints `@@TREE@@<label>@@<json>`; render.py makes the PNGs.
import { expect, test } from 'claude-code/testing'

import type { RoomRecord } from '../hooks/rooms'
import type { RoomSync } from '../hooks/sync'
import { dmAlperen, dmZeynep, projectEliti, room, ROOMS } from './pane-fixtures'
import { mountPane, paneWorld, startSession, type WorldOpts } from './pane-world'

// The test runner prints console output; the hooks environment's typings have no console.
declare const console: { log(text: string): void }

const NARROW = 58
const WIDE = 132

const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
const syncs = (o: { isPending?: boolean } = {}): Record<string, RoomSync> => ({ ra: dmAlperen(o), re: projectEliti(), rz: dmZeynep() })

type Shot = {
  label: string
  rooms?: RoomRecord[]
  syncs?: Record<string, RoomSync>
  isBypass?: boolean
  presses?: string[]
  columns?: number
  artifact?: WorldOpts['artifact']
  // A text the drawing must hold.
  sees: string
}

const SHOTS: Shot[] = [
  { label: 'rooms', isBypass: true, sees: 'Sohbetler' },
  { label: 'empty', rooms: [], syncs: {}, isBypass: true, sees: 'Arkadaş ekle' },
  { label: 'connect', sees: 'Bağlan ve yazmaya başla' },
  { label: 'invite', rooms: [ROOMS.alperen, room({ id: 'ri', status: 'invited', isOwner: false, kind: 'project', repo: 'partalemre/tidemark' }), { ...ROOMS.eliti, peers: [] }], isBypass: true, sees: 'odasına davet' },
  { label: 'dm', isBypass: true, presses: ['open-ra'], sees: 'Gelirim! Saat kaçta?' },
  { label: 'dm-waiting', syncs: syncs({ isPending: true }), presses: ['connect-later', 'open-ra'], sees: 'bağlantı bekleniyor' },
  { label: 'project', isBypass: true, presses: ['open-re'], sees: 'erişim yok' },
  { label: 'error', isBypass: true, presses: ['open-add', 'add-dm'], artifact: () => ({ deny: 'not now' }), sees: 'Oda açılamadı' },
  { label: 'created', isBypass: true, presses: ['open-add', 'add-dm'], sees: 'Linki kopyala' },
  { label: 'add', isBypass: true, presses: ['open-add'], sees: 'Linkle katıl' },
  { label: 'settings', presses: ['open-settings'], sees: 'Okundu bilgisi' },
  { label: 'wide', isBypass: true, presses: ['open-ra'], columns: WIDE, sees: 'Gelirim! Saat kaçta?' },
  { label: 'wide-project', isBypass: true, presses: ['open-re'], columns: WIDE, sees: 'erişim yok' },
  { label: 'wide-empty', rooms: [], syncs: {}, columns: WIDE, sees: 'Telsiz hazır' },
]

for (const isLight of [false, true]) {
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const s of SHOTS) {
      const label = `${s.label}${surface === 'terminal' ? '-terminal' : ''}${isLight ? '-light' : ''}`
      test(`preview: ${label}`, async ($: any, on: any) => {
        const world = paneWorld(on, { rooms: s.rooms ?? ALL, syncs: s.syncs ?? syncs(), isLight, artifact: s.artifact })
        await startSession($, world, { isBypass: s.isBypass, surface })
        const ui = await mountPane($, { surface, columns: s.columns ?? NARROW })
        for (const key of s.presses ?? []) await ui.press({ key })
        await world.clock.settle()
        const tree = JSON.stringify(await ui.drawn())
        console.log(`@@TREE@@${label}@@${tree}`)
        expect(tree.includes(s.sees)).toBe(true)
        await ui.unmount()
      })
    }
  }
}
