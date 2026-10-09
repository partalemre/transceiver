import { MAX_PATH_BYTES } from './limits'
import { utf8Bytes } from './protocol'
import type { RealPath, Run } from './run'

// Matched against the lower-cased path: a case-insensitive disk opens `.ENV` as `.env`.
const DENY = [
  /(^|\/)\.env[^/]*(\/|$)/, /\.(pem|key|p12|pfx|keystore|jks|p8|ppk)$/, /(^|\/)id_[^/]*$/,
  /(^|\/)\.(git|ssh|aws|gnupg)(\/|$)/, /(^|\/)\.(npmrc|netrc|pgpass|pypirc|git-credentials)$/,
]
// Control characters, a backslash or a colon (drive letters, NTFS streams, git pathspec magic).
const BAD_CHARS = /[\u0000-\u001f\u007f\\:]/
// Windows drops a trailing dot or space, so `.env.` would open `.env`.
const BAD_SEGMENT_END = /[. ]$/
// git check-ignore: 0 means ignored, 1 means not; anything else is an error.
const GIT_NOT_IGNORED = 1

export function checkRelPath(rel: string): string | null {
  if (rel === '' || rel.startsWith('/') || BAD_CHARS.test(rel) || utf8Bytes(rel) > MAX_PATH_BYTES) return null
  const parts = rel.split('/').filter(p => p !== '' && p !== '.')
  if (parts.length === 0 || parts.some(p => p === '..' || BAD_SEGMENT_END.test(p))) return null
  const clean = parts.join('/')
  const lower = clean.toLowerCase()
  return DENY.some(re => re.test(lower)) ? null : clean
}

const isCleanAbs = (path: string): boolean => path.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(path)

function realPathVia(run: Run): RealPath {
  return async abs => {
    const out = await run(['realpath', abs])
    const path = out.stdout.endsWith('\n') ? out.stdout.slice(0, -1) : out.stdout
    return out.exitCode === 0 && isCleanAbs(path) ? path : null
  }
}

type ResolveOpts = { run: Run; root: string; rel: string; realPath?: RealPath }

async function resolve(opts: ResolveOpts, rel: string): Promise<string | null> {
  const realPath = opts.realPath ?? realPathVia(opts.run)
  const root = await realPath(opts.root)
  if (root === null || !isCleanAbs(root)) return null
  const abs = await realPath(`${root}/${rel}`)
  if (abs === null || !isCleanAbs(abs) || !abs.startsWith(`${root}/`)) return null
  // Where a link lands is held to the same policy as how it was spelled.
  const landed = abs.slice(root.length + 1)
  if (checkRelPath(landed) !== landed) return null
  const names = [...new Set([rel, landed])]
  const ignored = await opts.run(['git', '-C', root, 'check-ignore', '-q', '--', ...names])
  // Only a clean "not ignored" passes: no repo, a path beyond a link, any error is a no.
  return ignored.exitCode === GIT_NOT_IGNORED ? abs : null
}

export async function resolveInRepo(opts: ResolveOpts): Promise<string | null> {
  const rel = checkRelPath(opts.rel)
  if (rel === null || !opts.root.startsWith('/')) return null
  // A resolver or git that cannot run is a refusal, never an error that escapes.
  return resolve(opts, rel).catch(() => null)
}
