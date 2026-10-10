import { expect, test } from 'claude-code/testing'

import { parseProfiles } from '../hooks/names'
import { buildModel, previewOf } from '../hooks/view'
import { dayLabel, rowTime } from '../hooks/when'
import { ALPEREN, dmAlperen, idAt, input, NOW, projectEliti, room, ROOMS, ZEYNEP } from './pane-fixtures'

test('rooms sort by their last message; unread, receipts and names come from the sync state', () => {
  const model = buildModel({ ...input(), sessionRepo: 'partalemre/eliti', checkOf: () => ({ isOk: true, at: NOW }) })
  expect(model.rooms.map(r => [r.id, r.title, r.unread])).toEqual([['re', 'partalemre/eliti', 0], ['ra', 'Alperen Yıldız', 2], ['rz', 'Zeynep', 0]])
  expect(model.rooms.find(r => r.id === 'rz')?.lastReceipt).toBe('read')
  expect(model.rooms.find(r => r.id === 're')).toMatchObject({ gate: 'open', ghLogin: 'alperenx', lastText: 'Cevap: erişim yok' })
})

test('the open chat lists its lines with names and receipts: read, delivered, waiting', () => {
  const model = buildModel(input({ syncs: { ra: dmAlperen({ isPending: true }) }, rooms: [ROOMS.alperen], session: { view: 'chat', activeId: 'ra' } }))
  const mine = model.lines.filter(l => l.isMine).map(l => l.receipt)
  expect(mine).toEqual(['read', 'read', 'delivered', 'pending'])
  expect(model.lines[0]?.authorName).toBe('Alperen Yıldız')
  expect(model.view).toBe('chat')
})

test('a room the person has had on screen shows no unread count before the read mark is written', () => {
  const model = buildModel(input({ session: { localRead: { ra: idAt(11) } } }))
  expect(model.rooms.find(r => r.id === 'ra')?.unread).toBe(0)
})

test('receipts off: nothing shows as read, both ways', () => {
  const base = input({ rooms: [ROOMS.zeynep], syncs: { rz: input().syncs.rz! } })
  const model = buildModel({ ...base, settings: { ...base.settings, isReceiptsOn: false } })
  expect(model.rooms[0]?.lastReceipt).toBe('delivered')
})

test('invites are not rooms; a DM nobody joined yet waits; a chat on a missing room falls back to the list', () => {
  const model = buildModel(input({
    rooms: [room({ id: 'ri', status: 'invited', kind: 'project', repo: 'a/b' }), room({ id: 'rw' })], syncs: {},
    session: { view: 'chat', activeId: 'gone' },
  }))
  expect(model.invites).toMatchObject([{ id: 'ri', title: 'Transceiver · DM', kind: 'project', repo: 'a/b' }])
  expect(model.rooms.map(r => [r.title, r.isWaiting])).toEqual([['Davet bekleniyor', true]])
  expect(model.view).toBe('rooms')
})

test('the connect card shows only for a synced room, not yet connected, not put off', () => {
  expect(buildModel(input({ isConnected: false })).needsSetup).toBe(true)
  expect(buildModel(input({ isConnected: true })).needsSetup).toBe(false)
  expect(buildModel(input({ isConnected: false, session: { isConnectDismissed: true } })).needsSetup).toBe(false)
  expect(buildModel(input({ isConnected: false, syncs: {} })).needsSetup).toBe(false)
})

test('a GitHub login is asked about once: a yes or a no for that login settles it, a new login asks again', () => {
  const ask = (peers: typeof ROOMS.eliti.peers) => buildModel(input({ rooms: [{ ...ROOMS.eliti, peers }], syncs: { re: projectEliti() } })).ghAsk
  expect(ask([])).toEqual({ roomId: 're', uid: ALPEREN, gh: 'alperenx', name: 'Alperen Yıldız' })
  expect(ask([{ uid: ALPEREN, gh: 'alperenx', isGhConfirmed: false }])).toBe(null)
  expect(ask([{ uid: ALPEREN, gh: 'alperen-old', isGhConfirmed: true }])?.gh).toBe('alperenx')
})

test('previews: a question, an answer, a denial, an unreadable doc, the first non-empty line', () => {
  const q = { v: 1 as const, id: idAt(1), ts: NOW, kind: 'query' as const, text: '', query: { type: 'ask' as const, repo: 'a/b', question: 'Neler değişti?' } }
  expect(previewOf(q)).toBe('Soru: Neler değişti?')
  expect(previewOf({ ...q, kind: 'answer', answer: { qid: q.id, ok: true, body: '\n3 commit', tokens: 1 } })).toBe('Cevap: 3 commit')
  expect(previewOf({ ...q, kind: 'answer', answer: { qid: q.id, ok: false, body: 'erişim yok', tokens: 0 } })).toBe('Cevap: erişim yok')
  expect(previewOf({ id: q.id, isUnreadable: true, reason: 'x' })).toBe('okunamayan mesaj')
  expect(previewOf({ ...q, kind: 'human', text: '\n  \nselam\nnaber' })).toBe('selam')
})

test('profile names come from the structured result, a list, or the text; nothing else', () => {
  const uids = [ALPEREN, ZEYNEP]
  expect(parseProfiles({ result: { db_profiles: { profiles: { [ALPEREN]: { name: ' Alperen  Y ' } } } } }, uids)).toEqual({ [ALPEREN]: 'Alperen Y' })
  expect(parseProfiles({ result: { db_profiles: { profiles: [{ id: ZEYNEP, display_name: 'Zeynep' }] } } }, uids)).toEqual({ [ZEYNEP]: 'Zeynep' })
  // The text as measured live (2026-10-10): the per-call nonce is not part of the name.
  expect(parseProfiles({ text: `=== BEGIN ARTIFACT PEOPLE 35c541bd ===\n${ALPEREN} 35c541bd| Alperen Y\n=== END ARTIFACT PEOPLE 35c541bd ===` }, [ALPEREN])).toEqual({ [ALPEREN]: 'Alperen Y' })
  expect(parseProfiles({ text: `- ${ALPEREN}: Alperen\n- {"id":"${ZEYNEP}","name":"Zeynep K"}` }, uids)).toEqual({ [ALPEREN]: 'Alperen', [ZEYNEP]: 'Zeynep K' })
  expect(parseProfiles({ text: 'no names' }, uids)).toEqual({})
})

test('times: the clock today, then Dün, then the date', () => {
  const day = 86_400_000
  expect(dayLabel(NOW - 60_000, NOW)).toBe('Bugün')
  expect(dayLabel(NOW - day, NOW)).toBe('Dün')
  expect(dayLabel(NOW - 3 * day, NOW)).toBe('6 Eki')
  expect(rowTime(NOW - 8 * 60_000, NOW)).toBe('14:22')
  expect(rowTime(0, NOW)).toBe('')
})

test('a draft past the daily limit names its asker, not their uid', () => {
  const model = buildModel({ ...input(), drafts: [{ roomId: 're', qid: idAt(2), question: 'Neden?', asker: ALPEREN }], canSettleDrafts: true })
  expect(model.drafts).toEqual([{ roomId: 're', qid: idAt(2), question: 'Neden?', asker: 'Alperen Yıldız' }])
  expect(model.canSettleDrafts).toBe(true)
})
