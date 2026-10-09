import { LOG_COUNT, MAX_DIFF_BYTES, MAX_FILE_BYTES, MAX_TEXT_BYTES } from './limits'
import { checkRelPath } from './pathguard'
import { QUERY_TYPES, type Query, type QueryType } from './protocol'
import { COMMIT_HANDLERS } from './queries-commit'
import { denied, git, NONE, servedText, shareable, type Handler, type Out, type QueryCtx } from './queries-core'
import { DEPS_HANDLERS } from './queries-deps'
import { SEARCH_HANDLERS } from './queries-search'
import { hasSecret } from './scan'

export { trimBytes, type QueryCtx } from './queries-core'

const NO_CHANGES = 'değişiklik yok'

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

// Sent whole up to 256 KB: the responder splits a long body into numbered parts.
async function file(ctx: QueryCtx, query: Query): Promise<Out> {
  const text = await servedText(ctx, query.path ?? '')
  return text === null ? denied : shareable(text, MAX_FILE_BYTES)
}

async function stateOf(ctx: QueryCtx, plugin: string, key: string): Promise<Out> {
  const value = await ctx.readState(plugin, key)
  if (value === undefined || value === null) return { ok: true, body: NONE }
  return shareable(JSON.stringify(value), MAX_TEXT_BYTES)
}

type ModellessType = { [T in QueryType]: (typeof QUERY_TYPES)[T]['isModelless'] extends true ? T : never }[QueryType]

// One handler per modelless type in QUERY_TYPES; the compiler holds the two lists together.
const HANDLERS: Record<ModellessType, Handler> = {
  status: ctx => status(ctx),
  log: ctx => plain(ctx, ['log', `-n${LOG_COUNT}`, '--no-color', '--pretty=format:%h %s (%an, %ar)']),
  branch: ctx => plain(ctx, ['branch', '--format=%(refname:short)']),
  diff: ctx => diff(ctx),
  file: (ctx, q) => file(ctx, q),
  tests: ctx => stateOf(ctx, 'test-badge', 'badge'),
  plan: ctx => stateOf(ctx, 'plan-steps', 'tasks'),
  ...SEARCH_HANDLERS,
  ...DEPS_HANDLERS,
  ...COMMIT_HANDLERS,
}

export async function answerTyped(ctx: QueryCtx, query: Query): Promise<Out> {
  const handler = Object.hasOwn(HANDLERS, query.type) ? HANDLERS[query.type as ModellessType] : undefined
  if (handler === undefined) return denied
  const out = await handler(ctx, query).catch(() => denied)
  // The last line of defence: nothing a scan flags leaves, whatever produced it.
  return out.ok && hasSecret(out.body) ? denied : out
}
