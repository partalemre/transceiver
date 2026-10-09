// Two people's mods on one claude.ai: every mailbox artifact is one fake db that enforces the mailbox's rules (only
// its owner writes; whoever it is shared with reads), Artifact publish and the shared list answer as
// the spike measured them, and every person's mod runs on one shared clock. One process holds one copy of the
// mod's modules (the test runner refuses a dynamic import), so the people differ by their Host: own store, own
// tool caller (their uid), own room records. What is module-wide (the connection flag, the pane's viewing room,
// the invite timer) is shared, and the walk is written so that does not matter.
import { parseCommand, runCommand } from '../hooks/commands'
import type { CallResult } from '../hooks/host'
import { wireIdentity } from '../hooks/identity'
import { wireLive } from '../hooks/live'
import { wireResponder } from '../hooks/responder-wire'
import { wireRetention } from '../hooks/retention'
import { acceptInvite } from '../hooks/join'
import { syncOf } from '../hooks/room-loop'
import { loadRooms, loadSettings, saveRooms, saveSettings, type RoomRecord } from '../hooks/rooms'
import type { Run } from '../hooks/run'
import type { Receipt } from '../hooks/state-types'
import { receiptOf } from '../hooks/timeline'
import { runTool, type ToolOut } from '../hooks/tools'
import * as T from './db-texts'
import { fakeAgent, gitIn, type FakeAgent } from './fake-agent'
import { callerAs, fakeDb, type FakeDb } from './fake-db'
import type { Scheduler } from './fake-host'

export const EMRE = 'u_EmreEmreEmreEmreEmre12'
export const ALPEREN = 'u_AlperenAlperenAlperen1'
export const REPO = 'partalemre/eliti'
// A hook's own budget: the ask tool waits inside it.
const HOOK_BUDGET_MS = 10_000

export type NetRoom = { url: string; db: FakeDb; title: string; sharedWith: Set<string> }
export type Net = { rooms: Map<string, NetRoom>; calls: Array<{ uid: string; url: string; action: string }>; published: number }

export const fakeNet = (): Net => ({ rooms: new Map(), calls: [], published: 0 })

function publish(net: Net, uid: string, html: string): CallResult {
  net.published += 1
  const url = `https://claude.ai/artifact/E2eRoom${net.published}`
  const db = fakeDb(uid)
  db.owner = uid
  net.rooms.set(url, { url, db, title: /<title>(.*?)<\/title>/.exec(html)?.[1] ?? '', sharedWith: new Set() })
  return { result: { url }, text: `Published at ${url}` }
}

// Spike R3: the shared list is structured `{ title, url, rel }`.
function sharedList(net: Net, uid: string): CallResult {
  const artifacts = [...net.rooms.values()].filter(r => r.sharedWith.has(uid)).map(r => ({ title: r.title, url: r.url, rel: 'shared' }))
  return { result: { artifacts }, text: '' }
}

function toolFor(net: Net, uid: string, written: () => Record<string, string>) {
  return async (input: Record<string, unknown>): Promise<CallResult> => {
    if (input.tool === 'Artifact' && input.action === 'publish') return publish(net, uid, written()[String(input.file_path)] ?? '')
    if (input.tool === 'Artifact') return sharedList(net, uid)
    net.calls.push({ uid, url: String(input.url), action: String(input.action) })
    const room = net.rooms.get(String(input.url))
    // Someone the room was never shared with reads it as missing (spike: "no such artifact … (or no access …)").
    if (room === undefined || (room.db.owner !== uid && !room.sharedWith.has(uid))) return { isError: true, text: T.MISSING }
    return callerAs(room.db, uid)(input)
  }
}

// git and gh as each person's machine answers them: the repo is partalemre/eliti, `collaborators` says who is one.
export function machine(opts: { collaborators: Set<string> }): Run {
  return gitIn(REPO, async argv => {
    if (argv.includes('status')) return { exitCode: 0, stdout: '## main\n M lib/a.dart\n', stderr: '' }
    if (argv.includes('check-ignore')) return { exitCode: 1, stdout: '', stderr: '' }
    const collab = /^repos\/partalemre\/eliti\/collaborators\/(.+)$/.exec(argv[0] === 'gh' ? argv[2] ?? '' : '')
    if (collab !== null) return { exitCode: opts.collaborators.has(collab[1]?.toLowerCase() ?? '') ? 0 : 1, stdout: '', stderr: '' }
    return { exitCode: 0, stdout: '', stderr: '' }
  })
}

export type PersonOpts = { net: Net; sched: Scheduler; uid: string; gh: string; run: Run }

export async function person(opts: PersonOpts): Promise<FakeAgent> {
  const host: FakeAgent = fakeAgent(toolFor(opts.net, opts.uid, () => host.written), opts.run, opts.sched)
  await saveSettings(host, { ...(await loadSettings(host)), gh: opts.gh })
  return host
}

// A second session of the same person: the same store (settings, budget, drafts) except its own room records and
// sync states, which one process cannot hold twice under the same room id.
export function sameStore(session: FakeAgent, first: FakeAgent): void {
  const isOwn = (key: string) => key === 'tx.rooms' || key.startsWith('tx.sync.')
  const clone = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)) as unknown)
  session.storeGet = async key => clone((isOwn(key) ? session.store : first.store).get(key))
  session.storeSet = async (key, value) => { (isOwn(key) ? session.store : first.store).set(key, clone(value)) }
}

// The person's mod as session.start wires it (without the pane, whose port is one per process).
export const wireMod = (host: FakeAgent): Array<() => void> =>
  [wireResponder(host), wireIdentity(host), wireLive(host), wireRetention(host)]

export async function command(host: FakeAgent, args: string): Promise<string | null> {
  return runCommand({ host, openPane: async () => undefined, cmd: parseCommand(args) })
}

// A room by any of its mailboxes: the person's own or another member's.
const isIn = (r: RoomRecord, url: string) => r.url === url || r.boxes.includes(url)

export async function roomOf(host: FakeAgent, url: string): Promise<RoomRecord> {
  const room = (await loadRooms(host)).find(r => isIn(r, url))
  if (room === undefined) throw new Error(`no room ${url}`)
  return room
}

async function patchRoom(host: FakeAgent, url: string, patch: Partial<RoomRecord>): Promise<RoomRecord> {
  const rooms = (await loadRooms(host)).map(r => (isIn(r, url) ? { ...r, ...patch } : r))
  await saveRooms(host, rooms)
  return roomOf(host, url)
}

// What the pane's "Kabul et" does: it publishes the person's own mailbox for the room, whose url it returns.
export async function accept(host: FakeAgent, url: string): Promise<string> {
  const invite = await roomOf(host, url)
  return (await acceptInvite({ host, invite, consent: 'The user pressed "Kabul et"' })).url
}

// The owner opens their mailbox to another person through claude.ai's Paylaş menu.
export function share(net: Net, url: string, uid: string): void {
  const room = net.rooms.get(url)
  if (room === undefined) throw new Error(`no mailbox ${url}`)
  room.sharedWith.add(uid)
}

// What the pane's GitHub card "Evet" does.
export async function confirmGh(host: FakeAgent, url: string, peer: { uid: string; gh: string }): Promise<void> {
  const room = await roomOf(host, url)
  await patchRoom(host, url, { peers: [...room.peers.filter(p => p.uid !== peer.uid), { ...peer, isGhConfirmed: true }] })
}

// What the model's tool call runs, inside a hook budget that the tool's sleeps use up.
export async function agentTool(host: FakeAgent, name: string, input: Record<string, unknown> = {}): Promise<ToolOut> {
  const start = host.clock.now
  return runTool({ host, budgetLeft: () => HOOK_BUDGET_MS - (host.clock.now - start) }, { name, input })
}

// The receipt the person's pane draws under their own message with this text.
export async function receipt(host: FakeAgent, url: string, text: string): Promise<Receipt | null> {
  const room = await roomOf(host, url)
  const sync = syncOf(room.id)
  const entry = sync?.entries.find(e => 'text' in e.message && e.message.text === text)
  if (sync === undefined || entry === undefined) return null
  const peers = Object.entries(sync.peers).filter(([uid]) => uid !== sync.selfUid).map(([, h]) => h)
  return receiptOf({ entry, selfUid: sync.selfUid, peers, isReceiptsOn: (await loadSettings(host)).isReceiptsOn })
}

export async function textsIn(host: FakeAgent, url: string): Promise<string[]> {
  const room = await roomOf(host, url)
  return (syncOf(room.id)?.entries ?? []).flatMap(e => ('text' in e.message ? [e.message.text] : []))
}

export const resultOf = (out: ToolOut): string => ('result' in out ? out.result : `deny: ${out.deny}`)
