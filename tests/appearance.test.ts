// The pane belongs to the app's panel, whatever a skin paints it: it lays down no ground of its own, and its drawings
// follow the app's light or dark appearance. Claude Code's `theme` setting is the terminal's and does not pin them;
// only MODZ_THEME does.
import { expect, test } from 'claude-code/testing'

import { dmAlperen, ROOMS } from './pane-fixtures'
import { mountPane, paneWorld, startSession } from './pane-world'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const all = (n: Node): Node[] => [n, ...(n.children ?? []).filter((c): c is Node => typeof c === 'object' && c !== null).flatMap(all)]
// The light palette's ink: once in a drawing's own media query, twice when a palette is pinned over it.
const LIGHT_INK = '#1C1B19'
const count = (text: string, part: string): number => text.split(part).length - 1

async function openDm($: any, on: any, o: { pinTheme?: string }): Promise<Node[]> {
  const world = paneWorld(on, { rooms: [ROOMS.alperen], syncs: { ra: dmAlperen() }, isLight: true, ...o })
  await startSession($, world, { isBypass: true, surface: 'desktop' })
  const ui = await mountPane($, { surface: 'desktop', columns: 40 })
  await ui.press({ key: 'open-ra' })
  return all((await ui.drawn()) as Node)
}

const messageSource = (nodes: Node[]): string => String(nodes.find(n => n.type === 'Svg' && String(n.props?.alt).startsWith('Alperen'))?.props?.source ?? '')

test('desktop: the pane paints no ground, and the theme setting does not pin its drawings', async ($: any, on: any) => {
  const nodes = await openDm($, on, {})
  expect(nodes.filter(n => n.props?.backgroundColor !== undefined)).toEqual([])
  expect(count(messageSource(nodes), LIGHT_INK)).toBe(1)
})

test('desktop: MODZ_THEME still pins a palette for a person who asks for one', async ($: any, on: any) => {
  expect(count(messageSource(await openDm($, on, { pinTheme: 'light' })), LIGHT_INK)).toBe(2)
})
