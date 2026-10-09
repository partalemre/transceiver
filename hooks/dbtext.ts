export type DbDoc = { id: string; data: Record<string, unknown>; version: number; updatedAt: string }

const BEGIN = /^=== BEGIN ARTIFACT DB [0-9a-f]+ /
const END = /^=== END ARTIFACT DB [0-9a-f]+ ===$/
const SELF = /resolved to your user id on this artifact: (u_[A-Za-z0-9_-]{22})/
const URL = /https:\/\/claude\.ai\/artifact\/[A-Za-z0-9]+/g
const CONFLICT = /changed|current version|if_version/i
const MISSING = /no such artifact, collection, or document/i

function asDoc(line: string): DbDoc | null {
  try {
    const x = JSON.parse(line) as Record<string, unknown>
    const isDoc = typeof x.id === 'string' && typeof x.version === 'number'
      && typeof x.data === 'object' && x.data !== null && !Array.isArray(x.data)
    if (!isDoc) return null
    return { id: x.id as string, data: x.data as Record<string, unknown>, version: x.version as number, updatedAt: String(x.updatedAt ?? '') }
  } catch {
    // A malformed row is one bad document, never the whole read.
    return null
  }
}

// JSON keeps each document on one line (string newlines are escaped), so a peer's text cannot forge a marker line.
export function parseDocs(text: string): DbDoc[] {
  const docs: DbDoc[] = []
  let isInside = false
  for (const line of text.split('\n')) {
    if (BEGIN.test(line)) { isInside = true; continue }
    if (END.test(line)) { isInside = false; continue }
    if (!isInside || !line.startsWith('{')) continue
    const doc = asDoc(line)
    if (doc !== null) docs.push(doc)
  }
  return docs
}

export const parseSelfUid = (text: string): string | null => SELF.exec(text)?.[1] ?? null

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

export function parseWriteVersion(text: string, collection: string, docId: string): number | null {
  const inBatch = new RegExp(`"${escape(collection)}"/"${escape(docId)}" \\(version (\\d+)\\)`).exec(text)
  if (inBatch !== null) return Number(inBatch[1])
  const single = /now at version (\d+)/.exec(text)
  return single === null ? null : Number(single[1])
}

export const parseArtifactUrls = (text: string): string[] => [...new Set(text.match(URL) ?? [])]

export function errorKind(text: string): 'conflict' | 'missing' | 'failed' {
  if (MISSING.test(text)) return 'missing'
  if (CONFLICT.test(text)) return 'conflict'
  return 'failed'
}
