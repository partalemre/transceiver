import { expect, test } from 'claude-code/testing'
import { forgetLogin, shareLogin } from '../hooks/identity'
import type { TickEvent } from '../hooks/room-loop'
import { saveRooms, saveSettings, type RoomRecord } from '../hooks/rooms'
import { initialSync } from '../hooks/sync'
import type { Run } from '../hooks/run'
import { fakeAgent } from './fake-agent'
import { callerFor, fakeDb } from './fake-db'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const room: RoomRecord = {
  id: 'id1', url: 'https://claude.ai/artifact/ID1', kind: 'project', repo: 'a/b', title: 't',
  status: 'active', isLive: false, room: 'R0000000000000000000000000', boxes: [], peers: [], joinedAt: 0,
}
const ev = (over: Partial<TickEvent> = {}): TickEvent => ({ room, state: initialSync(ME), fresh: [], isDenied: false, ...over })

async function setup(login = 'emrep', rooms: RoomRecord[] = [room]) {
  forgetLogin()
  const db = fakeDb(ME)
  let ghRuns = 0
  const run: Run = async argv => {
    if (argv[0] === 'gh') ghRuns++
    return { exitCode: 0, stdout: `${login}\n`, stderr: '' }
  }
  const host = fakeAgent(callerFor(db), run)
  await saveRooms(host, rooms)
  return { db, host, runs: () => ghRuns }
}

test('the gh login goes on my head once, merged over my cursors', async () => {
  const { db, host, runs } = await setup()
  const head = { v: 1, head: '', headTs: 0, seenUpTo: '01K7A0000000000000000000S1', readUpTo: '', readTs: 0 }
  db.docs.set(`outbox/${ME}`, { data: head, version: 3 })
  expect(await shareLogin(host, ev())).toBe(true)
  expect(db.docs.get(`outbox/${ME}`)?.data).toEqual({ ...head, gh: 'emrep' })
  const state = { ...initialSync(ME), ownHead: { ...head, v: 1 as const, gh: 'emrep' }, ownVersion: 4 }
  expect(await shareLogin(host, ev({ state }))).toBe(false)
  expect(runs()).toBe(1)
})

test('nothing is published before connecting, into a room not accepted, or after a refused write', async () => {
  const { db, host } = await setup()
  host.isOn = false
  expect(await shareLogin(host, ev())).toBe(false)
  host.isOn = true
  await saveRooms(host, [{ ...room, status: 'invited' }])
  expect(await shareLogin(host, ev())).toBe(false)
  await saveRooms(host, [room])
  expect(await shareLogin(host, ev({ isDenied: true }))).toBe(false)
  expect(db.docs.size).toBe(0)
})

test('the login set in the settings wins over gh, and a bad gh answer publishes nothing', async () => {
  const { db, host, runs } = await setup('not a login!')
  expect(await shareLogin(host, ev())).toBe(false)
  await saveSettings(host, { isReceiptsOn: true, isToastOn: true, isStatusOn: true, gh: 'AlperenX' })
  expect(await shareLogin(host, ev())).toBe(true)
  expect(db.docs.get(`outbox/${ME}`)?.data.gh).toBe('AlperenX')
  expect(runs()).toBe(1)
})

test('a room that is not in this person\'s own store, or was left meanwhile, gets nothing', async () => {
  const { db, host } = await setup('emrep', [{ ...room, id: 'other' }])
  expect(await shareLogin(host, ev())).toBe(false)
  await saveRooms(host, [{ ...room, status: 'left' }])
  expect(await shareLogin(host, ev())).toBe(false)
  expect(db.docs.size).toBe(0)
})
