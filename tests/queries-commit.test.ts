import { expect, test } from 'claude-code/testing'
import { DENIED } from '../hooks/protocol'
import { answerTyped, type QueryCtx } from '../hooks/queries'

type Show = { header?: string; numstat?: string; revExit?: number; full?: string }
const FULL = 'a'.repeat(40)
const AWS = 'AKIAIOSFODNN7EXAMPLE'

function subOf(argv: string[]): string {
  let at = argv.indexOf('-C') + 2
  while (argv[at] === '-c') at += 2
  return argv[at] ?? ''
}

function world(s: Show = {}): { ctx: QueryCtx; calls: string[][] } {
  const calls: string[][] = []
  const run: QueryCtx['run'] = async argv => {
    calls.push([...argv])
    const sub = subOf(argv)
    const out = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '' })
    if (sub === 'rev-parse') return out(`${s.full ?? FULL}\n`, s.revExit ?? 0)
    if (sub === 'show' && argv.includes('-s')) return out(s.header ?? `aaaaaaa\u0000Emre\u00002026-10-09\u0000feat: x\u0000\n`)
    if (sub === 'show') return out(s.numstat ?? '')
    return out('', 128)
  }
  return { ctx: { run, root: '/w', readFile: async () => '', readState: async () => undefined }, calls }
}

const q = (sha: unknown) => ({ type: 'commit', repo: 'partalemre/eliti', sha }) as never
const header = (subject: string, body: string) => `aaaaaaa\u0000Emre\u00002026-10-09\u0000${subject}\u0000${body}\n`

test('commit shows subject, author, date, body and the changed files it may name', async () => {
  const numstat = ['3\t1\tlib/a.ts', '2\t0\t.env', '-\t-\tassets/logo.png', '1\t1\tkeys/prod.pem', '5\t0\t.github/ci.yml'].join('\u0000') + '\u0000'
  const { ctx } = world({ header: header('feat: x', 'Why it matters.\n'), numstat })
  expect(await answerTyped(ctx, q('aaaaaaa'))).toEqual({
    ok: true,
    body: [
      'aaaaaaa feat: x', 'Emre · 2026-10-09', '', 'Why it matters.', '',
      '3 dosya · +8 -1', '  lib/a.ts +3 -1', '  assets/logo.png (ikili)', '  .github/ci.yml +5 -0',
    ].join('\n'),
  })
})

test('the sha is held to a commit first, and every show turns off external diffs, textconv and signatures', async () => {
  const { ctx, calls } = world()
  await answerTyped(ctx, q('abcdef1'))
  expect(calls[0]?.slice(-4)).toEqual(['--verify', '--quiet', '--end-of-options', 'abcdef1^{commit}'])
  const shows = calls.filter(c => subOf(c) === 'show')
  expect(shows.length).toBe(2)
  for (const argv of shows) {
    expect(argv.slice(-2)).toEqual([FULL, '--'])
    expect(argv).toContain('log.showSignature=false')
    expect(argv).toContain('--no-notes')
    expect(argv.slice(0, 4)).toEqual(['git', '--no-pager', '-c', 'core.quotepath=off'])
  }
  const stat = shows.find(c => c.includes('--numstat')) ?? []
  for (const flag of ['--no-ext-diff', '--no-textconv', '--no-renames', '-z', '--relative']) expect(stat).toContain(flag)
})

test('a sha that is not 7–40 lower-case hex is denied before git runs', async () => {
  for (const sha of [undefined, '', 'abc12', '--output=x', '-n1', 'HEAD', 'main', 'ABCDEF1', 'abcdef1^{tree}', 'abcdef1:.env', 'a'.repeat(41), 'abcdef1 ']) {
    const { ctx, calls } = world()
    expect(await answerTyped(ctx, q(sha))).toEqual({ ok: false, body: DENIED })
    expect(calls).toEqual([])
  }
})

test('an unknown sha, or a name that is no commit (a tag on a blob), is a denial', async () => {
  expect(await answerTyped(world({ revExit: 1, full: '' }).ctx, q('1234567'))).toEqual({ ok: false, body: DENIED })
  expect(await answerTyped(world({ full: 'HEAD' }).ctx, q('1234567'))).toEqual({ ok: false, body: DENIED })
})

test('the body is cut to 2000 characters, but a secret past the cut still denies the whole answer', async () => {
  const long = 'b'.repeat(3_000)
  const cut = await answerTyped(world({ header: header('feat: x', long) }).ctx, q('aaaaaaa'))
  expect(cut.ok).toBe(true)
  expect(cut.body.includes(`${'b'.repeat(2_000)}…`)).toBe(true)
  expect(cut.body.includes('b'.repeat(2_001))).toBe(false)
  const leaky = await answerTyped(world({ header: header('feat: x', `${long}\nkey = "${AWS}"`) }).ctx, q('aaaaaaa'))
  expect(leaky).toEqual({ ok: false, body: DENIED })
  expect(await answerTyped(world({ header: header(`fix ${AWS}`, '') }).ctx, q('aaaaaaa'))).toEqual({ ok: false, body: DENIED })
})

test('at most 100 files are named, with the count of the rest', async () => {
  const numstat = Array.from({ length: 130 }, (_, i) => `1\t0\tsrc/f${i}.ts`).join('\u0000') + '\u0000'
  const body = (await answerTyped(world({ numstat }).ctx, q('aaaaaaa'))).body.split('\n')
  expect(body.includes('130 dosya · +130 -0')).toBe(true)
  expect(body.filter(l => l.startsWith('  src/')).length).toBe(100)
  expect(body[body.length - 1]).toBe('  … 30 dosya daha')
})
