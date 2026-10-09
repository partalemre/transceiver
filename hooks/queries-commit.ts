import { COMMIT_BODY_CHARS, COMMIT_MAX_FILES, COMMIT_SUBJECT_CHARS, MAX_DIFF_BYTES } from './limits'
import { checkRelPath } from './pathguard'
import { isSha, type Query } from './protocol'
import { denied, git, nulList, shareable, trimChars, type Out, type QueryCtx } from './queries-core'
import { hasSecret } from './scan'

type Change = { path: string; added: number | null; deleted: number | null }
type Header = { short: string; author: string; date: string; subject: string; body: string }

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const NUMSTAT = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/
const FIELD = '%x00'
// A setting of the person's git that would run gpg on every shown commit.
const SHOW_CONFIG = ['-c', 'log.showSignature=false']

// The asked name, held to a commit: a tag that points at a blob or a tree (which `show` would print) is refused,
// as is an unknown or ambiguous name. The sha cannot read as an option: it is hex only, and options end first.
async function commitOf(ctx: QueryCtx, sha: string): Promise<string | null> {
  const out = await git(ctx, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${sha}^{commit}`])
  const full = out.stdout.trim()
  return out.exitCode === 0 && FULL_SHA.test(full) ? full : null
}

async function headerOf(ctx: QueryCtx, full: string): Promise<Header | null> {
  const format = ['%h', '%an', '%ad', '%s', '%b'].join(FIELD)
  const out = await git(ctx, [...SHOW_CONFIG, 'show', '-s', '--no-color', '--no-notes', '--date=short', `--format=${format}`, full, '--'])
  if (out.exitCode !== 0) return null
  const [short = '', author = '', date = '', subject = '', ...rest] = out.stdout.split('\u0000')
  return { short, author, date, subject, body: rest.join('').trim() }
}

const countOf = (x: string | undefined): number | null => (x === undefined || x === '-' ? null : Number(x))

// Only files the path policy would serve are named; the rest are not even counted. Paths are the root's own.
async function changesOf(ctx: QueryCtx, full: string): Promise<Change[] | null> {
  const out = await git(ctx, [
    ...SHOW_CONFIG, 'show', '--no-color', '--no-notes', '--no-ext-diff', '--no-textconv', '--no-renames', '--relative',
    '--diff-merges=first-parent', '--format=', '--numstat', '-z', full, '--',
  ])
  if (out.exitCode !== 0) return null
  return nulList(out.stdout).flatMap(entry => {
    const m = NUMSTAT.exec(entry.replace(/^\n+/, ''))
    const path = m?.[3]
    if (m === null || path === undefined || checkRelPath(path) !== path) return []
    return [{ path, added: countOf(m[1]), deleted: countOf(m[2]) }]
  })
}

const changeLine = (c: Change) => (c.added === null || c.deleted === null ? `  ${c.path} (ikili)` : `  ${c.path} +${c.added} -${c.deleted}`)

function statLines(changes: readonly Change[]): string[] {
  const sum = (pick: (c: Change) => number | null) => changes.reduce((n, c) => n + (pick(c) ?? 0), 0)
  const shown = changes.slice(0, COMMIT_MAX_FILES).map(changeLine)
  const more = changes.length - shown.length
  const head = `${changes.length} dosya · +${sum(c => c.added)} -${sum(c => c.deleted)}`
  return [head, ...shown, ...(more > 0 ? [`  … ${more} dosya daha`] : [])]
}

function commitBody(h: Header, changes: readonly Change[], cut: boolean): string {
  const subject = cut ? trimChars(h.subject, COMMIT_SUBJECT_CHARS) : h.subject
  const body = cut ? trimChars(h.body, COMMIT_BODY_CHARS) : h.body
  return [`${h.short} ${subject}`, `${h.author} · ${h.date}`, ...(body === '' ? [] : ['', body]), '', ...statLines(changes)].join('\n')
}

async function commit(ctx: QueryCtx, query: Query): Promise<Out> {
  if (!isSha(query.sha)) return denied
  const full = await commitOf(ctx, query.sha)
  if (full === null) return denied
  const [header, changes] = await Promise.all([headerOf(ctx, full), changesOf(ctx, full)])
  if (header === null || changes === null) return denied
  // The whole message is scanned before it is cut.
  if (hasSecret(commitBody(header, changes, false))) return denied
  return shareable(commitBody(header, changes, true), MAX_DIFF_BYTES)
}

export const COMMIT_HANDLERS = { commit: (ctx: QueryCtx, q: Query) => commit(ctx, q) }
