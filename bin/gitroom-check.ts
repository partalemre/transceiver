import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// The git room against real git: two people's mailboxes and a bare repo between them, in a temp folder.
// Run: bun bin/gitroom-check.ts   (the plugin's own tests may not start a process, so this lives outside them)
import { deepStrictEqual } from 'node:assert'
import { forgetBoxes, gitUrl, peersOf, pushed, REFRESH_MS, type GitIo } from '../hooks/gitbox'
import { gitDb } from '../hooks/gitdb'
import type { Message } from '../hooks/protocol'
import { relayOf } from '../hooks/relay'

const cases: Array<[string, () => Promise<void>]> = []
const test = (name: string, fn: () => Promise<void>) => { cases.push([name, fn]) }
const expect = (got: unknown) => ({ toBe: (want: unknown) => deepStrictEqual(got, want), toEqual: (want: unknown) => deepStrictEqual(got, want) })

const REPO = 'team/app'
const A = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const B = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const ID1 = '01K7A0000000000000000000A1'
const ID2 = '01K7A0000000000000000000A2'
const msg = (id: string, ts: number, text = `m${ts}`): Message => ({ v: 1, id, ts, kind: 'human', text })

// Two people's computers and the repo between them: three folders, real git.
function world() {
  const root = mkdtempSync(join(tmpdir(), 'tx-git-'))
  const remote = join(root, 'remote.git')
  execFileSync('git', ['init', '--bare', '-q', remote])
  const clock = { now: 1_800_000_000_000 }
  const ioOf = (uid: string, remotes = [remote]): GitIo => ({
    run: async (argv, init) => {
      const out = spawnSync(argv[0] as string, argv.slice(1), { input: init.stdin, env: { ...process.env, ...init.env }, encoding: 'utf8' })
      return { exitCode: out.status ?? 1, stdout: out.stdout, stderr: out.stderr }
    },
    dir: async () => join(root, `${uid}.git`),
    remotes: async () => remotes,
    selfUid: async () => uid,
    now: async () => clock.now,
  })
  // Each person's mod keeps its own memory; one process plays both, so the memory is dropped between them.
  const as = (uid: string, remotes?: string[]) => {
    forgetBoxes()
    const io = ioOf(uid, remotes)
    return { io, relay: (box: string) => relayOf(input => gitDb(io, input), gitUrl(REPO, box)) }
  }
  return { remote, clock, as }
}

test('a message one person sends reaches the other through the repo', async () => {
  const w = world()
  const a = w.as(A)
  expect(await a.relay(A).whoami()).toBe(A)
  const own = await a.relay(A).send({ uid: A, message: msg(ID1, 10, 'selam') })
  expect(own.version).toBe(1)
  await a.relay(A).send({ uid: A, message: msg(ID2, 20, 'naber'), known: own })
  await pushed(REPO)

  const b = w.as(B)
  const heads = await b.relay(A).heads()
  expect(heads.map(h => [h.uid, h.head.head])).toEqual([[A, ID2]])
  expect(peersOf(REPO, B)).toEqual([A])
  const got = await b.relay(A).since(A, 10)
  expect(got.map(m => ('text' in m ? m.text : ''))).toEqual(['naber'])
})

test('nobody writes another member\'s mailbox, and a claim is taken once', async () => {
  const w = world()
  const a = w.as(A)
  await a.relay(A).send({ uid: A, message: msg(ID1, 10) })
  expect(await a.relay(A).claim({ uid: A, qid: ID2, now: 1 })).toBe(true)
  expect(await a.relay(A).claim({ uid: A, qid: ID2, now: 2 })).toBe(false)
  await pushed(REPO)
  const b = w.as(B)
  let refused = false
  await b.relay(A).send({ uid: A, message: msg(ID2, 20) }).catch(() => { refused = true })
  expect(refused).toBe(true)
})

test('a line written while the repo cannot be reached goes up on a later look', async () => {
  const w = world()
  const a = w.as(A)
  await a.relay(A).send({ uid: A, message: msg(ID1, 10) })
  await pushed(REPO)
  // The remote goes away under an open mailbox: the line is kept here.
  execFileSync('mv', [w.remote, `${w.remote}.off`])
  await a.relay(A).send({ uid: A, message: msg(ID2, 20) })
  await pushed(REPO)
  execFileSync('mv', [`${w.remote}.off`, w.remote])
  w.clock.now += REFRESH_MS
  await a.relay(A).heads()
  await pushed(REPO)
  const b = w.as(B)
  expect((await b.relay(A).since(A, 0)).length).toBe(2)
})

test('the first address that answers is the one used', async () => {
  const w = world()
  const a = w.as(A, ['/nowhere/at/all.git', w.remote])
  await a.relay(A).send({ uid: A, message: msg(ID1, 10) })
  await pushed(REPO)
  expect((await w.as(B).relay(A).heads()).length).toBe(1)
})

let failed = 0
for (const [name, fn] of cases) {
  try {
    await fn()
    console.log(`(pass) ${name}`)
  } catch (err) {
    failed += 1
    console.log(`(fail) ${name}\n  ${err instanceof Error ? err.message.split('\n').slice(0, 6).join('\n  ') : String(err)}`)
  }
}
process.exit(failed === 0 ? 0 : 1)
