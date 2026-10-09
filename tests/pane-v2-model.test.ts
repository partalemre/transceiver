// The v2 pane's model and words, pure: the head's status line, the unread divider, quotes and room links, the
// gate's four conditions, the ask budget and today's counts, transmissions, compact answers, the query menu and
// Turkish endings.
import { expect, test } from 'claude-code/testing'

import { commitOf, compactOf, diffStat, hitsOf, tagsOf, testCounts } from '../hooks/answers'
import { checkRows, gateDetail, passedOf, projectLine, statusOf } from '../hooks/pane-words'
import { emptyHead } from '../hooks/protocol'
import { composeOf, isModeType, queryMessage, supportedSpecs } from '../hooks/query-menu'
import { dative, genitive } from '../hooks/tr'
import { itemsOf, joined } from '../hooks/traffic'
import { buildModel } from '../hooks/view'
import { agoText } from '../hooks/when'
import { ALPEREN, dmAlperen, grepTraffic, idAt, input, NOW, projectEliti, ROOMS } from './pane-fixtures'

const MIN = 60_000
const ELITI = 'partalemre/eliti'
const yes = () => ({ isOk: true, at: NOW - 3 * MIN })

test('a DM\'s head says only what the peer\'s head shows: here, when they read; nothing when unknown', () => {
  const room = buildModel(input()).rooms.find(r => r.id === 'ra')
  expect(room?.peerName).toBe('Alperen')
  expect(room && statusOf(room, { now: NOW, isHere: true })).toEqual({ text: 'burada · 1 dk önce okudu', isHere: true })
  const silent = { ...dmAlperen(), peers: { [ALPEREN]: emptyHead() } }
  const alone = buildModel(input({ syncs: { ra: silent }, rooms: [ROOMS.alperen] })).rooms[0]
  expect(alone && statusOf(alone, { now: NOW, isHere: false })).toBe(null)
  expect(agoText(NOW - 2 * 60 * MIN, NOW)).toBe('2 sa önce')
})

test('the divider stays where the unread messages began when the room was opened', () => {
  const session = { view: 'chat' as const, activeId: 'ra', openedMark: { roomId: 'ra', mark: idAt(42) }, localRead: { ra: idAt(11) } }
  const model = buildModel(input({ session }))
  expect(model.divider).toEqual({ id: idAt(12), count: 2 })
  expect(model.rooms.find(r => r.id === 'ra')?.unread).toBe(0)
})

test('a reply quotes what it answers; a DM naming a shared project room links to it', () => {
  const lines = buildModel(input({ session: { view: 'chat', activeId: 'ra' } })).lines
  expect(lines.find(l => l.id === idAt(79))?.replyTo).toEqual({ name: 'Sen', text: 'Baktım, iki küçük yorum bıraktım. Gerisi temiz 👍' })
  expect(lines.find(l => l.id === idAt(11))?.roomLink).toEqual({ roomId: 're', repo: ELITI })
  expect(lines.filter(l => l.roomLink !== undefined)).toHaveLength(1)
})

test('the gate shows its four conditions: open, closed by the first that fails, unknown while GitHub was not asked', () => {
  const gateOf = (o: { sessionRepo?: string | null; isOk?: boolean }) => buildModel({
    ...input(), sessionRepo: o.sessionRepo, checkOf: () => (o.isOk === undefined ? undefined : { isOk: o.isOk, at: NOW }),
  }).rooms.find(r => r.id === 're')
  const open = gateOf({ sessionRepo: ELITI, isOk: true })
  expect(open?.gate).toBe('open')
  expect(open && passedOf(checkRows(open))).toBe(4)
  expect(gateOf({ sessionRepo: ELITI })?.gate).toBe('unknown')
  const notCollab = gateOf({ sessionRepo: ELITI, isOk: false })
  expect([notCollab?.gate, notCollab && gateDetail(notCollab)]).toEqual(['closed', '@alperenx collaborator değil'])
  const elsewhere = gateOf({ sessionRepo: 'a/b', isOk: true })
  expect(elsewhere && gateDetail(elsewhere)).toBe('bu oturum başka bir repoda')
  const unconfirmed = buildModel({ ...input({ rooms: [{ ...ROOMS.eliti, peers: [] }] }), sessionRepo: ELITI, checkOf: yes }).rooms[0]
  expect(unconfirmed && [unconfirmed.gate, projectLine(unconfirmed)]).toEqual(['closed', 'kapı kapalı · GitHub eşleşmesi yok'])
})

test('a project room counts the asks spent today and what this machine answered today', () => {
  const room = buildModel({ ...input(), askUsed: { re: 3 }, sessionRepo: ELITI, checkOf: yes }).rooms.find(r => r.id === 're')
  expect(room?.project).toMatchObject({ askUsed: 3, askLimit: 10, today: { answered: 2, modelless: 1, denied: 1 }, queriesToday: 3 })
  expect(room && projectLine(room)).toBe('kapı açık · 3 agent sorusu')
})

test('messages waiting for "Bağlan" are listed, oldest first, only while not connected', () => {
  const syncs = { ra: dmAlperen({ isPending: true }) }
  expect(buildModel(input({ syncs, rooms: [ROOMS.alperen], isConnected: false })).waiting).toEqual(['Sekizde stadyum önünde.'])
  expect(buildModel(input({ syncs, rooms: [ROOMS.alperen], isConnected: true })).waiting).toEqual([])
})

test('agent traffic: one transmission per query with its answer, the parts joined, tokens added', () => {
  const sync = projectEliti()
  const lines = buildModel(input({ syncs: { re: { ...sync, entries: [...sync.entries, ...grepTraffic()] } }, rooms: [ROOMS.eliti], session: { view: 'chat', activeId: 're' } })).lines
  const items = itemsOf(lines)
  expect(items.map(i => i.kind)).toEqual(['line', 'tx', 'tx', 'tx', 'tx'])
  const txs = items.filter(i => i.kind === 'tx')
  expect(txs.map(t => (t.kind === 'tx' ? joined(t)?.tokens : -1))).toEqual([312, 0, 0, 0])
  expect(txs.map(t => (t.kind === 'tx' ? joined(t)?.isDenied : null))).toEqual([false, false, true, false])
})

test('compact answers read each type\'s own format, and fall back to the text', () => {
  expect(diffStat('diff --git a/x b/x\n--- a/x\n+++ b/x\n+a\n+b\n-c')).toEqual({ files: 1, added: 2, removed: 1 })
  expect(testCounts('{"tests":{"passed":128,"total":128}}')).toEqual({ passed: 128, failed: 0 })
  expect(hitsOf('a.ts:4: x = 1\n… ilk 50 eşleşme; aramayı daralt')).toEqual([{ loc: 'a.ts:4', text: 'x = 1' }])
  expect(tagsOf('TODO 3 · FIXME 1 · HACK 0 · XXX 0\na.ts:1: // TODO')).toEqual([{ tag: 'TODO', count: 3 }, { tag: 'FIXME', count: 1 }])
  expect(commitOf('a1b2c3d Fix login\nAlperen · 2026-10-09\n\n3 dosya · +41 -12\n  a.ts +1 -0')).toEqual({ subject: 'a1b2c3d Fix login', stat: { files: 3, added: 41, removed: 12 } })
  expect(compactOf('files', '12 dosya\nsrc/a.ts\nsrc/b.ts')).toMatchObject({ kind: 'list', count: 12, noun: 'dosya', items: ['src/a.ts', 'src/b.ts'] })
  expect(compactOf('deps', 'package.json · dependencies (2)\n  react 18.3.1\n  zod 3.23.0')).toMatchObject({ kind: 'list', count: 2, items: ['react 18.3.1', 'zod 3.23.0'] })
  expect(compactOf('grep', 'eşleşme yok')).toEqual({ kind: 'text', text: 'eşleşme yok' })
  expect(compactOf('diff', 'not a diff')).toEqual({ kind: 'text', text: 'not a diff' })
})

test('the query menu follows the protocol; slash commands build guarded queries or hint', () => {
  expect(supportedSpecs().map(s => s.type)).toEqual(['status', 'branch', 'diff', 'log', 'tests', 'plan', 'todo', 'deps', 'grep', 'file', 'files', 'commit', 'ask'])
  expect(['grep', 'file', 'files', 'commit', 'ask'].every(isModeType)).toBe(true)
  expect(['status', 'todo', 'deps'].some(isModeType)).toBe(false)
  expect(composeOf('/diff')).toEqual({ kind: 'query', type: 'diff' })
  expect(composeOf('/grep  refresh token ')).toEqual({ kind: 'query', type: 'grep', arg: 'refresh token' })
  expect(composeOf('/files')).toEqual({ kind: 'query', type: 'files' })
  expect(composeOf('/file').kind).toBe('hint')
  expect(composeOf('/status now').kind).toBe('hint')
  expect(composeOf('/nope').kind).toBe('hint')
  expect(composeOf(' selam ')).toEqual({ kind: 'text', text: 'selam' })
  const q = (type: string, arg?: string) => queryMessage({ id: idAt(1), ts: NOW, repo: ELITI, type, arg })?.query ?? null
  expect(q('commit', 'A1B2C3D')).toEqual({ type: 'commit', repo: ELITI, sha: 'a1b2c3d' })
  expect(q('commit', 'HEAD')).toBe(null)
  expect(q('grep', 'x')).toBe(null)
  expect(q('status', 'x')).toBe(null)
})

test('Turkish endings follow the name\'s last vowel', () => {
  expect(['Alperen', 'Emre', 'Can', 'Oğuz', 'Ömür', 'Ali'].map(genitive)).toEqual(['Alperen\'in', 'Emre\'nin', 'Can\'ın', 'Oğuz\'un', 'Ömür\'ün', 'Ali\'nin'])
  expect(['Alperen', 'Emre', 'Can', 'Zeynep'].map(dative)).toEqual(['Alperen\'e', 'Emre\'ye', 'Can\'a', 'Zeynep\'e'])
})
