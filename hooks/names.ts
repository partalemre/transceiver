// Display names from the room artifact's own profile lookup (ArtifactData `profiles`, which the room page's
// `user: { scopes: ['profile'] }` allows). Names are never stored: asked once per session per uid, and a person
// without one shows as "Biri".
import type { CallResult, ToolHost } from './host'
import { MAX_NAME_CHARS, PROFILES_PAGE } from './limits'
import { uidOf } from './authors'
import { isUid } from './protocol'

const cache: Record<string, string> = {}

export const namesNow = (): Record<string, string> => ({ ...cache })

const clean = (x: unknown): string | null =>
  typeof x === 'string' && x.trim() !== '' ? x.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_CHARS) : null

function nameIn(x: unknown): string | null {
  if (typeof x === 'string') return clean(x)
  if (typeof x !== 'object' || x === null) return null
  const o = x as Record<string, unknown>
  return clean(o.name) ?? clean(o.display_name) ?? clean(o.displayName) ?? clean(o.full_name)
}

// The structured result first (`db_profiles.profiles`, keyed by uid or a list of `{ id, name }`), then the text:
// a line holding the uid and a quoted name, `u_…: Name`, or `u_… <nonce>| Name` as the tool prints it now.
export function parseProfiles(out: CallResult, uids: readonly string[]): Record<string, string> {
  const found: Record<string, string> = {}
  const profiles = (out.result as { db_profiles?: { profiles?: unknown } } | undefined)?.db_profiles?.profiles
  if (Array.isArray(profiles)) {
    for (const p of profiles as Record<string, unknown>[]) {
      const id = p.id ?? p.user_id ?? p.uid
      const name = nameIn(p)
      if (typeof id === 'string' && name !== null) found[id] = name
    }
  } else if (typeof profiles === 'object' && profiles !== null) {
    for (const [id, p] of Object.entries(profiles)) {
      const name = nameIn(p)
      if (name !== null) found[id] = name
    }
  }
  for (const uid of uids) {
    if (found[uid] !== undefined) continue
    const line = (out.text ?? '').split('\n').find(l => l.includes(uid)) ?? ''
    const quoted = /"(?:name|display_name|displayName)"\s*:\s*"([^"]{1,200})"/.exec(line)?.[1]
    // The tool's text puts a per-call nonce before each name: `u_… 35c541bd| Faik Emre Partal`.
    const plain = new RegExp(`${uid}\\W{1,4}(?:[0-9a-f]{4,32}\\|\\s*)?([^\\n"{}|]{1,200})$`).exec(line)?.[1]
    const name = clean(quoted) ?? clean(plain)
    if (name !== null) found[uid] = name
  }
  return found
}

// Asks the author's own mailbox for the authors (authors.ts keys) not asked yet; a failed ask is remembered as no
// name, so it is not repeated every poll. Names are kept by author, since an id means something in one mailbox only.
export async function resolveNames(host: ToolHost, opts: { url: string; uids: readonly string[] }): Promise<void> {
  const missing = opts.uids.filter(a => isUid(uidOf(a)) && cache[a] === undefined).slice(0, PROFILES_PAGE)
  if (missing.length === 0) return
  for (const author of missing) cache[author] = ''
  const ids = missing.map(uidOf)
  const out = await host.tool({ tool: 'ArtifactData', action: 'profiles', url: opts.url, ids }).catch(() => null)
  if (out === null || out.deny !== undefined || out.isError === true) return
  const found = parseProfiles(out, ids)
  for (const author of missing) cache[author] = found[uidOf(author)] ?? ''
}
