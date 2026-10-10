// The words outside the drawn pane in English, the default: times, answers, the status line, the hub's line, a
// toast, the command and its English verbs, the agent tools' answers and the room's web page. The wire keeps its
// one wording, so a peer on any version still parses an answer.
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { compactOf } from '../hooks/answers'
import { parseCommand, runCommand } from '../hooks/commands'
import { forgetRepo } from '../hooks/here'
import { hubOf } from '../hooks/hub'
import { setLang } from '../hooks/kit/lang'
import { statusText, toastText } from '../hooks/notify'
import { DENIED } from '../hooks/protocol'
import { queryFromInput } from '../hooks/queries-input'
import { composeOf } from '../hooks/query-menu'
import { roomPageHtml } from '../hooks/room-page'
import { possessive } from '../hooks/tr'
import { compactText } from '../hooks/tx-words'
import { buildModel } from '../hooks/view'
import { agoText, dayLabel, rowTime, secondsText } from '../hooks/when'
import { shownSystem, shownWire } from '../hooks/words-wire'
import { ALPEREN, idAt, input, NOW } from './pane-fixtures'

const MIN = 60_000
const HOUR = 60 * MIN

// Each test reads English and leaves the Turkish the other pure tests of this process read.
function inEnglish(fn: () => void | Promise<void>): () => Promise<void> {
  return async () => {
    setLang('en')
    try {
      await fn()
    } finally {
      setLang('tr')
    }
  }
}

test('times: just now, minutes, hours, yesterday, a date; seconds with a dot', inEnglish(() => {
  expect([agoText(NOW - 10_000, NOW), agoText(NOW - 3 * MIN, NOW), agoText(NOW - 2 * HOUR, NOW)]).toEqual(['just now', '3m ago', '2h ago'])
  expect(agoText(NOW - 24 * HOUR, NOW)).toBe('yesterday')
  expect(dayLabel(new Date(2026, 9, 6).getTime(), NOW)).toBe('Oct 6')
  expect(dayLabel(new Date(2025, 0, 2).getTime(), NOW)).toBe('Jan 2, 2025')
  expect([dayLabel(NOW, NOW), rowTime(NOW - 24 * HOUR, NOW)]).toEqual(['Today', 'Yesterday'])
  expect(secondsText(400)).toBe('0.4s')
}))

test('an answer in one line counts in English; the wire words are shown in English and never change', inEnglish(() => {
  const diff = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '+a', '-b'].join('\n')
  expect(compactText(compactOf('diff', diff))).toBe('1 file +1 -1')
  expect(compactText(compactOf('tests', JSON.stringify({ tests: { passed: 128, total: 128 } })))).toBe('✓ 128 passed · 0 failed')
  expect(compactText(compactOf('files', '12 dosya\nsrc/a.ts\nsrc/b.ts'))).toBe('12 files · src/a.ts, src/b.ts')
  expect(compactText(compactOf('grep', 'eşleşme yok'))).toBe('No matches')
  expect([shownWire(DENIED), shownWire('main · 3 değişen dosya')]).toEqual(['No access', 'main · 3 changed files'])
  expect(shownSystem('Kutu doldu, yeni kutu: https://claude.ai/artifact/N1')).toBe('Mailbox full, new mailbox: https://claude.ai/artifact/N1')
  expect(DENIED).toBe('erişim yok')
}))

test('names take the English possessive', () => {
  expect([possessive('Leo'), possessive('James')]).toEqual(['Leo\'s', 'James\''])
})

const view = (unread: number, title = 'Leo') => ({ ...buildModel(input()).rooms[0]!, unread, title })

test('the status line, the hub line and a toast count in English', inEnglish(() => {
  expect(statusText([view(2), view(1, 'Maya')], false)).toBe('((·)) 3 unread · 2 rooms')
  expect(hubOf([view(0)])).toEqual({ detail: '1 room', tone: 'idle' })
  expect(hubOf([view(2), view(1)])).toEqual({ detail: '3 unread · 2 rooms', tone: 'live' })
  const human = (text: string) => ({ author: ALPEREN, message: { v: 1 as const, id: idAt(1), ts: NOW, kind: 'human' as const, text } })
  expect(toastText({ name: 'Leo', entries: [human('one'), human('two')] })).toBe('Leo: 2 new messages')
}))

test('the command takes the English verbs beside the Turkish ones, and its help lists the English ones', inEnglish(async () => {
  expect(parseCommand('join https://claude.ai/artifact/AAA')).toEqual({ verb: 'katil', arg: 'https://claude.ai/artifact/AAA' })
  expect([parseCommand('add').verb, parseCommand('project a/b').verb, parseCommand('leave DM').verb]).toEqual(['ekle', 'proje', 'cik'])
  expect([parseCommand('connect').verb, parseCommand('Settings').verb, parseCommand('katıl x').verb]).toEqual(['kur', 'ayarlar', 'katil'])
  const deps = { host: {} as never, openPane: async () => undefined }
  const help = await runCommand({ ...deps, cmd: parseCommand('what') })
  expect(help).toContain('/transceiver join <link>')
  expect(help).toContain('/transceiver leave <room name | link>')
  expect(help).not.toMatch(/[çğıöşüİ]/)
  expect(await runCommand({ ...deps, cmd: parseCommand('project ../x') })).toBe('Usage: /transceiver project <owner/repo>')
}))

test('the composer hints and the ask tool\'s input errors are English', inEnglish(() => {
  expect(composeOf('/nope')).toMatchObject({ kind: 'hint', text: expect.stringContaining('Unknown command. Available: /status') })
  expect(composeOf('/grep')).toEqual({ kind: 'hint', text: 'Usage: /grep <value> (Text to find)' })
  expect(queryFromInput({ type: 'rm' }, 'a/b')).toMatch(/^type must be one of: /)
}))

test('the room\'s web page follows its creator\'s language', inEnglish(() => {
  const page = roomPageHtml({ title: 'Transceiver · DM' })
  expect(page).toContain('/transceiver join &lt;link&gt;')
  expect(page).toContain('Inside Claude, invited people only')
  expect(page).not.toMatch(/[çğıöşüİ]/)
}))

// The agent tools through the engine, with no MODZ_LANG: the session starts in English.
function world(on: On) {
  forgetRepo()
  mock.store(on, { 'tx.rooms': [] })
  mock.clock(on, { now: 1_791_545_100_000 })
  mock.env(on, { HOME: '/home/u' })
  on('session.root' as never, (() => ({ value: '/w' })) as never)
  on('process.run' as never, (() => ({ value: { exitCode: 0, stdout: 'git@github.com:partalemre/eliti.git\n', stderr: '' } })) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register' as never, (() => ({ value: undefined })) as never)
  on('session.start', () => ({ cwd: '/w' }))
}

test('the agent tools answer the person in English', async ($: any, on) => {
  world(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  const out = await $.tool.call({ tool: 'mcp__transceiver__inbox' })
  expect(out.deny).toBe('There is no shared project room for this repo. Open one with /transceiver project <owner/repo>; the other side must be a collaborator.')
})
