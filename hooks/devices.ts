// "My computers": one mailbox per computer, all owned by the same claude.ai account. The room is a normal room to the
// relay and the sync; what differs is how it comes together. The account's own artifact list finds the other computers'
// mailboxes, so nothing is shared and no link is pasted, and only that list ever adds a mailbox here: a mailbox shared
// by anyone else never joins this room, whose messages may wake the session (bridge.ts).
import { setConnected } from './connection'
import type { Host } from './host'
import { DEVICE_LIST_LIMIT, DEVICE_RELIST_MS, MAX_NAME_CHARS } from './limits'
import type { RoomMeta } from './protocol'
import { callerOf, relayOf } from './relay'
import { createRoom, DEVICES_TITLE, invitedFrom, loadRooms, loadSettings, recordOf, saveRooms, withBox, type RoomRecord } from './rooms'
import type { Run } from './run'
import type { RoomSync } from './sync'

type Box = { url: string; meta: RoomMeta; label?: string }

export const devicesRoomOf = (rooms: readonly RoomRecord[]): RoomRecord | null =>
  rooms.find(r => r.status === 'active' && r.kind === 'devices') ?? null

const cleanName = (raw: string): string => (raw.split('\n')[0] ?? '').trim().replace(/\.local$/, '').slice(0, MAX_NAME_CHARS)

async function firstOutput(run: Run, commands: readonly string[][]): Promise<string> {
  for (const argv of commands) {
    const name = await run(argv).then(out => (out.exitCode === 0 ? cleanName(out.stdout) : ''), () => '')
    if (name !== '') return name
  }
  return ''
}

// The machine's own name: a Mac's Sharing name, else `hostname`, which every platform has.
export async function machineName(o: { run: Run; os: string | undefined }): Promise<string> {
  const isWindows = o.os === 'Windows_NT'
  const commands = isWindows ? [['hostname']] : [['scutil', '--get', 'ComputerName'], ['hostname']]
  return (await firstOutput(o.run, commands)) || (isWindows ? 'Windows' : 'Mac')
}

export async function deviceNameOf(host: Pick<Host, 'storeGet' | 'deviceName'>): Promise<string> {
  const { label } = await loadSettings(host as Host)
  return label !== undefined && label !== '' ? label : host.deviceName()
}

// shortcut: only the DEVICE_LIST_LIMIT newest artifacts are looked at; page through the list if a mailbox is ever missed.
async function listBoxes(host: Host, known: readonly string[]): Promise<Box[]> {
  const out = await host.tool({ tool: 'Artifact', action: 'list', scope: 'mine', limit: DEVICE_LIST_LIMIT })
  if (out.deny !== undefined || out.isError === true) return []
  const urls = invitedFrom({ result: out.result, text: out.text ?? '', knownUrls: [...known], title: DEVICES_TITLE })
  const boxes = await Promise.all(urls.map(async (url): Promise<Box | null> => {
    const relay = relayOf(callerOf(host), url)
    const meta = await relay.meta().catch(() => null)
    if (meta?.kind !== 'devices') return null
    const heads = await relay.heads().catch(() => [])
    return { url, meta, ...(heads[0]?.head.label === undefined ? {} : { label: heads[0].head.label }) }
  }))
  return boxes.filter((b): b is Box => b !== null)
}

// All the mailboxes share the oldest room id, so two computers that connected at once still end up in one room.
const roomIdOf = (boxes: readonly Box[]): string | undefined => boxes.map(b => b.meta.room).sort()[0]

// shortcut: two computers with the same name would share a mailbox; rename one in Settings if that ever happens.
async function ownBox(o: { host: Host; box: Box; others: string[]; consent: string; name: string }): Promise<RoomRecord> {
  const now = await o.host.now()
  const relay = relayOf(callerOf(o.host, o.consent), o.box.url)
  await relay.writeHead({ uid: await relay.whoami(), patch: { label: o.name } })
  setConnected(true)
  return { ...recordOf({ url: o.box.url, meta: o.box.meta, now, status: 'active' }), url: o.box.url, boxes: o.others }
}

// The press that connects this computer: its own mailbox again when one carries its name (a reinstall), else a new one.
export async function connectDevices(o: { host: Host; consent: string }): Promise<RoomRecord> {
  const { host, consent } = o
  const rooms = await loadRooms(host)
  const held = devicesRoomOf(rooms)
  if (held !== null) return held
  const name = await deviceNameOf(host)
  const boxes = await listBoxes(host, [])
  const own = boxes.find(b => b.label === name)
  const others = boxes.filter(b => b !== own).map(b => b.url)
  const room = own !== undefined
    ? await ownBox({ host, box: own, others, consent, name })
    : await createRoom({ host, kind: 'devices', room: roomIdOf(boxes), boxes: others, consent })
  await saveRooms(host, [...(await loadRooms(host)), room])
  return room
}

let listedAt = Number.NEGATIVE_INFINITY

// A computer that connects later appears here by itself: looked for each discovery while alone, rarely after that.
export async function findDevices(host: Host): Promise<void> {
  const rooms = await loadRooms(host)
  const room = devicesRoomOf(rooms)
  const now = await host.now()
  if (room === null || (room.boxes.length > 0 && now - listedAt < DEVICE_RELIST_MS)) return
  listedAt = now
  const name = await deviceNameOf(host)
  const found = (await listBoxes(host, [room.url, ...room.boxes])).filter(b => b.label !== name)
  if (found.length === 0) return
  const next = found.reduce((r, b) => withBox(r, b.url), room)
  await saveRooms(host, (await loadRooms(host)).map(r => (r.id === room.id ? next : r)))
}

// What each computer calls itself, by author: its own head's label, the only name that means anything in this room.
export function deviceLabels(rooms: readonly RoomRecord[], syncs: Record<string, RoomSync>): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const room of rooms.filter(r => r.kind === 'devices')) {
    for (const [author, head] of Object.entries(syncs[room.id]?.peers ?? {})) if (head.label) labels[author] = head.label
  }
  return labels
}

