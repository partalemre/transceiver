// The MODZ hub's side of Transceiver: its one line (written only when it changed) and the hub's open request.
import { expect, test } from 'claude-code/testing'

import { hubOf, isOpenFor, isSameLine } from '../hooks/hub'
import type { RoomView } from '../hooks/state-types'
import { dmAlperen, dmZeynep, projectEliti, ROOMS } from './pane-fixtures'
import { paneWorld, startSession } from './pane-world'

const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
const SYNCS = () => ({ ra: dmAlperen(), re: projectEliti(), rz: dmZeynep() })
const POLLS_MS = 12_000
const rooms = (...unread: number[]): RoomView[] => unread.map(count => ({ unread: count }) as RoomView)

// The MODZ hub as far as Transceiver sees it: `/hub-press <pane>` writes the open request a row press writes.
const modz = {
  name: 'modz',
  register(on: any) {
    on('command.run', { command: 'hub-press' }, async ($: any, e: any, next: any) => {
      await $.state.set({ plugin: 'modz', key: 'open' }, { pane: e.args, at: 1 })
      return next(e)
    })
  },
}

test('the hub line leads with unread messages, then counts the rooms; nothing to say before the first room', () => {
  expect(hubOf([])).toEqual({ detail: '', tone: 'idle' })
  expect(hubOf(rooms(0, 0, 0))).toEqual({ detail: '3 oda', tone: 'idle' })
  expect(hubOf(rooms(2, 0, 1))).toEqual({ detail: '3 okunmamış · 3 oda', tone: 'live' })
})

test('a line equal to the card already written is not written again; the open request names its pane', () => {
  const card = { pane: 'transceiver', detail: '3 oda', tone: 'idle' as const, at: 5 }
  expect(isSameLine(card, { detail: '3 oda', tone: 'idle' })).toBe(true)
  expect(isSameLine(card, { detail: '1 okunmamış · 3 oda', tone: 'live' })).toBe(false)
  expect(isSameLine(undefined, { detail: '', tone: 'idle' })).toBe(false)
  expect(isOpenFor({ pane: 'transceiver', at: 1 }, 'transceiver')).toBe(true)
  expect(isOpenFor({ pane: 'files', at: 1 }, 'transceiver')).toBe(false)
  expect(isOpenFor(null, 'transceiver')).toBe(false)
})

test('the hub line is written when it changes; polls that change nothing write it no more', async ($: any, on: any) => {
  const writes: Array<{ pane: string; detail: string; tone: string }> = []
  on('state.set', { plugin: 'transceiver', key: 'hub' }, (_: unknown, e: any, next: any) => {
    writes.push(e.value)
    return next(e)
  })
  const w = paneWorld(on, { rooms: ALL, syncs: SYNCS() })
  await startSession($, w, { isBypass: true })
  await w.clock.advance(POLLS_MS)
  const settled = writes.length
  await w.clock.advance(POLLS_MS)

  expect(settled).toBeGreaterThan(0)
  expect(writes).toHaveLength(settled)
  expect(writes.at(-1)).toMatchObject({ pane: 'transceiver', detail: expect.stringMatching(/okunmamış · 3 oda$/), tone: 'live' })
  expect(new Set(writes.map(card => card.detail)).size).toBe(writes.length)
})

test('a press on the MODZ hub row opens the pane asking for the keyboard', { plugins: [modz] } as never, async ($: any, on: any) => {
  const w = paneWorld(on, { rooms: ALL, syncs: SYNCS() })
  on('command.run', () => ({ text: '' }))
  await startSession($, w, { isBypass: true })

  await $.command.run({ command: 'hub-press', args: 'files' })
  expect(w.opens).toEqual([])
  await $.command.run({ command: 'hub-press', args: 'transceiver' })
  expect(w.opens).toEqual([expect.objectContaining({ id: 'transceiver', focus: true })])
})
