import { MAX_FILE_BYTES, QUERY_RUN_TIMEOUT_MS } from './limits'
import { resolveInRepo } from './pathguard'
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
export type Out = { ok: boolean; body: string }
export type Handler = (ctx: QueryCtx, query: Query) => Promise<Out>

export const CUT = '…[kırpıldı]'
export const NONE = 'kayıt yok'
export const denied: Out = { ok: false, body: DENIED }
const ELLIPSIS = '…'

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

// At most `max` characters (code points), marked when cut.
export function trimChars(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : chars.slice(0, max).join('') + ELLIPSIS
}

// Every git call: a literal argv, no pager, paths printed as they are, the session's root as the working directory.
export const git = (ctx: QueryCtx, args: string[]) =>
  ctx.run(['git', '--no-pager', '-c', 'core.quotepath=off', '-C', ctx.root, ...args], { timeoutMs: QUERY_RUN_TIMEOUT_MS })

// A path git reads as itself: no `:(top)`, `:!` or glob magic, whatever it holds.
export const literal = (rel: string): string => `:(literal)${rel}`

// A NUL-separated list; an entry the engine's output cap cut short (no closing NUL) is dropped.
export function nulList(out: string): string[] {
  const items = out.split('\u0000')
  items.pop()
  return items.filter(item => item !== '')
}

// The whole text is scanned before any cut: a cut could leave half a key that no longer matches.
export const shareable = (text: string, max: number): Out => (hasSecret(text) ? denied : { ok: true, body: trimBytes(text, max) })

// What `file` would send for a path, or null: inside the repo once links are followed, not denied or ignored,
// text (no NUL), at most 256 KB and free of anything the scan flags.
export async function servedText(ctx: QueryCtx, rel: string): Promise<string | null> {
  const abs = await resolveInRepo({ run: ctx.run, root: ctx.root, rel, realPath: ctx.realPath })
  if (abs === null) return null
  const text = await ctx.readFile(abs).catch(() => null)
  if (text === null || text.includes('\u0000') || utf8Bytes(text) > MAX_FILE_BYTES || hasSecret(text)) return null
  return text
}
