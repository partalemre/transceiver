// A project room that lives in the project's own GitHub repo: no artifact, nothing to share, no link to paste.
// Each member writes one ref of their own there (`refs/transceiver/<uid>`, outside branches and tags, so no CI, no
// pull request and no branch rule ever sees it) and reads everyone else's. Whoever can push to the repo is in.
//
// The mailbox is kept in a bare repository of its own under the person's home folder: the project's checkout, its
// index, its branches and its hooks are never touched. A document is one file holding one line of JSON.
import { utf8Bytes } from './protocol'

export type GitResult = { exitCode: number; stdout: string; stderr: string }
export type GitRun = (argv: string[], init: { stdin?: string; env?: Record<string, string>; timeoutMs?: number }) => Promise<GitResult>
// `dir` is where the room's own bare repository is kept; `remotes` the addresses to reach `repo` at, best first;
// `selfUid` this computer's id in git rooms.
export type GitIo = {
  run: GitRun
  dir(repo: string): Promise<string>
  remotes(repo: string): Promise<string[]>
  selfUid(): Promise<string>
  now(): Promise<number>
}
export type Row = { id: string; data: Record<string, unknown>; version: number }
export type Op = { path: string; row: Row | null }
// `isAhead`: the own mailbox holds a commit the repo lacks. `pushing` is the push under way, `hasMore` a commit made
// during it, `pushFails` how many pushes in a row were refused.
export type Box = {
  repo: string; dir: string; remote: string; at: number; shas: Record<string, string>; hasOwn: boolean; isAhead: boolean
  pushing: Promise<void> | null; hasMore: boolean; pushFails: number
}

const GIT_PREFIX = 'git:'
const REMOTE_NS = 'refs/transceiver/'
const PEER_NS = 'refs/tx/'
export const OWN_REF = 'refs/own/box'
// One look at the remote serves every read made within this long: a poll reads several collections.
export const REFRESH_MS = 2_500
const GIT_TIMEOUT_MS = 20_000
// Never ask for a password: a missing credential is a failure, not a prompt nobody sees.
const ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
const UID = /^u_[A-Za-z0-9_-]{22}$/
const SAFE_PATH = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/
const NO_MATCH = 1
const PUSH_FAILS_SHOWN = 3
const NO_REF = /unable to resolve revision|bad revision|not a valid object name/i
const DOC_EXT = '.json'

export const isGitUrl = (url: unknown): url is string => typeof url === 'string' && url.startsWith(GIT_PREFIX)
export const gitUrl = (repo: string, uid: string): string => `${GIT_PREFIX}${repo}#${uid}`
export function parseGitUrl(url: unknown): { repo: string; uid: string } | null {
  if (!isGitUrl(url)) return null
  const [repo, uid] = url.slice(GIT_PREFIX.length).split('#')
  return repo !== undefined && uid !== undefined && UID.test(uid) ? { repo, uid } : null
}
export const isSafePath = (path: string): boolean => SAFE_PATH.test(path) && !path.split('/').includes('..')
export const refOf = (uid: string, self: string): string => (uid === self ? OWN_REF : `${PEER_NS}${uid}`)

const boxes = new Map<string, Box>()
const chains = new Map<string, Promise<unknown>>()

export const forgetBoxes = (): void => { boxes.clear(); chains.clear() }

function git(io: GitIo, box: Pick<Box, 'dir'>, args: string[], stdin?: string): Promise<GitResult> {
  // A hooks folder that does not exist: a hook the person set for every repo never runs on the mailbox.
  const base = ['git', '--git-dir', box.dir, '-c', `core.hooksPath=${box.dir}/no-hooks`, '-c', 'credential.interactive=false', '-c', 'gc.auto=0']
  return io.run([...base, ...args], { env: ENV, stdin, timeoutMs: GIT_TIMEOUT_MS })
}

const listRemote = (io: GitIo, box: Pick<Box, 'dir'>, remote: string) => git(io, box, ['ls-remote', remote, `${REMOTE_NS}*`])

// The first address that answers is kept: https comes first (about a second a call, where ssh takes three to five)
// and works with the credentials git already holds; the checkout's own remote is the fallback.
async function pickRemote(io: GitIo, repo: string, dir: string): Promise<string> {
  for (const remote of await io.remotes(repo)) {
    if ((await listRemote(io, { dir }, remote)).exitCode === 0) return remote
  }
  throw new Error('transceiver: the repo cannot be reached')
}

// Whether anyone has a mailbox in the repo yet: one call, and no folder made on this computer.
export async function peek(io: GitIo, repo: string): Promise<boolean> {
  for (const remote of await io.remotes(repo)) {
    const out = await io.run(['git', 'ls-remote', remote, `${REMOTE_NS}*`], { env: ENV, timeoutMs: GIT_TIMEOUT_MS })
    if (out.exitCode === 0) return Object.keys(parseRefs(out.stdout, REMOTE_NS)).length > 0
  }
  return false
}

// A room's lines can be fetched by whoever can read the repo, so a repo the whole world reads gets no room. Asked
// without any credential first: an answer means anyone gets one. A repo that answers only with the person's own
// credentials is private; one that never answers is not decided, and nothing is opened on a guess.
export async function visibilityOf(io: GitIo, repo: string): Promise<'public' | 'private' | 'unreachable'> {
  const anonymous = ['git', '-c', 'credential.helper=', 'ls-remote', `https://github.com/${repo}.git`, 'HEAD']
  const open = await io.run(anonymous, { env: { ...ENV, GIT_ASKPASS: 'echo' }, timeoutMs: GIT_TIMEOUT_MS })
  if (open.exitCode === 0) return 'public'
  for (const remote of await io.remotes(repo)) {
    const out = await io.run(['git', 'ls-remote', remote, 'HEAD'], { env: ENV, timeoutMs: GIT_TIMEOUT_MS })
    if (out.exitCode === 0) return 'private'
  }
  return 'unreachable'
}

async function open(io: GitIo, repo: string): Promise<Box> {
  const held = boxes.get(repo)
  if (held !== undefined) return held
  const dir = await io.dir(repo)
  const made = await io.run(['git', 'init', '--bare', '-q', dir], { env: ENV, timeoutMs: GIT_TIMEOUT_MS })
  if (made.exitCode !== 0) throw new Error('transceiver: the mailbox folder could not be made')
  const hasOwn = (await git(io, { dir }, ['rev-parse', '-q', '--verify', OWN_REF])).exitCode === 0
  const box: Box = { repo, dir, remote: await pickRemote(io, repo, dir), at: 0, shas: {}, hasOwn, isAhead: hasOwn, pushing: null, hasMore: false, pushFails: 0 }
  boxes.set(repo, box)
  return box
}

// One git call at a time per repo: a poll and a send never run beside each other.
export async function withBox<T>(io: GitIo, repo: string, fn: (box: Box) => Promise<T>): Promise<T> {
  const before = chains.get(repo) ?? Promise.resolve()
  const run = before.then(() => open(io, repo)).then(fn)
  chains.set(repo, run.catch(() => undefined))
  return run
}

function parseRefs(stdout: string, namespace: string): Record<string, string> {
  const shas: Record<string, string> = {}
  for (const line of stdout.split('\n')) {
    const [sha, ref] = line.split('\t')
    const uid = ref?.startsWith(namespace) === true ? ref.slice(namespace.length) : ''
    if (sha !== undefined && UID.test(uid)) shas[uid] = sha
  }
  return shas
}

async function pushOnce(io: GitIo, box: Box, self: string): Promise<void> {
  do {
    box.hasMore = false
    const out = await git(io, box, ['push', '-q', box.remote, `${OWN_REF}:${REMOTE_NS}${self}`]).catch(() => null)
    if (out?.exitCode !== 0) {
      box.pushFails += 1
      return
    }
    box.pushFails = 0
    box.isAhead = box.hasMore
  } while (box.hasMore)
}

// The push runs behind the write that asked for it: a line shows as written the moment it is in the mailbox, and
// reaches the repo a second or two later. One push at a time; a commit made meanwhile goes up right after.
function pushSoon(io: GitIo, box: Box, self: string): void {
  if (box.pushing !== null) {
    box.hasMore = true
    return
  }
  box.pushing = pushOnce(io, box, self).finally(() => { box.pushing = null })
}

// For a check that reads the repo right after a write.
export const pushed = async (repo: string): Promise<void> => { await boxes.get(repo)?.pushing }

// The own mailbox goes up when it holds something the remote lacks; one made on this computer before (the bare
// repository was lost, the id kept) is taken back from the copy the fetch brought. Pushes that keep being refused
// (no right to write to the repo) fail the poll, so the room shows the trouble instead of lines that never leave.
function syncOwn(io: GitIo, box: Box, self: string): void {
  if (box.pushFails >= PUSH_FAILS_SHOWN) {
    box.pushFails = 0
    throw new Error('transceiver: git push failed')
  }
  if (box.hasOwn && box.isAhead) pushSoon(io, box, self)
}

async function restoreOwn(io: GitIo, box: Box, self: string): Promise<void> {
  if (box.hasOwn || box.shas[self] === undefined) return
  const got = await git(io, box, ['update-ref', OWN_REF, `${PEER_NS}${self}`])
  if (got.exitCode !== 0) throw new Error('transceiver: the mailbox could not be restored')
  box.hasOwn = true
}

// One trip to GitHub brings every mailbox that moved; which ones exist is then read here, off the network.
export async function refresh(io: GitIo, box: Box, self: string): Promise<void> {
  const now = await io.now()
  if (box.at !== 0 && now - box.at < REFRESH_MS) return
  const got = await git(io, box, ['fetch', '-q', '--prune', box.remote, `+${REMOTE_NS}*:${PEER_NS}*`])
  if (got.exitCode !== 0) throw new Error('transceiver: git fetch failed')
  const out = await git(io, box, ['for-each-ref', '--format=%(objectname)%09%(refname)', PEER_NS])
  if (out.exitCode !== 0) throw new Error('transceiver: the mailboxes could not be listed')
  box.shas = parseRefs(out.stdout, PEER_NS)
  box.at = now
  await restoreOwn(io, box, self)
  syncOwn(io, box, self)
}

// The other members' ids, as the last look at the remote showed them.
export const peersOf = (repo: string, self: string): string[] =>
  Object.keys(boxes.get(repo)?.shas ?? {}).filter(uid => uid !== self).sort()

function parseRow(ref: string, line: string): [string, Row] | null {
  if (!line.startsWith(`${ref}:`)) return null
  const rest = line.slice(ref.length + 1)
  const cut = rest.indexOf(`${DOC_EXT}:`)
  if (cut < 0) return null
  const path = rest.slice(0, cut)
  try {
    const doc = JSON.parse(rest.slice(cut + DOC_EXT.length + 1)) as { data?: unknown; version?: unknown }
    const isDoc = typeof doc.data === 'object' && doc.data !== null && !Array.isArray(doc.data) && Number.isInteger(doc.version)
    return isDoc ? [path, { id: path.split('/').at(-1) ?? '', data: doc.data as Record<string, unknown>, version: doc.version as number }] : null
  } catch {
    // One bad file is one bad document, never the whole read.
    return null
  }
}

// Every document under the pathspecs, in one git call: a document is one line, so a grep for the empty text
// prints each file whole.
export async function rows(io: GitIo, box: Box, opts: { ref: string; specs: string[] }): Promise<Map<string, Row>> {
  const found = new Map<string, Row>()
  if (opts.specs.length === 0) return found
  const out = await git(io, box, ['grep', '--no-color', '-I', '-e', '', opts.ref, '--', ...opts.specs])
  // No file matched, or the mailbox has no ref yet (nobody wrote it): both are an empty read. Anything else is a
  // failure, never "empty": a write decides from this read what already exists.
  if (out.exitCode === NO_MATCH || NO_REF.test(out.stderr)) return found
  if (out.exitCode !== 0) throw new Error('transceiver: the mailbox could not be read')
  for (const line of out.stdout.split('\n')) {
    const row = parseRow(opts.ref, line)
    if (row !== null) found.set(row[0], row[1])
  }
  return found
}

export const inCollection = (collection: string): string => `:(glob)${collection}/*${DOC_EXT}`
export const oneDoc = (path: string): string => `:(literal)${path}${DOC_EXT}`

function importStream(ops: Op[], opts: { hasParent: boolean; at: number }): string {
  const lines = [`commit ${OWN_REF}`, `committer transceiver <transceiver@localhost> ${Math.floor(opts.at / 1000)} +0000`, 'data 2', 'tx']
  if (opts.hasParent) lines.push(`from ${OWN_REF}^0`)
  for (const op of ops) {
    if (op.row === null) {
      lines.push(`D ${op.path}${DOC_EXT}`)
      continue
    }
    const json = JSON.stringify({ data: op.row.data, version: op.row.version })
    lines.push(`M 100644 inline ${op.path}${DOC_EXT}`, `data ${utf8Bytes(json)}`, json)
  }
  return `${lines.join('\n')}\n`
}

// One commit on the own mailbox; the push follows behind it. A push that fails leaves the commit here, and the
// next look at the remote sends it.
export async function commit(io: GitIo, box: Box, opts: { ops: Op[]; self: string }): Promise<void> {
  const stream = importStream(opts.ops, { hasParent: box.hasOwn, at: await io.now() })
  const out = await git(io, box, ['fast-import', '--quiet'], stream)
  if (out.exitCode !== 0) throw new Error('transceiver: the mailbox could not be written')
  box.hasOwn = true
  box.isAhead = true
  pushSoon(io, box, opts.self)
}
