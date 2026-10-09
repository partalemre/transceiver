import { expect, test } from 'claude-code/testing'
import { DENIED } from '../hooks/protocol'
import { answerTyped, type QueryCtx } from '../hooks/queries'
import { parseHits } from '../hooks/queries-search'

type Reply = { exitCode?: number; stdout?: string }
type World = { git?: (sub: string, argv: string[]) => Reply; files?: Record<string, string>; links?: Record<string, string>; ignored?: string[] }

// The git subcommand: past `-C <root>` and any `-c key=value` pairs.
function subOf(argv: string[]): string {
  let at = argv.indexOf('-C') + 2
  while (argv[at] === '-c') at += 2
  return argv[at] ?? ''
}

function world(w: World = {}): { ctx: QueryCtx; calls: string[][]; reads: string[] } {
  const calls: string[][] = []
  const reads: string[] = []
  const run: QueryCtx['run'] = async argv => {
    calls.push([...argv])
    const sub = subOf(argv)
    if (sub === 'check-ignore') {
      const isIgnored = argv.slice(argv.indexOf('--') + 1).some(p => (w.ignored ?? []).includes(p))
      return { exitCode: isIgnored ? 0 : 1, stdout: '', stderr: '' }
    }
    const reply = w.git?.(sub, argv) ?? {}
    return { exitCode: reply.exitCode ?? 0, stdout: reply.stdout ?? '', stderr: '' }
  }
  const readFile = async (abs: string) => {
    reads.push(abs)
    const text = w.files?.[abs]
    if (text === undefined) throw new Error('ENOENT')
    return text
  }
  const realPath = async (abs: string) => w.links?.[abs] ?? abs
  return { ctx: { run, root: '/w', readFile, readState: async () => undefined, realPath }, calls, reads }
}

const q = (type: string, extra = {}) => ({ type, repo: 'partalemre/eliti', ...extra }) as never
const grepOut = (hits: [string, number, string][]) => hits.map(([p, n, t]) => `${p}\u0000${n}\u0000${t}\n`).join('')
const AWS = 'AKIAIOSFODNN7EXAMPLE'
const greps = (calls: string[][]) => calls.filter(c => subOf(c) === 'grep')

test('grep runs a literal search with the text after -e and nothing after --, and prints path:line: text', async () => {
  const { ctx, calls } = world({
    git: () => ({ stdout: grepOut([['lib/a.ts', 3, 'const needle = 1'], ['lib/b.ts', 9, 'needle()']]) }),
    files: { '/w/lib/a.ts': 'const needle = 1', '/w/lib/b.ts': 'needle()' },
  })
  expect(await answerTyped(ctx, q('grep', { text: 'needle' }))).toEqual({ ok: true, body: 'lib/a.ts:3: const needle = 1\nlib/b.ts:9: needle()' })
  const argv = greps(calls)[0] ?? []
  expect(argv.slice(0, 4)).toEqual(['git', '--no-pager', '-c', 'core.quotepath=off'])
  for (const flag of ['-F', '-I', '-z', '-n', '--no-color', 'grep.fallbackToNoIndex=false', 'grep.fullName=false']) expect(argv).toContain(flag)
  expect(argv.includes('-i')).toBe(false)
  expect(argv.slice(argv.indexOf('-e'))).toEqual(['-e', 'needle', '--'])
})

test('a text that looks like an option stays the pattern, and the case switch adds -i', async () => {
  for (const text of ['--output=/tmp/x', '-i', '--open-files-in-pager=sh']) {
    const { ctx, calls } = world()
    expect(await answerTyped(ctx, q('grep', { text }))).toEqual({ ok: true, body: 'eşleşme yok' })
    const argv = greps(calls)[0] ?? []
    expect(argv.slice(argv.indexOf('-e'))).toEqual(['-e', text, '--'])
  }
  const { ctx, calls } = world()
  await answerTyped(ctx, q('grep', { text: 'Needle', isCaseInsensitive: true }))
  expect(greps(calls)[0]?.includes('-i')).toBe(true)
})

test('a folder is read literally; pathspec magic, .., .git and absolute folders are denied before git runs', async () => {
  const { ctx, calls } = world()
  await answerTyped(ctx, q('grep', { text: 'needle', path: 'lib/sub' }))
  expect(greps(calls)[0]?.slice(-2)).toEqual(['--', ':(literal)lib/sub'])
  for (const path of [':(top)', ':!lib', ':(glob)**', '../other', 'lib/../../x', '.git', '/etc', '.ssh/', 'a\\b']) {
    const w = world()
    expect(await answerTyped(w.ctx, q('grep', { text: 'needle', path }))).toEqual({ ok: false, body: DENIED })
    expect(await answerTyped(w.ctx, q('todo', { path }))).toEqual({ ok: false, body: DENIED })
    expect(await answerTyped(w.ctx, q('files', { path }))).toEqual({ ok: false, body: DENIED })
    expect(w.calls).toEqual([])
  }
})

test('a text outside 2–200 characters, on two lines, with a NUL or only spaces is denied without git', async () => {
  for (const text of [undefined, 'a', 'ş'.repeat(201), 'a\nb', 'a\u0000b', 'ab\r', '   ']) {
    const { ctx, calls } = world()
    expect(await answerTyped(ctx, q('grep', { text }))).toEqual({ ok: false, body: DENIED })
    expect(calls).toEqual([])
  }
  const { ctx } = world()
  expect((await answerTyped(ctx, q('grep', { text: 'ş'.repeat(200) }))).ok).toBe(true)
})

test('hits in files the file query would refuse never appear: denied, ignored, linked away, binary, huge, secret', async () => {
  const hits: [string, number, string][] = [
    ['.env', 1, 'NEEDLE=1'], ['keys/prod.pem', 1, 'needle'], ['.git/config', 1, 'needle'], ['docs/link.md', 1, 'needle'],
    ['out.md', 1, 'needle'], ['gen/ignored.ts', 1, 'needle'], ['lib/bin.dat', 1, 'needle'], ['big.txt', 1, 'needle'],
    ['lib/leak.ts', 1, 'needle'], ['lib/ok.ts', 2, 'the needle'],
  ]
  const { ctx } = world({
    git: () => ({ stdout: grepOut(hits) }),
    links: { '/w/docs/link.md': '/w/.env', '/w/out.md': '/home/me/.ssh/id_rsa' },
    ignored: ['gen/ignored.ts'],
    files: {
      '/w/.env': 'NEEDLE=1', '/w/gen/ignored.ts': 'needle', '/w/lib/bin.dat': 'needle\u0000', '/w/big.txt': `needle${'a'.repeat(262_144)}`,
      '/w/lib/leak.ts': `needle\nconst k = "${AWS}"`, '/w/lib/ok.ts': 'x\nthe needle',
    },
  })
  expect(await answerTyped(ctx, q('grep', { text: 'needle' }))).toEqual({ ok: true, body: 'lib/ok.ts:2: the needle' })
})

test('searching for a secret in a file that holds it reads exactly like searching for something absent', async () => {
  const leaky = world({ git: () => ({ stdout: grepOut([['lib/k.ts', 1, `k = "${AWS}"`]]) }), files: { '/w/lib/k.ts': `k = "${AWS}"` } })
  const absent = world({ git: () => ({ exitCode: 1 }) })
  const asked = q('grep', { text: AWS.slice(0, 15) })
  expect(await answerTyped(leaky.ctx, asked)).toEqual(await answerTyped(absent.ctx, asked))
  expect(await answerTyped(absent.ctx, asked)).toEqual({ ok: true, body: 'eşleşme yok' })
})

test('the matched lines are scanned whole before each is cut to 200 characters', async () => {
  const long = `needle ${'x'.repeat(300)}`
  const clean = world({ git: () => ({ stdout: grepOut([['a.ts', 1, long]]) }), files: { '/w/a.ts': long } })
  const out = await answerTyped(clean.ctx, q('grep', { text: 'needle' }))
  expect(out).toEqual({ ok: true, body: `a.ts:1: ${long.slice(0, 200)}…` })
  // The file changed between git's read and ours: the secret sits past the cut, and still denies.
  const late = `needle ${'x'.repeat(250)} "${AWS}"`
  const raced = world({ git: () => ({ stdout: grepOut([['a.ts', 1, late]]) }), files: { '/w/a.ts': 'needle' } })
  expect(await answerTyped(raced.ctx, q('grep', { text: 'needle' }))).toEqual({ ok: false, body: DENIED })
})

test('grep shows at most 50 hits and says there are more', async () => {
  const lines = Array.from({ length: 80 }, (_, i) => `needle ${i}`)
  const { ctx } = world({
    git: () => ({ stdout: grepOut(lines.map((t, i) => ['a.ts', i + 1, t])) }), files: { '/w/a.ts': lines.join('\n') },
  })
  const out = await answerTyped(ctx, q('grep', { text: 'needle' }))
  const body = out.body.split('\n')
  expect(body.length).toBe(51)
  expect(body[49]).toBe('a.ts:50: needle 49')
  expect(body[50]).toBe('… ilk 50 eşleşme; aramayı daralt')
})

test('a failing git is a denial; no match says so', async () => {
  expect(await answerTyped(world({ git: () => ({ exitCode: 128 }) }).ctx, q('grep', { text: 'ab' }))).toEqual({ ok: false, body: DENIED })
  expect(await answerTyped(world({ git: () => ({ exitCode: 2 }) }).ctx, q('todo'))).toEqual({ ok: false, body: DENIED })
  expect(await answerTyped(world({ git: () => ({ exitCode: 1 }) }).ctx, q('todo'))).toEqual({ ok: true, body: 'eşleşme yok' })
})

test('grep output is walked by record: a newline in a path is kept, a record cut short is dropped', () => {
  const out = `a\nb.ts\u00002\u0000x needle\r\nc.ts\u00001\u0000needle\nd.ts\u00003\u0000need`
  expect(parseHits(out)).toEqual([{ path: 'a\nb.ts', line: 2, text: 'x needle' }, { path: 'c.ts', line: 1, text: 'needle' }])
  expect(parseHits(`.env.prod\u00001`)).toEqual([])
  expect(parseHits('x\u0000zz\u0000t\n')).toEqual([])
})

test('todo counts every tag, lists at most 100 notes and reads only servable files', async () => {
  const notes = Array.from({ length: 120 }, (_, i) => `// TODO ${i}`)
  const hits: [string, number, string][] = [
    ['.env', 1, '# TODO rotate'], ['a.ts', 1, '// FIXME: HACK; XXX'], ['a.ts', 2, 'TODOS and XXXL are words'],
    ...notes.map((t, i): [string, number, string] => ['b.ts', i + 1, t]),
  ]
  const { ctx, calls, reads } = world({ git: () => ({ stdout: grepOut(hits) }), files: { '/w/a.ts': 'x', '/w/b.ts': 'y' } })
  const out = await answerTyped(ctx, q('todo'))
  const body = out.body.split('\n')
  expect(body[0]).toBe('TODO 120 · FIXME 1 · HACK 1 · XXX 1')
  expect(body[1]).toBe('a.ts:1: // FIXME: HACK; XXX')
  expect(body.length).toBe(1 + 100 + 1)
  expect(body[101]).toBe('… 22 not daha')
  expect(reads).toEqual(['/w/a.ts', '/w/b.ts'])
  const argv = greps(calls)[0] ?? []
  expect(argv.slice(argv.indexOf('-E'))).toEqual(['-E', '-e', '(^|[^A-Za-z0-9_])(TODO|FIXME|HACK|XXX)([^A-Za-z0-9_]|$)', '--'])
})

test('todo reads at most 100 files and says so', async () => {
  const hits = Array.from({ length: 150 }, (_, i): [string, number, string] => [`f${i}.ts`, 1, 'TODO'])
  const files = Object.fromEntries(hits.map(([p]) => [`/w/${p}`, 'TODO']))
  const { ctx, reads } = world({ git: () => ({ stdout: grepOut(hits) }), files })
  const out = await answerTyped(ctx, q('todo'))
  expect(out.body.split('\n')[0]).toBe('TODO 100 · FIXME 0 · HACK 0 · XXX 0 (ilk 100 dosya)')
  expect(reads.length).toBe(100)
})

test('files lists tracked names under a folder, leaves out denied ones and counts only what it may show', async () => {
  const listed = ['lib/a.ts', 'lib/.env.local', 'lib/keys/x.pem', 'lib/id_rsa', 'lib/:(top)x', 'lib/b.ts', 'lib/.ENV']
  const { ctx, calls } = world({ git: () => ({ stdout: `${listed.join('\u0000')}\u0000` }) })
  expect(await answerTyped(ctx, q('files', { path: 'lib' }))).toEqual({ ok: true, body: '2 dosya\nlib/a.ts\nlib/b.ts' })
  expect(calls[0]?.slice(-4)).toEqual(['ls-files', '-z', '--', ':(literal)lib'])
})

test('files shows at most 500 names with the total, and drops a name the output cap cut short', async () => {
  const names = Array.from({ length: 600 }, (_, i) => `src/f${i}.ts`)
  const { ctx } = world({ git: () => ({ stdout: `${names.join('\u0000')}\u0000.env` }) })
  const body = (await answerTyped(ctx, q('files'))).body.split('\n')
  expect(body[0]).toBe('600 dosya · ilk 500')
  expect(body.length).toBe(501)
  const cut = world({ git: () => ({ stdout: 'a.ts\u0000secrets/.en' }) })
  expect(await answerTyped(cut.ctx, q('files'))).toEqual({ ok: true, body: '1 dosya\na.ts' })
  expect(await answerTyped(world({ git: () => ({ stdout: '' }) }).ctx, q('files'))).toEqual({ ok: true, body: 'dosya yok' })
  expect(await answerTyped(world({ git: () => ({ exitCode: 128 }) }).ctx, q('files'))).toEqual({ ok: false, body: DENIED })
})
