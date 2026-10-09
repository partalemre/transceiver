import { LOG_COUNT, MAX_DIFF_BYTES, MAX_FILE_BYTES, MAX_TEXT_BYTES } from './limits'
import { checkRelPath, resolveInRepo } from './pathguard'
import { DENIED, utf8Bytes, type Query } from './protocol'
import type { RealPath, Run } from './run'
import { hasSecret } from './scan'

export type QueryCtx = {
  run: Run
  root: string
  readFile: (abs: string) => Promise<string>
  readState: (plugin: string, key: string) => Promise<unknown>
  // The engine's resolver (`realPathOf($)`); absent, realpath(1) through `run`.
  realPath?: RealPath
}
type Out = { ok: boolean; body: string }
type Handler = (ctx: QueryCtx, query: Query) => Promise<Out>

const CUT = '…[kırpıldı]'
const NONE = 'kayıt yok'
const NO_CHANGES = 'değişiklik yok'
const denied: Out = { ok: false, body: DENIED }

// Linear: counts bytes as it goes, never cuts inside a character.
export function trimBytes(text: string, max: number): string {
  if (utf8Bytes(text) <= max) return text
  const room = max - utf8Bytes(CUT)
  let used = 0
  let end = 0
  for (const ch of text) {
    const size = utf8Bytes(ch)
    if (used + size > room) break
    used += size
    end += ch.length
  }
  return text.slice(0, end) + CUT
}

const git = (ctx: QueryCtx, args: string[]) => ctx.run(['git', '-C', ctx.root, ...args])

// The whole text is scanned before any cut: a cut could leave half a key that no longer matches.
const shareable = (text: string, max: number): Out => (hasSecret(text) ? denied : { ok: true, body: trimBytes(text, max) })

async function status(ctx: QueryCtx): Promise<Out> {
  const out = await git(ctx, ['status', '--porcelain=v1', '-b'])
  if (out.exitCode !== 0) return denied
  const lines = out.stdout.split('\n').filter(Boolean)
  const branch = (lines.find(l => l.startsWith('## ')) ?? '').slice('## '.length)
  const changed = lines.filter(l => !l.startsWith('## ')).length
  return { ok: true, body: `${branch} · ${changed} değişen dosya` }
}

async function plain(ctx: QueryCtx, args: string[]): Promise<Out> {
  const out = await git(ctx, args)
  return out.exitCode === 0 ? shareable(out.stdout, MAX_TEXT_BYTES) : denied
}

// Only paths the file policy would serve are diffed: a tracked `.env` change never leaves.
async function diff(ctx: QueryCtx): Promise<Out> {
  const names = await git(ctx, ['diff', '--name-only', '-z', '--no-renames'])
  if (names.exitCode !== 0) return denied
  const paths = names.stdout.split('\u0000').filter(p => p !== '' && checkRelPath(p) === p)
  if (paths.length === 0) return { ok: true, body: NO_CHANGES }
  const out = await git(ctx, [
    'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--', ...paths.map(p => `:(literal)${p}`),
  ])
  return out.exitCode === 0 ? shareable(out.stdout, MAX_DIFF_BYTES) : denied
}

async function file(ctx: QueryCtx, query: Query): Promise<Out> {
  const abs = await resolveInRepo({ run: ctx.run, root: ctx.root, rel: query.path ?? '', realPath: ctx.realPath })
  if (abs === null) return denied
  const text = await ctx.readFile(abs)
  if (text.includes('\u0000') || utf8Bytes(text) > MAX_FILE_BYTES) return denied
  // Sent whole: the responder splits a long body into numbered parts.
  return shareable(text, MAX_FILE_BYTES)
}

async function stateOf(ctx: QueryCtx, plugin: string, key: string): Promise<Out> {
  const value = await ctx.readState(plugin, key)
  if (value === undefined || value === null) return { ok: true, body: NONE }
  return shareable(JSON.stringify(value), MAX_TEXT_BYTES)
}

const HANDLERS: Record<Exclude<Query['type'], 'ask'>, Handler> = {
  status: ctx => status(ctx),
  log: ctx => plain(ctx, ['log', `-n${LOG_COUNT}`, '--no-color', '--pretty=format:%h %s (%an, %ar)']),
  branch: ctx => plain(ctx, ['branch', '--format=%(refname:short)']),
  diff: ctx => diff(ctx),
  file: (ctx, q) => file(ctx, q),
  tests: ctx => stateOf(ctx, 'test-badge', 'badge'),
  plan: ctx => stateOf(ctx, 'plan-steps', 'tasks'),
}

export async function answerTyped(ctx: QueryCtx, query: Query): Promise<Out> {
  const handler = Object.hasOwn(HANDLERS, query.type) ? HANDLERS[query.type as keyof typeof HANDLERS] : undefined
  if (handler === undefined) return denied
  const out = await handler(ctx, query).catch(() => denied)
  // The last line of defence: nothing a scan flags leaves, whatever produced it.
  return out.ok && hasSecret(out.body) ? denied : out
}
