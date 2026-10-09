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
export type RoomRecord = {
  id: string; url: string; kind: RoomKind; repo?: string; title: string
  status: 'active' | 'invited' | 'left'; isLive: boolean; isOwner: boolean; peers: Peer[]; joinedAt: number
}
export type Settings = { isReceiptsOn: boolean; isToastOn: boolean; isStatusOn: boolean; label?: string; gh?: string }

const ROOMS_KEY = 'tx.rooms'
const SETTINGS_KEY = 'tx.settings'
const DEFAULT_SETTINGS: Settings = { isReceiptsOn: true, isToastOn: true, isStatusOn: true }

// Everyone in the room reads every outbox; each guest writes only their own. The owner can write any outbox: the db
// contract lets no level rule limit the owner, and the prefix rule that opens reads must set a write level, so
// `owner` is the narrowest one (docs/e2e-checklist.md 0.10). `meta` is the owner's alone, so a guest cannot turn a
// DM into a project room. `profile` lets the page and the pane show names (spike: Names).
const ROOM_CAPABILITIES = {
  db: { rules: [
    { path: 'outbox', read: 'view', write: 'owner' },
    { path: 'outbox/{self}', write: 'interact' },
    { path: 'meta', read: 'view', write: 'owner' },
  ] },
  user: { scopes: ['profile'] },
}

export const roomTitle = (opts: { kind: RoomKind; repo?: string }) =>
  `${TITLE_PREFIX}${opts.kind === 'dm' ? 'DM' : opts.repo ?? ''}`

export async function loadRooms(host: Host): Promise<RoomRecord[]> {
  const raw = await host.storeGet(ROOMS_KEY)
  return Array.isArray(raw) ? (raw as RoomRecord[]) : []
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

// `consent` is the person's own words for the command or press that asked for the room; it rides on the publish
// and the meta write, the session's first writes.
export async function createRoom(opts: { host: Host; kind: RoomKind; repo?: string; consent?: string }): Promise<RoomRecord> {
  const { host, kind, repo } = opts
  const now = await host.now()
  const id = newId(now)
  const title = roomTitle({ kind, repo })
  const url = await publishFrom({ host, id, title, consent: opts.consent })
  const meta: RoomMeta = { v: PROTOCOL_VERSION, kind, createdAt: now, ...(repo === undefined ? {} : { repo }) }
  await relayOf(callerOf(host, opts.consent), url).writeMeta(meta)
  // The meta write carried the person's consent and landed: this session may write from now on.
  setConnected(true)
  return { id, url, kind, repo, title, status: 'active', isLive: false, isOwner: true, peers: [], joinedAt: now }
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

// A listed title is a hint only; a room is real once its meta doc parses.
export async function discoverInvites(opts: { host: Host; known: RoomRecord[] }): Promise<RoomRecord[]> {
  const { host } = opts
  const out = await host.tool({ tool: 'Artifact', action: 'list', scope: 'shared', limit: SHARED_LIST_LIMIT })
  const urls = invitedFrom({ result: out.result, text: out.text ?? '', knownUrls: opts.known.map(r => r.url) })
  const now = await host.now()
  const found: RoomRecord[] = []
  for (const url of urls.filter(u => (notRooms.get(u) ?? 0) <= now)) {
    const meta = await relayOf(callerOf(host), url).meta().then(m => m, () => undefined)
    if (meta === null) notRooms.set(url, now + NOT_ROOM_RETRY_MS)
    if (meta === null || meta === undefined) continue
    found.push(recordOf({ url, meta, now, status: 'invited' }))
  }
  return found
}

export function recordOf(opts: { url: string; meta: RoomMeta; now: number; status: RoomRecord['status'] }): RoomRecord {
  const { url, meta, now } = opts
  return {
    id: newId(now), url, kind: meta.kind, repo: meta.repo, title: roomTitle(meta),
    status: opts.status, isLive: false, isOwner: false, peers: [], joinedAt: now,
  }
}
