import { expect, test } from 'claude-code/testing'
import { checkRelPath, resolveInRepo } from '../hooks/pathguard'
import type { Run } from '../hooks/run'

const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' })
const fail = (exitCode = 1) => ({ exitCode, stdout: '', stderr: '' })

// realpath maps through `links`; check-ignore answers `ignoreExit`; argv is recorded.
function fakeRun(opts: { links?: Record<string, string>; ignoreExit?: number; calls?: string[][] } = {}): Run {
  return async argv => {
    opts.calls?.push([...argv])
    if (argv[0] === 'realpath') return ok(`${opts.links?.[argv[1] ?? ''] ?? argv[1]}\n`)
    if (argv.includes('check-ignore')) return fail(opts.ignoreExit ?? 1)
    return fail()
  }
}

test('relative paths inside the repo pass; escapes and secrets do not', () => {
  expect(checkRelPath('lib/auth/session_store.dart')).toBe('lib/auth/session_store.dart')
  expect(checkRelPath('./lib//a.dart')).toBe('lib/a.dart')
  for (const bad of ['', '/etc/passwd', '../x', 'lib/../../x', 'a\\b', '.env', '.env.production', 'config/prod.pem',
    'k.key', 'id_rsa', 'ssh/id_ed25519', '.git/config', 'app/.git/HEAD', 'a\u0000b', 'release.keystore', 'c.p12']) {
    expect(checkRelPath(bad)).toBe(null)
  }
})

test('case, spelling and platform tricks are refused', () => {
  for (const bad of ['.ENV', 'App/.Env.Local', '.envrc', '.env-staging', '.env/x', 'K.KEY', 'Prod.PEM', 'ID_RSA', 'id_rsa_work',
    '.GIT/config', 'a/.Git', 'x/.ssh/config', '.aws/credentials', '.npmrc', '.netrc', '.git-credentials', 'c.pfx', 'store.jks',
    'AuthKey.p8', 'putty.ppk', 'C:/x', 'a:b', '.env.', '.env ', 'dir./a', 'a\nb', 'a\rb', 'a\tb', 'a\u007fb', '.', './', '..', '...//..']) {
    expect(checkRelPath(bad)).toBe(null)
  }
  expect(checkRelPath('a/'.repeat(600) + 'b')).toBe(null)
  expect(checkRelPath('.github/workflows/ci.yml')).toBe('.github/workflows/ci.yml')
  expect(checkRelPath('lib/environment.dart')).toBe('lib/environment.dart')
  expect(checkRelPath('docs/keys.md')).toBe('docs/keys.md')
})

test('a symlink that resolves outside the root is refused', async () => {
  const run = fakeRun({ links: { '/w/lib/link': '/etc/hosts', '/w/lib/sib': '/wx/a' } })
  expect(await resolveInRepo({ run, root: '/w', rel: 'lib/a.dart' })).toBe('/w/lib/a.dart')
  expect(await resolveInRepo({ run, root: '/w', rel: 'lib/link' })).toBe(null)
  // A sibling folder that only shares the root's prefix is outside too.
  expect(await resolveInRepo({ run, root: '/w', rel: 'lib/sib' })).toBe(null)
})

test('a symlink to a denied file inside the repo is refused', async () => {
  const run = fakeRun({ links: { '/w/notes.txt': '/w/.env', '/w/cfg': '/w/.git/config' } })
  expect(await resolveInRepo({ run, root: '/w', rel: 'notes.txt' })).toBe(null)
  expect(await resolveInRepo({ run, root: '/w', rel: 'cfg' })).toBe(null)
})

test('the root is resolved the same way as the file', async () => {
  const run = fakeRun({ links: { '/tmp/w': '/private/tmp/w', '/private/tmp/w/a.txt': '/private/tmp/w/a.txt' } })
  expect(await resolveInRepo({ run, root: '/tmp/w', rel: 'a.txt' })).toBe('/private/tmp/w/a.txt')
})

test('a git-ignored file is refused, and so is the target of a link', async () => {
  const calls: string[][] = []
  expect(await resolveInRepo({ run: fakeRun({ ignoreExit: 0 }), root: '/w', rel: 'build/out.txt' })).toBe(null)
  const run = fakeRun({ links: { '/w/pub.txt': '/w/secret/x.txt' }, calls })
  await resolveInRepo({ run, root: '/w', rel: 'pub.txt' })
  const ignore = calls.find(c => c.includes('check-ignore')) ?? []
  expect(ignore.slice(-3)).toEqual(['--', 'pub.txt', 'secret/x.txt'])
})

test('anything but a clean answer from git or realpath is a no', async () => {
  expect(await resolveInRepo({ run: fakeRun({ ignoreExit: 128 }), root: '/w', rel: 'a.txt' })).toBe(null)
  const noRealpath: Run = async argv => (argv[0] === 'realpath' ? fail() : fail())
  expect(await resolveInRepo({ run: noRealpath, root: '/w', rel: 'a.txt' })).toBe(null)
  const throws: Run = async () => { throw new Error('spawn failed') }
  expect(await resolveInRepo({ run: throws, root: '/w', rel: 'a.txt' })).toBe(null)
  const multi: Run = async argv => (argv[0] === 'realpath' ? ok('/w/a\n/w/b\n') : fail())
  expect(await resolveInRepo({ run: multi, root: '/w', rel: 'a' })).toBe(null)
  expect(await resolveInRepo({ run: fakeRun(), root: 'w', rel: 'a.txt' })).toBe(null)
})

test('an engine resolver can stand in for the realpath binary', async () => {
  const realPath = async (p: string) => (p.endsWith('link') ? '/etc/hosts' : p)
  const run = fakeRun()
  expect(await resolveInRepo({ run, root: '/w', rel: 'a.txt', realPath })).toBe('/w/a.txt')
  expect(await resolveInRepo({ run, root: '/w', rel: 'link', realPath })).toBe(null)
  expect(await resolveInRepo({ run, root: '/w', rel: 'a.txt', realPath: async () => null })).toBe(null)
})
