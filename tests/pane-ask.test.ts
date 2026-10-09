// Asking the other side's agent from the pane, on the terminal and the desktop: "Agent'a sor" opens the sheet, a
// row sends its typed query or puts the field in its mode, slash commands send the same, an unknown one only
// hints, the send button sends what was typed, and an exchange opens on press.
import { expect, test } from 'claude-code/testing'

import { paths } from '../hooks/protocol'
import { dmAlperen, dmZeynep, grepTraffic, projectEliti, ROOMS } from './pane-fixtures'
import { mountPane, paneWorld, startSession, type World } from './pane-world'

const SURFACES = ['terminal', 'desktop'] as const
const NARROW = 55
const ALL = [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
const SYNCS = () => {
  const re = projectEliti()
  return { ra: dmAlperen(), re: { ...re, entries: [...re.entries, ...grepTraffic()] }, rz: dmZeynep() }
}

type Sent = { kind: string; text: string; query?: Record<string, unknown> }

// What the person's outbox in the project room holds after the loop sent it, newest last.
function sentIn(w: World): Sent[] {
  const db = w.dbOf(ROOMS.eliti.url)
  const prefix = `${paths.msgs('u_AAAAAAAAAAAAAAAAAAAAAA')}/`
  return [...db.docs.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, d]) => d.data as Sent)
}

const drawn = async (ui: any) => JSON.stringify(await ui.drawn())
const composerKey = async (ui: any): Promise<string> => (await ui.findAll({ type: 'Input' }))[0]?.key ?? ''
// Types into the composer (Enter, unless `kind` says a keystroke) and lets the handler and the redraw finish.
async function typeIn(o: { ui: any; w: World }, text: string, kind?: 'change'): Promise<void> {
  await o.ui.input({ key: await composerKey(o.ui), text, ...(kind === undefined ? {} : { kind }) })
  await o.w.clock.settle()
}
async function pressKey(o: { ui: any; w: World }, key: string): Promise<void> {
  await o.ui.press({ key })
  await o.w.clock.settle()
}

async function openProject($: any, on: any, surface: (typeof SURFACES)[number]) {
  const w = paneWorld(on, { rooms: ALL, syncs: SYNCS() })
  await startSession($, w, { surface, isBypass: true })
  const ui = await mountPane($, { surface, columns: NARROW })
  await ui.press({ key: 'open-re' })
  return { w, ui }
}

for (const surface of SURFACES) {
  test(`${surface}: "Agent'a sor" opens the sheet; a row without a value sends its typed query at once`, async ($: any, on: any) => {
    const { w, ui } = await openProject($, on, surface)
    expect(await ui.findAll({ type: 'Button', key: 'sheet-status' })).toHaveLength(0)
    await ui.press({ key: 'ask-more-re' })
    await ui.press({ key: 'sheet-status' })
    await w.clock.advance(1_000)
    expect(sentIn(w).at(-1)).toMatchObject({ kind: 'query', text: 'status', query: { type: 'status', repo: 'partalemre/eliti' } })
  })

  test(`${surface}: the sheet lists every query; a row that takes a value sets the field's mode, Enter sends it`, async ($: any, on: any) => {
    const { w, ui } = await openProject($, on, surface)
    await ui.press({ key: 'ask-more-re' })
    const tree = await drawn(ui)
    for (const type of ['status', 'branch', 'diff', 'log', 'tests', 'plan', 'todo', 'deps', 'grep', 'file', 'files', 'commit', 'ask']) expect(tree).toContain(`sheet-${type}`)
    await ui.press({ key: 'sheet-grep' })
    expect(await drawn(ui)).toContain('Aranacak metin')
    await typeIn({ ui, w }, 'refreshToken')
    await w.clock.advance(1_000)
    expect(sentIn(w).at(-1)).toMatchObject({ kind: 'query', query: { type: 'grep', text: 'refreshToken' } })
    expect(await drawn(ui)).not.toContain('Aranacak metin')
  })

  test(`${surface}: slash commands send queries; a bad value or an unknown command only hints`, async ($: any, on: any) => {
    const { w, ui } = await openProject($, on, surface)
    await typeIn({ ui, w }, '/file src/app.ts')
    await typeIn({ ui, w }, '/commit nope')
    expect(await drawn(ui)).toContain('değeri eksik ya da geçersiz')
    await typeIn({ ui, w }, '/deploy')
    expect(await drawn(ui)).toContain('Bilinmeyen komut')
    await typeIn({ ui, w }, '/ask Neden iki kez yazılıyor?')
    await w.clock.advance(1_000)
    // Both were written in the same test-clock millisecond, so their ids do not order them.
    const queries = sentIn(w).filter(m => m.kind === 'query').map(m => m.query)
    expect(queries).toHaveLength(2)
    expect(queries).toContainEqual({ type: 'file', repo: 'partalemre/eliti', path: 'src/app.ts' })
    expect(queries).toContainEqual({ type: 'ask', repo: 'partalemre/eliti', question: 'Neden iki kez yazılıyor?' })
  })

  test(`${surface}: the mode chip goes back to plain messages; the send button sends what was typed`, async ($: any, on: any) => {
    const { w, ui } = await openProject($, on, surface)
    await pressKey({ ui, w }, 'ask-more-re')
    await pressKey({ ui, w }, 'sheet-file')
    expect(await drawn(ui)).toContain('Dosya yolu')
    await pressKey({ ui, w }, 'mode-clear')
    expect(await drawn(ui)).not.toContain('Dosya yolu')
    await typeIn({ ui, w }, 'Selam', 'change')
    if (surface === 'desktop') await pressKey({ ui, w }, 'send-re')
    else await typeIn({ ui, w }, 'Selam')
    await w.clock.advance(1_000)
    expect(sentIn(w).at(-1)).toMatchObject({ kind: 'human', text: 'Selam' })
  })

  test(`${surface}: a search is one line; Göster opens its count and first hits, Tamamı the rest`, async ($: any, on: any) => {
    const { w, ui } = await openProject($, on, surface)
    const before = await drawn(ui)
    expect(before).toContain('Senin agent\'ın grep refreshToken sordu · cevaplandı · 0 token')
    expect(before).not.toContain('lib/auth/session_store.dart:42')
    // The search is the room's newest exchange: its button is the last "open-tx-" in the drawing.
    const id = [...before.matchAll(/"key":"open-tx-([0-9A-Z]+)"/g)].at(-1)?.[1] ?? ''
    expect(id).not.toBe('')
    await pressKey({ ui, w }, `open-tx-${id}`)
    const opened = await drawn(ui)
    expect(opened).toContain('7 eşleşme')
    expect(opened).toContain('lib/auth/session_store.dart:42')
    expect(opened).not.toContain('test/auth_test.dart:20')
    await pressKey({ ui, w }, `more-${id}`)
    expect(await drawn(ui)).toContain('test/auth_test.dart:20')
  })
}
