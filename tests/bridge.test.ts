// The bridge between a person's own computers, run as two machines with their own stores over one account: they find
// each other with no share and no link, name themselves, and what one writes shows in the other's session and wakes it,
// up to a ceiling. A mailbox from anyone else never joins.
import { expect, test } from 'claude-code/testing'

import { bridgeLine, flushWake, isLinkedHere, linkHere, onBridgeTick, resetBridge, showSent } from '../hooks/bridge'
import { setConnected } from '../hooks/connection'
import { connectDevices, deviceLabels, devicesRoomOf, findDevices, machineName, removeArgv } from '../hooks/devices'
import type { AgentHost, CallResult } from '../hooks/host'
import { shareDeviceName } from '../hooks/identity'
import { joinRoom } from '../hooks/join'
import { BRIDGE_WAKES_PER_HOUR, LIVE_COOLDOWN_MS } from '../hooks/limits'
import { setTurnRunning } from '../hooks/live'
import type { Message } from '../hooks/protocol'
import { relayOf } from '../hooks/relay'
import { onSoundTick } from '../hooks/sound'
import { errorLine } from '../hooks/room-loop'
import { DEVICES_TITLE, discoverInvites, loadRooms, type RoomRecord } from '../hooks/rooms'
import { initialSync, tick, type RoomSync } from '../hooks/sync'
import { callerFor, fakeDb, type FakeDb } from './fake-db'
import { fakeHost, scheduler, type FakeHost } from './fake-host'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const ID = (n: number) => `01K7A000000000000000000${String(n).padStart(3, '0')}`.replace(/[^0-9A-HJKMNP-TV-Z]/g, '0')

// One account: every computer sees the same artifacts, each mailbox its own db.
function account() {
  const dbs = new Map<string, FakeDb>()
  const listed: Array<{ title: string; url: string }> = []
  const answer = async (input: Record<string, unknown>): Promise<CallResult> => {
    if (input.tool === 'Artifact' && input.action === 'publish') {
      const url = `https://claude.ai/artifact/box${dbs.size + 1}`
      dbs.set(url, fakeDb(ME))
      listed.push({ title: DEVICES_TITLE, url })
      return { text: `Published ${url}`, result: { url } }
    }
    if (input.tool === 'Artifact' && input.action === 'list') return { result: { artifacts: listed } }
    const db = dbs.get(String(input.url))
    return db === undefined ? { isError: true, text: 'not found' } : callerFor(db)(input)
  }
  return { dbs, listed, answer }
}

type Machine = FakeHost & AgentHost & { wakes: string[] }

function machine(acc: ReturnType<typeof account>, o: { name: string; session?: string; sched: ReturnType<typeof scheduler> }): Machine {
  const base = fakeHost(acc.answer, o.sched)
  const wakes: string[] = []
  return Object.assign(base, {
    wakes,
    deviceName: async () => o.name,
    sessionId: async () => o.session ?? 'session-1',
    isConnected: () => true,
    sendSelf: async (text: string) => { wakes.push(text); return true },
    note: async () => undefined,
    toast: () => undefined,
  }) as unknown as Machine
}

const roomOf = async (m: Machine): Promise<RoomRecord> => devicesRoomOf(await loadRooms(m)) as RoomRecord

async function pollOf(m: Machine, state: RoomSync, room: RoomRecord) {
  const relay = relayOf(m.tool as never, room.url)
  const boxes = room.boxes.map(url => relayOf(m.tool as never, url))
  return tick({ relay, boxes, state, isViewing: false, isReceiptsOn: true, now: await m.now(), canWrite: true })
}

const message = (id: string, ts: number, text: string): Message => ({ v: 1, id, ts, kind: 'agent', text })

async function connected() {
  resetBridge()
  setTurnRunning(false)
  setConnected(true)
  const sched = scheduler()
  const acc = account()
  const mac = machine(acc, { name: 'MacBook', sched })
  const pc = machine(acc, { name: 'DESKTOP-EMRE', sched })
  await connectDevices({ host: mac, consent: 'pressed' })
  await connectDevices({ host: pc, consent: 'pressed' })
  await findDevices(mac)
  return { sched, acc, mac, pc }
}

test('the second computer finds the first through the account, in one room, and the first finds it back', async () => {
  const { mac, pc } = await connected()
  const [a, b] = [await roomOf(mac), await roomOf(pc)]
  expect(a.room).toBe(b.room)
  expect(a.url).not.toBe(b.url)
  expect(b.boxes).toEqual([a.url])
  expect(a.boxes).toEqual([b.url])
})

test('connecting again on a reinstalled computer takes its own mailbox back, by its name', async () => {
  const { sched, acc, mac } = await connected()
  const before = await roomOf(mac)
  const head = await relayOf(mac.tool as never, before.url).writeHead({ uid: ME, patch: { label: 'MacBook' } })
  expect(head.head.label).toBe('MacBook')
  const again = machine(acc, { name: 'MacBook', sched })
  const room = await connectDevices({ host: again, consent: 'pressed' })
  expect(room.url).toBe(before.url)
  expect(acc.listed).toHaveLength(2)
})

test('a message crosses: named by the computer, shown in the linked session, and it wakes it fenced', async () => {
  const { mac, pc } = await connected()
  const [a, b] = [await roomOf(mac), await roomOf(pc)]
  await linkHere(pc)
  let sent = (await pollOf(mac, initialSync(ME), a)).state
  await shareDeviceName(mac, { room: a, state: sent, fresh: [], isDenied: false })
  sent = (await pollOf(mac, sent, a)).state
  const own = await relayOf(mac.tool as never, a.url).send({ uid: ME, message: message(ID(1), await pc.now() + 1, 'testler geçti mi?'), known: sent.ownVersion > 0 ? { head: sent.ownHead, version: sent.ownVersion } : undefined })
  expect(own.head.head).toBe(ID(1))

  await pc.advance(1)
  const got = await pollOf(pc, initialSync(ME), b)
  expect(got.fresh).toHaveLength(1)
  expect(Object.values(deviceLabels([b], { [b.id]: got.state }))).toEqual(['MacBook'])

  await onBridgeTick(pc, { room: b, state: got.state, fresh: got.fresh, isDenied: false })
  expect(pc.said).toEqual(['↙ MacBook: testler geçti mi?'])
  expect(pc.wakes).toHaveLength(1)
  expect(pc.wakes[0]).toContain('[MacBook] testler geçti mi?')
  expect(pc.wakes[0]).toContain('other computer')
})

test('only the session that holds the bridge sees it, and the history from before the link is not news', async () => {
  const { sched, acc, pc } = await connected()
  const elsewhere = machine(acc, { name: 'DESKTOP-EMRE', session: 'session-2', sched })
  elsewhere.store = pc.store
  const room = await roomOf(pc)
  await linkHere(elsewhere)
  const author = `${ME}@box1`
  const state = { ...initialSync(ME), peers: { [author]: { v: 1, head: ID(1), headTs: 1, seenUpTo: '', readUpTo: '', readTs: 0, label: 'MacBook' } as never } }
  const fresh = [{ author, message: message(ID(1), await pc.now(), 'merhaba') }]

  await onBridgeTick(pc, { room, state, fresh, isDenied: false })
  expect(pc.said).toEqual([])
  expect(await isLinkedHere(pc)).toBe(false)

  await pc.advance(5)
  await linkHere(pc)
  await onBridgeTick(pc, { room, state, fresh, isDenied: false })
  expect(pc.said).toEqual([])
  expect(pc.wakes).toEqual([])
})

test('sending does not turn a message not read yet into history', async () => {
  const { pc } = await connected()
  const room = await roomOf(pc)
  await linkHere(pc)
  const before = await pc.now()
  await pc.advance(5)
  await showSent(pc, { room, message: message(ID(2), await pc.now(), 'selam') })
  await onBridgeTick(pc, { room, state: initialSync(ME), fresh: [{ author: `${ME}@box1`, message: message(ID(1), before + 1, 'merhaba') }], isDenied: false })
  expect(pc.said.at(-1)).toContain('merhaba')
})

test('a wake waits for the turn to end and the cooldown to pass, and stops at the hourly ceiling', async () => {
  const { pc } = await connected()
  const room = await roomOf(pc)
  await linkHere(pc)
  const author = `${ME}@box1`
  const state = initialSync(ME)
  const say = async (n: number) => {
    await pc.advance(1)
    await onBridgeTick(pc, { room, state, fresh: [{ author, message: message(ID(n), await pc.now(), `m${n}`) }], isDenied: false })
  }

  setTurnRunning(true)
  await say(1)
  expect(pc.wakes).toHaveLength(0)
  setTurnRunning(false)
  await flushWake(pc)
  expect(pc.wakes).toHaveLength(1)

  await say(2)
  await say(3)
  expect(pc.wakes).toHaveLength(1)
  await pc.advance(LIVE_COOLDOWN_MS)
  expect(pc.wakes).toHaveLength(2)
  expect(pc.wakes[1]).toContain('m2')
  expect(pc.wakes[1]).toContain('m3')

  for (let n = 4; n < 4 + BRIDGE_WAKES_PER_HOUR; n++) {
    await pc.advance(LIVE_COOLDOWN_MS)
    await say(n)
  }
  expect(pc.wakes).toHaveLength(BRIDGE_WAKES_PER_HOUR)
  expect(pc.said.some(line => line.includes('stopped waking'))).toBe(true)
})

test('someone else\'s computers never join: not from the shared list, and not by a pasted link', async () => {
  const { acc, mac } = await connected()
  const theirs = 'https://claude.ai/artifact/theirs'
  const db = fakeDb('u_BBBBBBBBBBBBBBBBBBBBBB')
  acc.dbs.set(theirs, db)
  await relayOf(callerFor(db), theirs).writeMeta({ v: 1, kind: 'devices', room: ID(9), createdAt: 1 })
  const shared = fakeHost(async input => {
    if (input.action === 'list') return { result: { artifacts: [{ title: DEVICES_TITLE, url: theirs }] } }
    return callerFor(db)(input)
  })
  expect(await discoverInvites({ host: shared, known: [] })).toEqual([])
  const joined = await joinRoom(mac, theirs)
  expect(joined.room).toBeUndefined()
  expect((await roomOf(mac)).boxes).not.toContain(theirs)
})

test('what this computer sends shows in its own session too, and holds the bridge here', async () => {
  const { pc } = await connected()
  const room = await roomOf(pc)
  await showSent(pc, { room, message: message(ID(1), 1, 'selam') })
  expect(pc.said).toEqual(['↗ DESKTOP-EMRE: selam'])
  expect(await isLinkedHere(pc)).toBe(true)
  expect(bridgeLine({ name: 'x', text: 'y', isMine: false })).toBe('↙ x: y')
})

test('a computer\'s name: a Mac\'s sharing name, else hostname, Windows by hostname alone', async () => {
  const runs: string[][] = []
  const run = async (argv: string[]) => {
    runs.push(argv)
    return argv[0] === 'hostname' ? { exitCode: 0, stdout: 'DESKTOP-EMRE.local\n', stderr: '' } : { exitCode: 1, stdout: '', stderr: '' }
  }
  expect(await machineName({ run, os: 'Windows_NT' })).toBe('DESKTOP-EMRE')
  expect(runs).toEqual([['hostname']])
  expect(await machineName({ run, os: undefined })).toBe('DESKTOP-EMRE')
  const none = async () => { throw new Error('no such program') }
  expect(await machineName({ run: none, os: 'Windows_NT' })).toBe('Windows')
  expect(await machineName({ run: none, os: undefined })).toBe('Mac')
})

test('a background error reaches the debug log with its first line, and never with a secret', () => {
  expect(errorLine(new Error('hook failed\nsecond line'))).toBe('Error: hook failed')
  expect(errorLine(new Error('key ghp_abcdefghijklmnopqrstuvwxyz0123456789'))).toBe('Error')
  expect(errorLine('nope')).toBe('error')
})

test('a new message rings once across the sessions of a computer, never for history, and not when turned off', async () => {
  const { sched, acc, pc } = await connected()
  const other = machine(acc, { name: 'DESKTOP-EMRE', session: 'session-2', sched })
  other.store = pc.store
  const room = await roomOf(pc)
  const author = `${ME}@box1`
  const event = async (id: string, ago: number) => ({ room, state: initialSync(ME), isDenied: false, fresh: [{ author, message: message(id, (await pc.now()) - ago, 'x') }] })
  expect(await onSoundTick(pc, await event(ID(1), 3_600_000))).toBe(false)
  const news = await event(ID(2), 0)
  expect(await onSoundTick(pc, news)).toBe(true)
  expect(await onSoundTick(other, news)).toBe(false)
  expect(pc.dings + other.dings).toBe(1)
  await pc.advance(5_000)
  await pc.storeSet('tx.settings', { isSoundOn: false })
  expect(await onSoundTick(pc, await event(ID(3), 0))).toBe(false)
})

test('removing a file: rm on a Mac, cmd on Windows, whose paths take backslashes', () => {
  expect(removeArgv({ path: 'C:/w/.transceiver/a.html', isDir: false, isWindows: true })).toEqual(['cmd', '/c', 'del', 'C:\\w\\.transceiver\\a.html'])
  expect(removeArgv({ path: 'C:/w/.transceiver', isDir: true, isWindows: true })).toEqual(['cmd', '/c', 'rmdir', 'C:\\w\\.transceiver'])
  expect(removeArgv({ path: '/w/a', isDir: false, isWindows: false })).toEqual(['rm', '-f', '--', '/w/a'])
})
