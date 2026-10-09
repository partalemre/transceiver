export type DbDoc = { id: string; data: Record<string, unknown>; version: number; updatedAt: string }

const BEGIN = /^=== BEGIN ARTIFACT DB [0-9a-f]+ /
const END = /^=== END ARTIFACT DB [0-9a-f]+ ===$/
const SELF = /resolved to your user id on this artifact: (u_[A-Za-z0-9_-]{22})/
const URL_RE = /https:\/\/claude\.ai\/artifact\/[A-Za-z0-9]+/g
const CONFLICT = /\(version_mismatch\)/
const MISSING = /no such artifact, collection, or document/i
const ALREADY_STORED = /writes\[\d+\] \(write \d+ of \d+\) targets (\S+), which already exists/
const GONE_PIN = /writes\[(\d+)\] \(write \d+ of \d+, "([^"]+)"\) was pinned to version \d+ and that document has changed or may have been deleted \(the server named no current version\)/

function asDoc(line: string): DbDoc | null {
  try {
    const x = JSON.parse(line) as Record<string, unknown>
    const isDoc = typeof x.id === 'string' && Number.isInteger(x.version) && (x.version as number) >= 0
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

// Notes written by the tool sit outside the blocks; anything inside a block is a peer's text.
function outsideBlocks(text: string): string {
  const kept: string[] = []
  let isInside = false
  for (const line of text.split('\n')) {
    if (BEGIN.test(line)) { isInside = true; continue }
    if (END.test(line)) { isInside = false; continue }
    if (!isInside) kept.push(line)
  }
  return kept.join('\n')
}

export const parseSelfUid = (text: string): string | null => SELF.exec(outsideBlocks(text))?.[1] ?? null

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

export function parseWriteVersion(text: string, collection: string, docId: string): number | null {
  const inBatch = new RegExp(`"${escapeRe(collection)}"/"${escapeRe(docId)}" \\(version (\\d+)\\)`).exec(text)
  if (inBatch !== null) return Number(inBatch[1])
  const single = /now at version (\d+)/.exec(text)
  return single === null ? null : Number(single[1])
}

// A batch refused because one of its create-only writes names a doc that is already there
// (spike: "writes[0] (write 1 of 2) targets outbox/<uid>/msgs/<id>, which already exists, …").
export const alreadyStoredPath = (text: string): string | null => ALREADY_STORED.exec(outsideBlocks(text))?.[1] ?? null

// A batch refused because a pinned write's doc is gone (spike: "writes[0] (write 1 of 1, "outbox/<uid>/msgs/<id>")
// was pinned to version 1 and that document has changed or may have been deleted (the server named no current
// version)"): which write, and its path.
export function gonePin(text: string): { index: number; path: string } | null {
  const hit = GONE_PIN.exec(outsideBlocks(text))
  return hit === null ? null : { index: Number(hit[1]), path: hit[2] ?? '' }
}

// The tool's own line after a write (spike: "6 of 25000 documents used in this artifact's database."). Only a line
// outside the doc blocks counts, so a peer's text cannot fake a full room.
const USED = /^(\d+) of \d+ documents used in this artifact's database\.?$/m

export function parseDocsUsed(text: string): number | null {
  const hit = USED.exec(outsideBlocks(text))
  return hit === null ? null : Number(hit[1])
}

export const parseArtifactUrls =(text: string): string[] => [...new Set(outsideBlocks(text).match(URL_RE) ?? [])]

export function errorKind(text: string): 'conflict' | 'missing' | 'failed' {
  const own = outsideBlocks(text)
  if (MISSING.test(own)) return 'missing'
  if (CONFLICT.test(own)) return 'conflict'
  return 'failed'
}
