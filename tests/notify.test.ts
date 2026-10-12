// Outside the pane (T9): the unread count under the prompt and a toast per friend's message, only while the pane
// is off screen, and never opening it.
import { expect, test } from 'claude-code/testing'

import { statusText, toastText } from '../hooks/notify'
import { emptyHead, paths } from '../hooks/protocol'
import { buildModel } from '../hooks/view'
import { ALPEREN, dmAlperen, dmZeynep, idAt, input, NOW, projectEliti, ROOMS } from './pane-fixtures'
import { paneWorld, startSession, type World } from './pane-world'
import { setLang } from '../hooks/kit/lang'

// These tests read the Turkish interface (MODZ_LANG=tr); the English one has its own tests.
setLang('tr')

const ALPEREN_BOX = 'https://claude.ai/artifact/RA2x'
const ALL = [{ ...ROOMS.alperen, boxes: [ALPEREN_BOX] }, ROOMS.eliti, ROOMS.zeynep]
const SYNCS = () => ({ ra: dmAlperen(), re: projectEliti(), rz: dmZeynep() })

const view = (unread: number, title = 'Alperen') => ({ ...buildModel(input()).rooms[0]!, unread, title })

test('the status line counts unread only while the pane is off screen', () => {
  expect(statusText([view(2), view(1, 'Zeynep')], false)).toBe('((·)) 3 okunmamış · 2 oda')
  expect(statusText([view(2), view(0)], false)).toBe('((·)) 2 okunmamış · Alperen')
  expect(statusText([view(2)], true)).toBe(undefined)
  expect(statusText([view(0)], false)).toBe(undefined)
})

test('a toast carries a person\'s first line, clipped; several become a count; agent traffic none', () => {
  const human = (text: string) => ({ author: ALPEREN, message: { v: 1 as const, id: idAt(1), ts: NOW, kind: 'human' as const, text } })
  expect(toastText({ name: 'Alperen', entries: [human('satır bir\nsatır iki')] })).toBe('Alperen: satır bir')
  expect(toastText({ name: 'Alperen', entries: [human('x'.repeat(100))] })?.length).toBe('Alperen: '.length + 60)
  expect(toastText({ name: 'Alperen', entries: [human('a'), human('b')] })).toBe('Alperen: 2 yeni mesaj')
  const agent = { ...human('cevap'), message: { ...human('cevap').message, kind: 'agent' as const } }
  expect(toastText({ name: 'Alperen', entries: [agent] })).toBe(null)
})

async function newMessageFromAlperen(w: World): Promise<void> {
  const db = w.dbOf(ALPEREN_BOX)
  const id = idAt(-1)
  db.docs.set(`${paths.msgs(ALPEREN)}/${id}`, { data: { v: 1, id, ts: NOW + 60_000, kind: 'human', text: 'Ben de geliyorum!\nBiletleri aldım.' }, version: 1 })
  db.docs.set(`outbox/${ALPEREN}`, { data: { ...emptyHead(), head: id, headTs: NOW + 60_000 }, version: 1 })
  await w.clock.advance(6_000)
}

test('with the pane closed a new message raises a toast and the unread count, and opens nothing', async ($: any, on: any) => {
  const w = paneWorld(on, { rooms: ALL, syncs: SYNCS(), isShown: false })
  await startSession($, w, { isBypass: true })
  await newMessageFromAlperen(w)
  expect(w.toasts).toEqual(['Alperen Yıldız: Ben de geliyorum!'])
  expect(w.statuses.at(-1)).toBe('((·)) 3 okunmamış · Alperen Yıldız')
  expect(w.opens).toHaveLength(0)
})

test('with the pane on screen there is no toast and no status line', async ($: any, on: any) => {
  const w = paneWorld(on, { rooms: ALL, syncs: SYNCS(), isShown: true })
  await startSession($, w, { isBypass: true })
  await newMessageFromAlperen(w)
  expect(w.toasts).toEqual([])
  expect(w.statuses.filter(s => s !== undefined)).toEqual([])
})

