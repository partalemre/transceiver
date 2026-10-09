import { FILES_MAX, GREP_MAX_HITS, HIT_FILES_CHECKED, HIT_LINE_CHARS, MAX_DIFF_BYTES, TODO_MAX_HITS } from './limits'
import { checkRelPath } from './pathguard'
import { isSearchText, type Query } from './protocol'
import { denied, git, literal, nulList, servedText, shareable, trimChars, type Out, type QueryCtx } from './queries-core'
import { hasSecret } from './scan'

export type Hit = { path: string; line: number; text: string }
type Found = { hits: Hit[]; isPartial: boolean }

const NO_MATCH = 'eşleşme yok'
const NO_FILES = 'dosya yok'
// git grep: 0 found, 1 nothing found, anything else an error.
const GREP_NONE = 1
const TAGS = ['TODO', 'FIXME', 'HACK', 'XXX'] as const
// A tag as a whole word, case as written; git reads the same pattern as an ERE.
const TODO_ERE = '(^|[^A-Za-z0-9_])(TODO|FIXME|HACK|XXX)([^A-Za-z0-9_]|$)'
const TODO_RE = /(?<![A-Za-z0-9_])(TODO|FIXME|HACK|XXX)(?![A-Za-z0-9_])/g
// Settings of the person's git that would change what grep prints or where it looks.
const GREP_CONFIG = ['-c', 'grep.fullName=false', '-c', 'grep.column=false', '-c', 'grep.fallbackToNoIndex=false']

// `git grep -z -n` prints `path NUL line NUL text LF`. A path may hold a newline, so records are walked, not split
// on lines; a record the engine's output cap cut short (no closing LF) is dropped.
export function parseHits(out: string): Hit[] {
  const hits: Hit[] = []
  let at = 0
  for (;;) {
    const pathEnd = out.indexOf('\u0000', at)
    const lineEnd = pathEnd < 0 ? -1 : out.indexOf('\u0000', pathEnd + 1)
    const end = lineEnd < 0 ? -1 : out.indexOf('\n', lineEnd + 1)
    if (end < 0) return hits
    const line = Number(out.slice(pathEnd + 1, lineEnd))
    const text = out.slice(lineEnd + 1, end).replace(/\r$/, '')
    if (Number.isInteger(line) && line > 0) hits.push({ path: out.slice(at, pathEnd), line, text })
    at = end + 1
  }
}

// The folder to look in: none is the whole root; one the path policy refuses is null.
function scopeOf(query: Query): string[] | null {
  if (query.path === undefined || query.path.trim() === '') return []
  const dir = checkRelPath(query.path)
  return dir === null ? null : [literal(dir)]
}

async function grepHits(ctx: QueryCtx, opts: { pattern: string[]; scope: string[] }): Promise<Hit[] | null> {
  const out = await git(ctx, [...GREP_CONFIG, 'grep', '-z', '-n', '-I', '--no-color', ...opts.pattern, '--', ...opts.scope])
  if (out.exitCode === GREP_NONE) return []
  return out.exitCode === 0 ? parseHits(out.stdout) : null
}

// Only hits in files `file` would serve whole: a denied, ignored, binary, oversized or secret-bearing file gives
// none, so a search can never tell whether such a file holds the text. At most HIT_FILES_CHECKED files are read.
async function servedHits(ctx: QueryCtx, opts: { hits: Hit[]; stopAfter: number }): Promise<Found> {
  const verdicts = new Map<string, boolean>()
  const kept: Hit[] = []
  for (const hit of opts.hits) {
    if (kept.length >= opts.stopAfter) return { hits: kept, isPartial: true }
    if (checkRelPath(hit.path) !== hit.path) continue
    if (!verdicts.has(hit.path)) {
      if (verdicts.size >= HIT_FILES_CHECKED) return { hits: kept, isPartial: true }
      verdicts.set(hit.path, (await servedText(ctx, hit.path)) !== null)
    }
    if (verdicts.get(hit.path) === true) kept.push(hit)
  }
  return { hits: kept, isPartial: false }
}

const hitLine = (hit: Hit, text: string) => `${hit.path}:${hit.line}: ${text}`

// The lines exactly as found are scanned together first; only then is each one cut.
function hitsBody(hits: readonly Hit[], tail: string[]): Out {
  if (hasSecret(hits.map(h => hitLine(h, h.text)).join('\n'))) return denied
  const lines = hits.map(h => hitLine(h, trimChars(h.text, HIT_LINE_CHARS)))
  return shareable([...lines, ...tail].join('\n'), MAX_DIFF_BYTES)
}

async function grep(ctx: QueryCtx, query: Query): Promise<Out> {
  const scope = scopeOf(query)
  if (!isSearchText(query.text) || scope === null) return denied
  const flags = query.isCaseInsensitive === true ? ['-F', '-i'] : ['-F']
  const hits = await grepHits(ctx, { pattern: [...flags, '-e', query.text], scope })
  if (hits === null) return denied
  const found = await servedHits(ctx, { hits, stopAfter: GREP_MAX_HITS })
  if (found.hits.length === 0) return { ok: true, body: NO_MATCH }
  return hitsBody(found.hits, found.isPartial ? [`… ilk ${found.hits.length} eşleşme; aramayı daralt`] : [])
}

// Every tag on every line counts: `HACK; XXX` is one line, two notes.
function tagCounts(hits: readonly Hit[]): string {
  const counts = new Map<string, number>(TAGS.map(t => [t, 0]))
  for (const hit of hits) {
    for (const [, tag = ''] of hit.text.matchAll(TODO_RE)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return TAGS.map(t => `${t} ${counts.get(t) ?? 0}`).join(' · ')
}

const withHead = (head: string, out: Out): Out => (out.ok ? { ok: true, body: `${head}\n${out.body}` } : out)

async function todo(ctx: QueryCtx, query: Query): Promise<Out> {
  const scope = scopeOf(query)
  if (scope === null) return denied
  const hits = await grepHits(ctx, { pattern: ['-E', '-e', TODO_ERE], scope })
  if (hits === null) return denied
  const found = await servedHits(ctx, { hits, stopAfter: Number.POSITIVE_INFINITY })
  if (found.hits.length === 0) return { ok: true, body: NO_MATCH }
  const shown = found.hits.slice(0, TODO_MAX_HITS)
  const more = found.hits.length - shown.length
  const head = `${tagCounts(found.hits)}${found.isPartial ? ` (ilk ${HIT_FILES_CHECKED} dosya)` : ''}`
  return withHead(head, hitsBody(shown, more > 0 ? [`… ${more} not daha`] : []))
}

// Names only, no content: every tracked path under the folder that the path policy would serve.
async function files(ctx: QueryCtx, query: Query): Promise<Out> {
  const scope = scopeOf(query)
  if (scope === null) return denied
  const out = await git(ctx, ['ls-files', '-z', '--', ...scope])
  if (out.exitCode !== 0) return denied
  const all = nulList(out.stdout).filter(p => checkRelPath(p) === p)
  if (all.length === 0) return { ok: true, body: NO_FILES }
  const shown = all.slice(0, FILES_MAX)
  const head = shown.length < all.length ? `${all.length} dosya · ilk ${FILES_MAX}` : `${all.length} dosya`
  return shareable([head, ...shown].join('\n'), MAX_DIFF_BYTES)
}

export const SEARCH_HANDLERS = {
  grep: (ctx: QueryCtx, q: Query) => grep(ctx, q),
  todo: (ctx: QueryCtx, q: Query) => todo(ctx, q),
  files: (ctx: QueryCtx, q: Query) => files(ctx, q),
}
