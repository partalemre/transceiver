import { setConnected } from './connection'
import { parseArtifactUrls } from './dbtext'
import type { CallResult, Host } from './host'
import { NOT_ROOM_RETRY_MS, PROTOCOL_VERSION, SHARED_LIST_LIMIT, TITLE_PREFIX } from './limits'
import type { RoomMeta } from './protocol'
import { callerOf, relayOf } from './relay'
import { roomPageHtml } from './room-page'
import { newId } from './ulid'

export type RoomKind = 'dm' | 'project'
export type Peer = { uid: string; gh?: string; isGhConfirmed: boolean }
// A room is one mailbox per member, each owned by that member. `url` is this person's own mailbox, the only one
// they write ('' while an invite is not accepted yet); `boxes` are the other members' mailboxes, read only. `room`
// is the id every mailbox of the room carries in its meta.
export type RoomRecord = {
  id: string; room: string; url: string; boxes: string[]; kind: RoomKind; repo?: string; title: string
  status: 'active' | 'invited' | 'left'; isLive: boolean; peers: Peer[]; joinedAt: number
}
export type Settings = { isReceiptsOn: boolean; isToastOn: boolean; isStatusOn: boolean; label?: string; gh?: string }

const ROOMS_KEY = 'tx.rooms'
const SETTINGS_KEY = 'tx.settings'
const DEFAULT_SETTINGS: Settings = { isReceiptsOn: true, isToastOn: true, isStatusOn: true }

// Only the mailbox's owner writes it; everyone it is shared with reads it. The platform lets an outside visitor
// (another organization, invited by email) and every Viewer read, and lets nobody but the owner write at every
// sharing level, so whatever level the share menu was left at, every member can talk and none can write into
// another's mailbox. `profile` lets the pane show names (spike: Names).
export const ROOM_CAPABILITIES = {
  db: { rules: [{ path: '', read: 'view', write: 'owner' }] },
  user: { scopes: ['profile'] },
}

export const roomTitle = (opts: { kind: RoomKind; repo?: string }) =>
  `${TITLE_PREFIX}${opts.kind === 'dm' ? 'DM' : opts.repo ?? ''}`

// A record stored before rooms had mailboxes has no `room` or `boxes`; its own id stands in for the room.
const normalized = (r: RoomRecord): RoomRecord => ({ ...r, room: r.room ?? r.id, boxes: Array.isArray(r.boxes) ? r.boxes : [] })

export async function loadRooms(host: Host): Promise<RoomRecord[]> {
  const raw = await host.storeGet(ROOMS_KEY)
  return Array.isArray(raw) ? (raw as RoomRecord[]).map(normalized) : []
}

export const saveRooms = (host: Host, rooms: RoomRecord[]) => host.storeSet(ROOMS_KEY, rooms)

export async function loadSettings(host: Host): Promise<Settings> {
  const raw = await host.storeGet(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...(typeof raw === 'object' && raw !== null ? (raw as Partial<Settings>) : {}) }
}

export const saveSettings = (host: Host, s: Settings) => host.storeSet(SETTINGS_KEY, s)

// The Artifact tool publishes only a file under the session's working directory (or Claude's scratchpad), so the
// page is written there, where it is never committed: inside `.git` in a repo, else in a `.transceiver` folder.
// Either way it is removed once published; the room's page lives in the artifact.
async function pageFiles(host: Host, id: string): Promise<{ file: string; dir?: string }> {
  const cwd = (await host.cwd()).replace(/\/+$/, '')
  if (await host.isDir(`${cwd}/.git`)) return { file: `${cwd}/.git/transceiver/room-${id}.html` }
  const dir = `${cwd}/.transceiver`
  return { file: `${dir}/room-${id}.html`, dir }
}

async function publishFrom(opts: { host: Host; id: string; title: string; consent?: string }): Promise<string> {
  const { host } = opts
  const page = await pageFiles(host, opts.id)
  await host.writeFile(page.file, roomPageHtml({ title: opts.title }))
  try {
    return await publishPage({ host, file: page.file, consent: opts.consent })
  } finally {
    await host.remove(page.file).catch(() => undefined)
    if (page.dir !== undefined) await host.remove(page.dir).catch(() => undefined)
  }
}

function urlOf(out: CallResult): string | undefined {
  const structured = (out.result as { url?: unknown } | undefined)?.url
  return parseArtifactUrls(typeof structured === 'string' ? structured : '')[0] ?? parseArtifactUrls(out.text ?? '')[0]
}

async function publishPage(opts: { host: Host; file: string; consent?: string }): Promise<string> {
  const out = await opts.host.tool({
    tool: 'Artifact', action: 'publish', file_path: opts.file, icon: 'radio',
    description: 'Transceiver odası', capabilities: ROOM_CAPABILITIES,
    ...(opts.consent === undefined ? {} : { consent: opts.consent }),
  })
  const url = urlOf(out)
  if (out.deny !== undefined || out.isError === true || url === undefined) {
    throw new Error(`room publish failed: ${(out.deny ?? out.text ?? '').split('\n')[0]}`)
  }
  return url
}

export type NewRoom = { host: Host; kind: RoomKind; repo?: string; consent?: string; room?: string; boxes?: string[] }

// Publishes this person's own mailbox: for a new room, or (with `room` and the mailboxes already known in `boxes`)
// for one they join. `consent` is the person's own words for the command or press that asked for it; it rides on
// the publish and the meta write, the session's first writes.
export async function createRoom(opts: NewRoom): Promise<RoomRecord> {
  const { host, kind, repo } = opts
  const now = await host.now()
  const id = newId(now)
  const room = opts.room ?? id
  const title = roomTitle({ kind, repo })
  const url = await publishFrom({ host, id, title, consent: opts.consent })
  const meta: RoomMeta = { v: PROTOCOL_VERSION, kind, room, createdAt: now, ...(repo === undefined ? {} : { repo }) }
  await relayOf(callerOf(host, opts.consent), url).writeMeta(meta)
  // The meta write carried the person's consent and landed: this session may write from now on.
  setConnected(true)
  return { id, room, url, boxes: opts.boxes ?? [], kind, repo, title, status: 'active', isLive: false, peers: [], joinedAt: now }
}

type Listed = { title?: unknown; url?: unknown }

const isRoomTitle = (title: unknown) => typeof title === 'string' && title.startsWith(TITLE_PREFIX)

// The tool's structured result lists `{ title, url, rel }` (spike R3); the text is only a fallback.
export function invitedFrom(opts: { result: unknown; text: string; knownUrls: string[] }): string[] {
  const known = new Set(opts.knownUrls)
  const listed = (opts.result as { artifacts?: Listed[] } | undefined)?.artifacts
  const urls = Array.isArray(listed)
    ? listed.filter(a => isRoomTitle(a.title) && typeof a.url === 'string').flatMap(a => parseArtifactUrls(a.url as string))
    : opts.text.split('\n').filter(line => line.includes(TITLE_PREFIX.trim())).flatMap(parseArtifactUrls)
  return [...new Set(urls)].filter(url => !known.has(url))
}

// Shared artifacts whose meta is missing or does not parse, and when they may be read again: a share made before
// its meta was written still shows up, without every such artifact being read every minute. A read that failed
// (offline) is tried again on the next discovery.
const notRooms = new Map<string, number>()

export type Found = { url: string; meta: RoomMeta }

// A listed title is a hint only; a mailbox is real once its meta doc parses.
export async function discoverInvites(opts: { host: Host; known: RoomRecord[] }): Promise<Found[]> {
  const { host } = opts
  const out = await host.tool({ tool: 'Artifact', action: 'list', scope: 'shared', limit: SHARED_LIST_LIMIT })
  const urls = invitedFrom({ result: out.result, text: out.text ?? '', knownUrls: knownUrlsOf(opts.known) })
  const now = await host.now()
  const found: Found[] = []
  for (const url of urls.filter(u => (notRooms.get(u) ?? 0) <= now)) {
    const meta = await relayOf(callerOf(host), url).meta().then(m => m, () => undefined)
    if (meta === null) notRooms.set(url, now + NOT_ROOM_RETRY_MS)
    if (meta === null || meta === undefined) continue
    found.push({ url, meta })
  }
  return found
}

export const knownUrlsOf = (rooms: RoomRecord[]): string[] => rooms.flatMap(r => [r.url, ...r.boxes]).filter(u => u !== '')

// The room a mailbox belongs to, among those this person is in: same id, same kind and repo. A DM holds one other
// mailbox, so a second one there belongs nowhere.
export function homeOf(rooms: RoomRecord[], found: Found): RoomRecord | undefined {
  const { meta } = found
  const home = rooms.find(r => r.status !== 'left' && r.room === meta.room && r.kind === meta.kind && r.repo === meta.repo)
  return home?.kind === 'dm' && home.boxes.length > 0 ? undefined : home
}

export const withBox = (room: RoomRecord, url: string): RoomRecord =>
  (room.url === url || room.boxes.includes(url) ? room : { ...room, boxes: [...room.boxes, url] })

// Found mailboxes join the room they belong to; one of a room this person is not in is an invite. A mailbox
// already held anywhere (a left room's included) is not placed again.
export function placeFound(opts: { rooms: RoomRecord[]; found: Found[]; now: number }): RoomRecord[] {
  let rooms = opts.rooms
  for (const f of opts.found) {
    if (knownUrlsOf(rooms).includes(f.url)) continue
    const home = homeOf(rooms, f)
    const isMatch = rooms.some(r => r.status !== 'left' && r.room === f.meta.room)
    if (home !== undefined) rooms = rooms.map(r => (r.id === home.id ? withBox(r, f.url) : r))
    else if (!isMatch) rooms = [...rooms, recordOf({ url: f.url, meta: f.meta, now: opts.now, status: 'invited' })]
  }
  return rooms
}

// A room seen from another member's mailbox `url`: this person has no mailbox in it yet.
export function recordOf(opts: { url: string; meta: RoomMeta; now: number; status: RoomRecord['status'] }): RoomRecord {
  const { url, meta, now } = opts
  return {
    id: newId(now), room: meta.room, url: '', boxes: [url], kind: meta.kind, repo: meta.repo, title: roomTitle(meta),
    status: opts.status, isLive: false, peers: [], joinedAt: now,
  }
}
