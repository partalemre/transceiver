import { expect, test } from 'claude-code/testing'
import { addDraft, loadDrafts, onDrafts, settleDraft } from '../hooks/drafts'
import { DENIED } from '../hooks/protocol'
import { startLoop, stopRoom, syncOf } from '../hooks/room-loop'
import { saveRooms, type RoomRecord } from '../hooks/rooms'
import { answered, fakeAgent } from './fake-agent'
import { callerFor, fakeDb } from './fake-db'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const QID = '01K7A0000000000000000000D1'
const room = (id: string, status: RoomRecord['status'] = 'active'): RoomRecord => ({
  id, url: `https://claude.ai/artifact/${id}`, kind: 'project', repo: 'partalemre/eliti', title: 't',
  status, isLive: false, room: 'R0000000000000000000000000', boxes: [], peers: [], joinedAt: 0,
})
const draft = (roomId: string) => ({ roomId, qid: QID, question: 'neden?', asker: PEER })

async function world(id: string) {
  const host = fakeAgent(callerFor(fakeDb(ME)))
  await saveRooms(host, [room(id)])
  await startLoop(host)
  await host.advance(0)
  return host
}

const queued = (id: string) => (syncOf(id)?.pending ?? []).map(m => m.answer)

test('drafts are kept once per qid and the pane hears of each change', async () => {
  const host = fakeAgent(async () => ({}))
  const heard: number[] = []
  onDrafts(d => heard.push(d.length))
  expect(await addDraft(host, draft('r'))).toBe(true)
  expect(await addDraft(host, draft('r'))).toBe(false)
  expect((await loadDrafts(host)).length).toBe(1)
  expect(heard.at(-1)).toBe(1)
})

test('an approved draft is answered by the model outside the limit; a refused one gets the denial', async () => {
  const host = await world('DR1')
  host.reply = () => answered('çünkü cache')
  await addDraft(host, draft('DR1'))
  expect(await settleDraft(host, { qid: QID, isApproved: true })).toBe(true)
  expect(queued('DR1')).toEqual([{ qid: QID, ok: true, body: 'çünkü cache', tokens: 120 }])
  expect(await loadDrafts(host)).toEqual([])
  await addDraft(host, draft('DR1'))
  expect(await settleDraft(host, { qid: QID, isApproved: false })).toBe(true)
  expect(queued('DR1').at(-1)).toEqual({ qid: QID, ok: false, body: DENIED, tokens: 0 })
  expect(host.asked.length).toBe(1)
  stopRoom('DR1')
})

test('before connecting a draft stays; a draft of a left room goes with it', async () => {
  const host = await world('DR2')
  await addDraft(host, draft('DR2'))
  host.isOn = false
  expect(await settleDraft(host, { qid: QID, isApproved: true })).toBe(false)
  expect((await loadDrafts(host)).length).toBe(1)
  host.isOn = true
  await saveRooms(host, [room('DR2', 'left')])
  expect(await settleDraft(host, { qid: QID, isApproved: true })).toBe(false)
  expect(await loadDrafts(host)).toEqual([])
  expect(host.asked.length).toBe(0)
  stopRoom('DR2')
})
