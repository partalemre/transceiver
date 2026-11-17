import { expect, test } from 'claude-code/testing'
import { forgetRepo } from '../hooks/here'
import { onLiveTick, setTurnRunning, wake, wakeText } from '../hooks/live'
import type { Message } from '../hooks/protocol'
import type { TickEvent } from '../hooks/room-loop'
import { saveRooms, type RoomRecord } from '../hooks/rooms'
import { initialSync } from '../hooks/sync'
import { fakeAgent } from './fake-agent'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const room = (over: Partial<RoomRecord> = {}): RoomRecord => ({
  id: 'lv', url: 'u', kind: 'project', repo: 'partalemre/eliti', title: 'Transceiver · partalemre/eliti',
  status: 'active', isLive: true, room: 'R0000000000000000000000000', boxes: [], peers: [], joinedAt: 0, ...over,
})
const msg = (text: string, kind = 'agent'): Message => ({ v: 1, id: '01K7A0000000000000000000L1', ts: 1, kind, text } as Message)
const ev = (r: RoomRecord, fresh: { author: string; message: Message }[]): TickEvent =>
  ({ room: r, state: initialSync(ME), fresh, isDenied: false })

test('the wake text fences the peer text and cuts a long one', () => {
  const text = wakeText({ title: 'Oda', entries: [{ author: PEER, message: msg('x'.repeat(5_000)) }], nonce: 'NNNN' })
  expect(text.includes('<<<UNTRUSTED DATA NNNN')).toBe(true)
  expect(text.includes('x'.repeat(2_001))).toBe(false)
})

test('a delivered self-send is enough; otherwise the text becomes a row and a toast tells the person', async () => {
  const host = fakeAgent(async () => ({}))
  host.isDelivered = true
  expect(await wake(host, 'merhaba')).toBe('sent')
  expect(host.notes).toEqual([])
  host.isDelivered = false
  expect(await wake(host, 'merhaba')).toBe('noted')
  expect(host.notes).toEqual(['merhaba'])
  expect(host.toasts.length).toBe(1)
})

test('live mode wakes only a live project room of this repo, never while a turn runs, at most once per cooldown', async () => {
  forgetRepo()
  const host = fakeAgent(async () => ({}))
  const fresh = [{ author: PEER, message: msg('testler kırmızı') }]
  await saveRooms(host, [room({ isLive: false })])
  expect(await onLiveTick(host, ev(room(), fresh))).toBe(false)
  await saveRooms(host, [room()])
  expect(await onLiveTick(host, ev(room(), [{ author: ME, message: msg('benim') }]))).toBe(false)
  expect(await onLiveTick(host, ev(room(), [{ author: PEER, message: msg('', 'query') }]))).toBe(false)
  setTurnRunning(true)
  expect(await onLiveTick(host, ev(room(), fresh))).toBe(false)
  setTurnRunning(false)
  expect(await onLiveTick(host, ev(room(), fresh))).toBe(true)
  expect(host.sent[0]?.includes('testler kırmızı')).toBe(true)
  expect(await onLiveTick(host, ev(room(), fresh))).toBe(false)
  await host.advance(30_000)
  expect(await onLiveTick(host, ev(room(), fresh))).toBe(true)
})

test('a live room of another repo does not wake this session', async () => {
  forgetRepo()
  const host = fakeAgent(async () => ({}))
  const other = room({ id: 'lv2', repo: 'partalemre/other' })
  await saveRooms(host, [other])
  expect(await onLiveTick(host, ev(other, [{ author: PEER, message: msg('x') }]))).toBe(false)
})

test('in a repo room a teammate\'s agent wakes the session by itself, a person\'s chat line does not, and an hour holds a fixed number', async () => {
  forgetRepo()
  const host = fakeAgent(async () => ({}))
  const repoRoom = room({ id: 'lv-git', url: `git:partalemre/eliti#${ME}`, isLive: false })
  await saveRooms(host, [repoRoom])
  expect(await onLiveTick(host, ev(repoRoom, [{ author: PEER, message: msg('selam', 'human') }]))).toBe(false)
  const fromAgent = [{ author: PEER, message: msg('testler geçti, sıra sende') }]
  let woken = 0
  for (let i = 0; i < 25; i++) {
    if (await onLiveTick(host, ev(repoRoom, fromAgent))) woken += 1
    await host.advance(30_000)
  }
  expect(woken).toBe(20)
  expect(host.sent[0]?.includes('testler geçti')).toBe(true)
})
