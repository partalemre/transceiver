// A typed answer's compact form for its card: a diff's stat, a test run's counts, a search's first hits, a list's
// first items, TODO tags by count, a commit's subject and stat. Anything else is its text. Pure; an answer that
// does not read as its type falls back to text, never to a guess.
import { pick } from './kit/lang'

export type DiffStat = { files: number; added: number; removed: number }
export type Hit = { loc: string; text: string }
export type Compact =
  | { kind: 'diff'; stat: DiffStat }
  | { kind: 'tests'; passed: number; failed: number }
  | { kind: 'hits'; count: number; rows: Hit[] }
  | { kind: 'list'; count: number; noun: string; items: string[] }
  | { kind: 'tags'; tags: Array<{ tag: string; count: number }> }
  | { kind: 'commit'; subject: string; stat: DiffStat | null }
  | { kind: 'text'; text: string }

// The first rows a card shows of a search or a list; "Göster" opens the rest.
export const FIRST_ROWS = 2
// A list's noun in the reader's language; the bodies themselves keep the wire's words (words-wire.ts).
const NOUNS = {
  en: { files: { one: 'file', many: 'files' }, deps: { one: 'dependency', many: 'dependencies' } },
  tr: { files: { one: 'dosya', many: 'dosya' }, deps: { one: 'bağımlılık', many: 'bağımlılık' } },
}
const nounOf = (kind: 'files' | 'deps', n: number): string => (n === 1 ? pick(NOUNS)[kind].one : pick(NOUNS)[kind].many)
const NONE = new Set(['kayıt yok', 'değişiklik yok', 'eşleşme yok', 'dosya yok', 'bağımlılık dosyası yok', ''])
const rowsOf = (body: string) => body.split('\n').map(r => r.trimEnd()).filter(r => r.trim() !== '')

// A unified diff's stat: files, added and removed lines (the +++ and --- headers are not lines).
export function diffStat(body: string): DiffStat | null {
  let stat: DiffStat = { files: 0, added: 0, removed: 0 }
  for (const row of body.split('\n')) {
    if (row.startsWith('diff --git ')) stat = { ...stat, files: stat.files + 1 }
    else if (row.startsWith('+') && !row.startsWith('+++')) stat = { ...stat, added: stat.added + 1 }
    else if (row.startsWith('-') && !row.startsWith('---')) stat = { ...stat, removed: stat.removed + 1 }
  }
  return stat.files === 0 ? null : stat
}

const count = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null)

// The test-badge state a `tests` answer carries: `{ tests: { passed, total } }`; anything else is not counted.
export function testCounts(body: string): { passed: number; failed: number } | null {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return null
  }
  const tests = typeof raw === 'object' && raw !== null ? (raw as { tests?: { passed?: unknown; total?: unknown } }).tests : undefined
  const passed = count(tests?.passed)
  const total = count(tests?.total)
  return passed === null || total === null || total < passed ? null : { passed, failed: total - passed }
}

const HIT = /^(.+?):(\d+)(?::\d+)?[:\s]\s*(.*)$/

// `path:line:text` rows (git grep -n); a row that is not one is left out of the count.
export function hitsOf(body: string): Hit[] {
  return rowsOf(body).flatMap(row => {
    const m = HIT.exec(row)
    return m === null ? [] : [{ loc: `${m[1]}:${m[2]}`, text: (m[3] ?? '').trim() }]
  })
}

const TAG_COUNT = /\b(TODO|FIXME|HACK|XXX) (\d+)/g

// todo's head line: "TODO 3 · FIXME 1 · HACK 0 · XXX 0"; the tags with none are left out.
export function tagsOf(body: string): Array<{ tag: string; count: number }> {
  const head = rowsOf(body)[0] ?? ''
  return [...head.matchAll(TAG_COUNT)].map(m => ({ tag: m[1] ?? '', count: Number(m[2]) })).filter(t => t.count > 0)
}

const STAT = /^(\d+) dosya · \+(\d+) -(\d+)$/

// "a1b2c3d subject" first, the stat line ("3 dosya · +41 -12") further down.
export function commitOf(body: string): { subject: string; stat: DiffStat | null } | null {
  const rows = rowsOf(body)
  const subject = rows[0]?.trim()
  if (subject === undefined) return null
  const m = rows.map(r => STAT.exec(r.trim())).find(x => x !== null)
  return { subject, stat: m == null ? null : { files: Number(m[1]), added: Number(m[2]), removed: Number(m[3]) } }
}

const FILES_HEAD = /^(\d+) dosya\b/
const DEPS_HEAD = /^\S.* \((\d+)\)$/

// files: "12 dosya" then the paths; deps: "package.json · dependencies (8)" then "  name version" rows.
function listOf(type: string, body: string): Compact | null {
  const rows = rowsOf(body)
  if (type === 'files') {
    const head = FILES_HEAD.exec(rows[0] ?? '')
    return head === null ? null : { kind: 'list', count: Number(head[1]), noun: nounOf('files', Number(head[1])), items: rows.slice(1).map(r => r.trim()) }
  }
  const heads = rows.map(r => DEPS_HEAD.exec(r)).filter((m): m is RegExpExecArray => m !== null)
  const items = rows.filter(r => r.startsWith('  ') && !r.trim().startsWith('…')).map(r => r.trim())
  const total = heads.reduce((n, m) => n + Number(m[1]), 0)
  return heads.length === 0 ? null : { kind: 'list', count: total, noun: nounOf('deps', total), items }
}

function compactTyped(type: string, body: string): Compact | null {
  if (type === 'diff') { const stat = diffStat(body); return stat === null ? null : { kind: 'diff', stat } }
  if (type === 'tests') { const c = testCounts(body); return c === null ? null : { kind: 'tests', ...c } }
  if (type === 'grep') { const rows = hitsOf(body); return rows.length === 0 ? null : { kind: 'hits', count: rows.length, rows } }
  if (type === 'todo') { const tags = tagsOf(body); return tags.length === 0 ? null : { kind: 'tags', tags } }
  if (type === 'commit') { const c = commitOf(body); return c === null ? null : { kind: 'commit', ...c } }
  return type === 'files' || type === 'deps' ? listOf(type, body) : null
}

export function compactOf(type: string, body: string): Compact {
  if (NONE.has(body.trim())) return { kind: 'text', text: body.trim() || 'boş' }
  return compactTyped(type, body) ?? { kind: 'text', text: body }
}
