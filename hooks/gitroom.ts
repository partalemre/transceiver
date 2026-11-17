// The team room of a GitHub repo (gitbox.ts): it appears by itself in a session opened in a repo where a teammate
// already has a mailbox, and "Project room" opens the first one. No link, no share step, no account to match:
// reaching the repo is the invitation.
import { setConnected } from './connection'
import { sameName } from './gate'
import { gitUrl, isGitUrl, parseGitUrl, peek, peersOf, visibilityOf, type GitIo } from './gitbox'
import { repoHere } from './here'
import type { AgentHost } from './host'
import { loginOf } from './identity'
import { MAX_NAME_CHARS, TITLE_PREFIX } from './limits'
import { setName } from './names'
import { callerOf, relayOf } from './relay'
import { adoptOwnHead, onTick, pokeRoom, setRoomSkip, type TickEvent } from './room-loop'
import { loadRooms, saveRooms, type RoomRecord } from './rooms'
import { stepWords } from './words-steps'

const UID_KEY = 'tx.git.uid'
const UID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const UID_LEN = 22
const ROOM_ID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ROOM_ID_LEN = 26
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
// How often a person at work says so: the others see who is on the repo, and on which branch.
export const BEAT_MS = 5 * 60_000

let uid: string | null = null
let lastWorkAt = 0
let wired: AgentHost | null = null
let lastLookAt = 0

// This computer's id in git rooms: made once, kept in the store. One per computer, so a person's two computers
// never write the same ref.
export async function selfUidOf(host: Pick<AgentHost, 'storeGet' | 'storeSet'>): Promise<string> {
  if (uid !== null) return uid
  const stored = await host.storeGet(UID_KEY)
  if (typeof stored === 'string' && stored.length === UID_LEN + 2) {
    uid = stored
    return stored
  }
  let made = 'u_'
  for (let i = 0; i < UID_LEN; i++) made += UID_CHARS[Math.floor(Math.random() * UID_CHARS.length)]
  await host.storeSet(UID_KEY, made)
  uid = made
  return made
}

// Every mailbox of one repo's room carries the same room id: it is the repo's name, hashed into an id's shape.
export function roomIdOf(repo: string): string {
  let id = ''
  let hash = FNV_OFFSET
  const text = repo.toLowerCase()
  for (let i = 0; i < ROOM_ID_LEN; i++) {
    for (const ch of `${i}:${text}`) hash = Math.imul(hash ^ ch.charCodeAt(0), FNV_PRIME) >>> 0
    id += ROOM_ID_CHARS[hash % ROOM_ID_CHARS.length]
  }
  return id
}

export const repoRoomRecord = (o: { repo: string; uid: string; now: number }): RoomRecord => ({
  id: roomIdOf(o.repo), room: roomIdOf(o.repo), url: gitUrl(o.repo, o.uid), boxes: [], kind: 'project', repo: o.repo,
  title: `${TITLE_PREFIX}${o.repo}`, status: 'active', isLive: false, peers: [], joinedAt: o.now,
})

export const repoRoomOf = (rooms: readonly RoomRecord[], repo: string): RoomRecord | undefined =>
  rooms.find(r => isGitUrl(r.url) && sameName(r.repo, repo))

export function gitIoOf(host: AgentHost): GitIo {
  return {
    run: (argv, init) => host.run(argv, init),
    dir: async repo => `${await host.dataDir()}/transceiver/${repo.replace('/', '__')}.git`,
    // The checkout's own remote only when the session is in that repo: its address may carry how to sign in.
    remotes: async repo => {
      const out = sameName(await repoHere(host), repo) ? await host.run(['git', '-C', await host.root(), 'remote', 'get-url', 'origin']) : null
      const origin = out !== null && out.exitCode === 0 ? out.stdout.trim() : ''
      return [`https://github.com/${repo}.git`, ...(origin === '' ? [] : [origin])]
    },
    selfUid: () => selfUidOf(host),
    now: () => host.now(),
  }
}

// "Project room": the repo's room, opened by the person. One they left before comes back as it was.
export async function openRepoRoom(repo: string): Promise<RoomRecord> {
  // The pane and the command hold the plain host; git needs the agent side's, kept from the session's wiring.
  const host = wired
  if (host === null) throw new Error(stepWords().repoUnreachable)
  const seen = await visibilityOf(gitIoOf(host), repo)
  if (seen !== 'private') throw new Error(seen === 'public' ? stepWords().publicRepo : stepWords().repoUnreachable)
  const rooms = await loadRooms(host)
  const held = repoRoomOf(rooms, repo)
  const room: RoomRecord = held === undefined ? repoRoomRecord({ repo, uid: await selfUidOf(host), now: await host.now() }) : { ...held, status: 'active' }
  await saveRooms(host, held === undefined ? [...rooms, room] : rooms.map(r => (r.id === room.id ? room : r)))
  setConnected(true)
  pokeRoom(host, room)
  return room
}

// The room of the session's own repo, opened here when a teammate is already there. A room the person left stays
// left; a repo nobody uses Transceiver in gets no room and no folder.
export async function ensureRepoRoom(host: AgentHost): Promise<RoomRecord | null> {
  const repo = await repoHere(host)
  if (repo === null) return null
  lastLookAt = await host.now()
  const held = repoRoomOf(await loadRooms(host), repo)
  if (held !== undefined) {
    if (held.status === 'active') setConnected(true)
    return held.status === 'active' ? held : null
  }
  if (!(await peek(gitIoOf(host), repo)) || (await visibilityOf(gitIoOf(host), repo)) !== 'private') return null
  const room = repoRoomRecord({ repo, uid: await selfUidOf(host), now: await host.now() })
  // Read again: the press on "Project room" may have added it meanwhile.
  const rooms = await loadRooms(host)
  if (repoRoomOf(rooms, repo) !== undefined) return null
  await saveRooms(host, [...rooms, room])
  setConnected(true)
  pokeRoom(host, room)
  return room
}

// A git room is polled only by sessions opened in its repo: every poll is a call to GitHub.
const isElsewhere = (host: AgentHost) => async (room: RoomRecord): Promise<boolean> =>
  isGitUrl(room.url) && !sameName(await repoHere(host), room.repo)

// The members are whoever has a mailbox in the repo: found on a poll, read from the next.
async function followMembers(host: AgentHost, ev: TickEvent): Promise<void> {
  const at = parseGitUrl(ev.room.url)
  if (at === null) return
  const boxes = peersOf(at.repo, at.uid).map(peer => gitUrl(at.repo, peer))
  if (boxes.join() === ev.room.boxes.join()) return
  const rooms = (await loadRooms(host)).map(r => (r.id === ev.room.id ? { ...r, boxes } : r))
  await saveRooms(host, rooms)
  const room = rooms.find(r => r.id === ev.room.id)
  if (room !== undefined) pokeRoom(host, room)
}

// A name in a git room is the one its owner wrote on their own head.
function learnNames(ev: TickEvent): void {
  for (const [author, head] of Object.entries(ev.state.peers)) {
    if (head.label !== undefined && head.label.trim() !== '') setName(author, head.label.trim().slice(0, MAX_NAME_CHARS))
  }
}

// The person is at work: the beat may go out, and a session opened before a teammate arrived looks again for the
// room, at most once in a while.
export function markWork(host: AgentHost, now: number): void {
  lastWorkAt = now
  if (now - lastLookAt < BEAT_MS) return
  lastLookAt = now
  void ensureRepoRoom(host).catch(() => undefined)
}

async function lineOf(host: AgentHost, argv: string[]): Promise<string | undefined> {
  const out = await host.run(['git', '-C', await host.root(), ...argv]).catch(() => null)
  const line = out !== null && out.exitCode === 0 ? out.stdout.trim().split('\n')[0] ?? '' : ''
  return line === '' ? undefined : line
}

// The person's name and branch on their own head, and a beat while they work, so the others see who is on the repo.
// It rides on a head that is written anyway when it can; a quiet session writes nothing.
async function sharePresence(host: AgentHost, ev: TickEvent): Promise<void> {
  // Only from a session in the repo: the branch read here is this session's.
  if (!isGitUrl(ev.room.url) || ev.room.status !== 'active' || !sameName(await repoHere(host), ev.room.repo)) return
  const { state } = ev
  const now = await host.now()
  const own = state.ownHead
  const isDue = now - lastWorkAt < BEAT_MS && now - (own.at ?? 0) >= BEAT_MS
  if (own.label !== undefined && !isDue) return
  const label = (await lineOf(host, ['config', '--get', 'user.name']))?.slice(0, MAX_NAME_CHARS) ?? own.label ?? own.gh ?? '?'
  const branch = await lineOf(host, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const known = state.ownVersion > 0 ? { head: own, version: state.ownVersion } : undefined
  const gh = await loginOf(host).catch(() => null)
  const patch = { label, at: now, ...(branch === undefined ? {} : { branch }), ...(gh === null ? {} : { gh }) }
  adoptOwnHead(ev.room.id, await relayOf(callerOf(host), ev.room.url).writeHead({ uid: state.selfUid, patch, known }))
}

export function wireRepoRooms(host: AgentHost): () => void {
  wired = host
  setRoomSkip(isElsewhere(host))
  const off = onTick(async ev => {
    if (!isGitUrl(ev.room.url)) return
    learnNames(ev)
    // A failed write is tried again on a later poll; it never stops the room.
    await Promise.all([followMembers(host, ev), sharePresence(host, ev)]).then(() => undefined, () => undefined)
  })
  return () => { off(); setRoomSkip(null) }
}
