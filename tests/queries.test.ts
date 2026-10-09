import { expect, test } from 'claude-code/testing'
import { DENIED, utf8Bytes } from '../hooks/protocol'
import { answerTyped, trimBytes } from '../hooks/queries'
import type { Run } from '../hooks/run'

const git = (map: Record<string, string>, calls: string[][] = []): Run => async argv => {
  calls.push([...argv])
  if (argv[0] === 'realpath') return { exitCode: 0, stdout: `${argv[1]}\n`, stderr: '' }
  if (argv.includes('check-ignore')) return { exitCode: 1, stdout: '', stderr: '' }
  // The subcommand and its first argument, after git's own options (`--no-pager`, `-c …`, `-C root`).
  const at = argv.indexOf('-C') + 2
  const key = argv.slice(at, at + 2).join(' ')
  return { exitCode: 0, stdout: map[key] ?? '', stderr: '' }
}
const ctx = (map: Record<string, string>, files: Record<string, string> = {}, calls: string[][] = []) => ({
  run: git(map, calls), root: '/w', readFile: async (p: string) => files[p] ?? '', readState: async () => undefined,
})
const q = (type: string, extra = {}) => ({ type, repo: 'partalemre/eliti', ...extra }) as never
const AWS = 'const k = "AKIAIOSFODNN7EXAMPLE";'

test('status summarises branch and changed files', async () => {
  const out = await answerTyped(ctx({ 'status --porcelain=v1': '## main...origin/main [ahead 2]\n M a.dart\n?? b.dart\n' }), q('status'))
  expect(out).toEqual({ ok: true, body: 'main...origin/main [ahead 2] · 2 değişen dosya' })
})

test('file returns content; a secret-bearing file is denied with the same text as any refusal', async () => {
  expect(await answerTyped(ctx({}, { '/w/lib/a.dart': 'void main() {}' }), q('file', { path: 'lib/a.dart' }))).toEqual({ ok: true, body: 'void main() {}' })
  expect(await answerTyped(ctx({}, { '/w/lib/k.dart': AWS }), q('file', { path: 'lib/k.dart' }))).toEqual({ ok: false, body: DENIED })
  expect(await answerTyped(ctx({}), q('file', { path: '.env.production' }))).toEqual({ ok: false, body: DENIED })
  expect(await answerTyped(ctx({}), q('file'))).toEqual({ ok: false, body: DENIED })
})

test('a file is sent whole up to 256 KB; bigger or binary files are denied', async () => {
  const big = 'a'.repeat(100_000)
  expect(await answerTyped(ctx({}, { '/w/big.txt': big }), q('file', { path: 'big.txt' }))).toEqual({ ok: true, body: big })
  const huge = 'a'.repeat(262_145)
  expect(await answerTyped(ctx({}, { '/w/huge.txt': huge }), q('file', { path: 'huge.txt' }))).toEqual({ ok: false, body: DENIED })
  expect(await answerTyped(ctx({}, { '/w/x.bin': 'ab\u0000cd' }), q('file', { path: 'x.bin' }))).toEqual({ ok: false, body: DENIED })
})

test('a file that cannot be read is denied, not an error', async () => {
  const c = { ...ctx({}), readFile: async () => { throw new Error('ENOENT') } }
  expect(await answerTyped(c, q('file', { path: 'gone.txt' }))).toEqual({ ok: false, body: DENIED })
})

test('diff is capped at 64 KB on a character boundary', () => {
  const big = 'ş'.repeat(40_000)
  const out = trimBytes(big, 65_536)
  expect(out.endsWith('…[kırpıldı]')).toBe(true)
  expect(utf8Bytes(out) <= 65_536).toBe(true)
  expect(trimBytes('kısa', 65_536)).toBe('kısa')
  expect(trimBytes('😀'.repeat(10), 20).includes('�')).toBe(false)
})

test('diff leaves out denied paths and reads paths literally', async () => {
  const calls: string[][] = []
  const map = { 'diff --name-only': 'lib/a.dart\u0000.env\u0000keys/prod.pem\u0000', 'diff --no-color': 'diff --git a/lib/a.dart b/lib/a.dart\n+x\n' }
  const out = await answerTyped(ctx(map, {}, calls), q('diff'))
  expect(out).toEqual({ ok: true, body: 'diff --git a/lib/a.dart b/lib/a.dart\n+x\n' })
  const diff = calls.find(c => c.includes('--no-color')) ?? []
  expect(diff.includes('--no-ext-diff') && diff.includes('--no-textconv')).toBe(true)
  expect(diff.slice(diff.indexOf('--') + 1)).toEqual([':(literal)lib/a.dart'])
})

test('diff with nothing shareable says so and runs no diff', async () => {
  const calls: string[][] = []
  expect(await answerTyped(ctx({ 'diff --name-only': '.env\u0000' }, {}, calls), q('diff'))).toEqual({ ok: true, body: 'değişiklik yok' })
  expect(calls.some(c => c.includes('--no-color'))).toBe(false)
})

test('a secret past the 64 KB cut still denies the whole diff', async () => {
  const body = `${'+a\n'.repeat(30_000)}+${AWS}\n`
  const out = await answerTyped(ctx({ 'diff --name-only': 'a.ts\u0000', 'diff --no-color': body }), q('diff'))
  expect(out).toEqual({ ok: false, body: DENIED })
})

test('log and branch answer from git; a failing git is a denial', async () => {
  expect(await answerTyped(ctx({ 'log -n20': 'abc123 fix: x (Emre, 2 hours ago)' }), q('log'))).toEqual({ ok: true, body: 'abc123 fix: x (Emre, 2 hours ago)' })
  const failing = { ...ctx({}), run: (async () => ({ exitCode: 128, stdout: '', stderr: 'fatal' })) as Run }
  expect(await answerTyped(failing, q('log'))).toEqual({ ok: false, body: DENIED })
  expect(await answerTyped(failing, q('status'))).toEqual({ ok: false, body: DENIED })
  const throwing = { ...ctx({}), run: (async () => { throw new Error('timeout') }) as Run }
  expect(await answerTyped(throwing, q('branch'))).toEqual({ ok: false, body: DENIED })
})

test('tests and plan read other mods\' state read-only, and say so when there is none', async () => {
  expect(await answerTyped(ctx({}), q('tests'))).toEqual({ ok: true, body: 'kayıt yok' })
  const seen: string[] = []
  const withState = { ...ctx({}), readState: async (plugin: string, key: string) => { seen.push(`${plugin}:${key}`); return { passed: 3 } } }
  expect(await answerTyped(withState, q('plan'))).toEqual({ ok: true, body: '{"passed":3}' })
  expect(seen).toEqual(['plan-steps:tasks'])
  const leaky = { ...ctx({}), readState: async () => ({ note: AWS }) }
  expect(await answerTyped(leaky, q('tests'))).toEqual({ ok: false, body: DENIED })
})

test('ask and unknown types never get a typed answer', async () => {
  expect(await answerTyped(ctx({}), q('ask', { question: 'neden?' }))).toEqual({ ok: false, body: DENIED })
  expect(await answerTyped(ctx({}), q('shell'))).toEqual({ ok: false, body: DENIED })
})

test('a secret in any answer, however produced, is denied', async () => {
  expect(await answerTyped(ctx({ 'log -n20': `abc ${AWS}` }), q('log'))).toEqual({ ok: false, body: DENIED })
  expect(await answerTyped(ctx({ 'branch --format=%(refname:short)': 'ghp_' + 'a'.repeat(36) }), q('branch'))).toEqual({ ok: false, body: DENIED })
})
