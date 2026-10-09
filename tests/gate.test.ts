import { expect, test } from 'claude-code/testing'
import { ghCheck, mcpCheck, ownLogin, repoOfRemote, sessionRepo } from '../hooks/github'
import { makeGate, type GateRoom } from '../hooks/gate'
import type { Run } from '../hooks/run'

const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const room: GateRoom = { kind: 'project', repo: 'partalemre/eliti', peers: [{ uid: PEER, gh: 'alperenx', isGhConfirmed: true }] }
const query = { type: 'status' as const, repo: 'partalemre/eliti' }
const base = { room, peerUid: PEER, query, sessionRepo: 'partalemre/eliti', headGh: 'alperenx', now: 0, otherMembers: 1 }
const out = (exitCode: number, stdout = '') => ({ exitCode, stdout, stderr: '' })

test('remotes parse in ssh and https forms', () => {
  expect(repoOfRemote('git@github.com:partalemre/eliti.git')).toBe('partalemre/eliti')
  expect(repoOfRemote('https://github.com/partalemre/eliti')).toBe('partalemre/eliti')
  expect(repoOfRemote('https://gitlab.com/x/y.git')).toBe(null)
})

test('only a real github.com remote parses', () => {
  expect(repoOfRemote('ssh://git@github.com/a/b.git\n')).toBe('a/b')
  expect(repoOfRemote('https://x-access-token@github.com/a/b.git/')).toBe('a/b')
  for (const bad of ['https://evil.com/github.com/a/b', 'https://github.com.evil.com/a/b', 'git@github.com:a/b/c',
    'https://github.com/a/..', 'https://github.com/a', 'file:///github.com/a/b', '']) {
    expect(repoOfRemote(bad)).toBe(null)
  }
})

test('session repo and own login come from git and gh, and fail to null', async () => {
  const run: Run = async argv => (argv.includes('get-url') ? out(0, 'git@github.com:a/b.git\n') : out(0, 'alperenx\n'))
  expect(await sessionRepo(run, '/w')).toBe('a/b')
  expect(await ownLogin(run)).toBe('alperenx')
  const bad: Run = async argv => (argv.includes('get-url') ? out(2) : out(0, 'not a login!\n'))
  expect(await sessionRepo(bad, '/w')).toBe(null)
  expect(await ownLogin(bad)).toBe(null)
})

test('all four conditions open the gate', async () => {
  expect(await makeGate(async () => true)(base)).toBe(true)
})

test('each failing condition closes it', async () => {
  const gate = makeGate(async () => true)
  expect(await gate({ ...base, sessionRepo: 'partalemre/other' })).toBe(false)
  expect(await gate({ ...base, sessionRepo: null })).toBe(false)
  expect(await gate({ ...base, query: { ...query, repo: 'partalemre/other' } })).toBe(false)
  expect(await gate({ ...base, room: { ...room, kind: 'dm' } })).toBe(false)
  expect(await gate({ ...base, room: { ...room, peers: [{ uid: PEER, gh: 'alperenx', isGhConfirmed: false }] } })).toBe(false)
  expect(await gate({ ...base, room: { ...room, peers: [{ uid: PEER, isGhConfirmed: true }] } })).toBe(false)
  expect(await gate({ ...base, peerUid: 'u_CCCCCCCCCCCCCCCCCCCCCC' })).toBe(false)
  expect(await makeGate(async () => false)(base)).toBe(false)
})

test('owner, repo and login compare case-insensitively, as GitHub does', async () => {
  const seen: string[] = []
  const gate = makeGate(async ({ repo, login }) => { seen.push(`${repo}#${login}`); return true })
  const upper = { ...base, sessionRepo: 'PartalEmre/Eliti', headGh: 'AlperenX', query: { ...query, repo: 'partalEmre/ELITI' } }
  expect(await gate(upper)).toBe(true)
  expect(await gate({ ...base, room: { ...room, repo: 'PARTALEMRE/eliti' } })).toBe(true)
  expect(seen.length).toBe(1)
})

test('a head that now names another login than the confirmed one closes the gate', async () => {
  const gate = makeGate(async () => true)
  expect(await gate({ ...base, headGh: 'torvalds' })).toBe(false)
  expect(await gate({ ...base, headGh: undefined })).toBe(false)
})

test('a check that throws closes the gate, and results are cached for 10 minutes', async () => {
  let calls = 0
  const gate = makeGate(async () => { calls++; throw new Error('offline') })
  expect(await gate(base)).toBe(false)
  expect(await gate(base)).toBe(false)
  expect(calls).toBe(2)
  let n = 0
  const cached = makeGate(async () => { n++; return true })
  await cached(base)
  await cached({ ...base, now: 599_999 })
  await cached({ ...base, now: 600_001 })
  expect(n).toBe(2)
})

test('a cached yes for one login never opens the gate for another', async () => {
  const seen: string[] = []
  const gate = makeGate(async ({ login }) => { seen.push(login); return login === 'alperenx' })
  expect(await gate(base)).toBe(true)
  const other = { ...room, peers: [{ uid: PEER, gh: 'mallory', isGhConfirmed: true }] }
  expect(await gate({ ...base, room: other, headGh: 'mallory' })).toBe(false)
  expect(seen).toEqual(['alperenx', 'mallory'])
})

test('gh check: exit 0 is a collaborator, anything else is not', async () => {
  const yes = ghCheck(async () => out(0))
  const no = ghCheck(async () => ({ exitCode: 1, stdout: '', stderr: 'HTTP 404' }))
  expect(await yes({ repo: 'a/b', login: 'x' })).toBe(true)
  expect(await no({ repo: 'a/b', login: 'x' })).toBe(false)
})

test('gh check never runs for a malformed repo or login', async () => {
  let ran = 0
  const check = ghCheck(async () => { ran++; return out(0) })
  expect(await check({ repo: 'a/b/../c', login: 'x' })).toBe(false)
  expect(await check({ repo: 'a/b', login: 'x/../../user' })).toBe(false)
  expect(await check({ repo: 'a/b', login: '-x' })).toBe(false)
  expect(ran).toBe(0)
})

const mcpOf = (text: string, isError = false) => ({
  mcp: { call: async () => ({ content: [{ type: 'text' as const, text }], isError }) },
})
const list = (...logins: string[]) => JSON.stringify({ items: logins.map(login => ({ login, id: 1 })), nextPage: 0 })

test('mcp check: a login in the list is a yes; a miss, an error or no server asks gh', async () => {
  let asked = 0
  const fallback = async () => { asked++; return false }
  expect(await mcpCheck(mcpOf(list('partalemre', 'AlperenX')), fallback)({ repo: 'a/b', login: 'alperenx' })).toBe(true)
  expect(asked).toBe(0)
  expect(await mcpCheck(mcpOf(list('alperenxx', 'xalperenx')), fallback)({ repo: 'a/b', login: 'alperenx' })).toBe(false)
  expect(await mcpCheck(mcpOf('{"login":"alperenx"', true), fallback)({ repo: 'a/b', login: 'alperenx' })).toBe(false)
  expect(await mcpCheck(mcpOf('not json "login":"alperenx"'), fallback)({ repo: 'a/b', login: 'alperenx' })).toBe(false)
  const absent = { mcp: { call: async () => { throw new Error('no such server') } } }
  expect(await mcpCheck(absent, fallback)({ repo: 'a/b', login: 'alperenx' })).toBe(false)
  expect(asked).toBe(4)
})

test('agent traffic runs only between two people: a third member closes the gate', async () => {
  const gate = makeGate(async () => true)
  expect(await gate(base)).toBe(true)
  expect(await gate({ ...base, otherMembers: 2 })).toBe(false)
  expect(await gate({ ...base, otherMembers: 0 })).toBe(false)
})
