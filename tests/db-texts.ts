// The ArtifactData texts measured in docs/spike-results.md. The verbatim ones are kept as written there;
// the builders produce the same shapes for any path so the fake db answers in the real formats.

export const SPIKE_UID = 'u_OILIt9wuDiBBxrdcLpQjLA'

export const BATCH_COMMITTED = [
  'Database batch committed atomically — 2 writes; who can read them follows the page\'s access rules (by default, everyone who can open the artifact):',
  `- set "outbox/${SPIKE_UID}/msgs"/"m0003probe" (version 1)`,
  `- set "outbox"/"${SPIKE_UID}" (version 2)`,
  '6 of 25000 documents used in this artifact\'s database.',
].join('\n')

export const BATCH_EXISTS = `db batch write failed (version_mismatch): writes[0] (write 1 of 2) targets outbox/${SPIKE_UID}/msgs/m0003probe, which already exists, and carried no if_version — the whole batch wrote nothing. …`

export const BATCH_STALE_PIN = `db batch write failed (version_mismatch): the batch is atomic, so nothing was written — none of the writes applied. writes[1] (write 2 of 2, "outbox/${SPIKE_UID}") was pinned to version 1 and that document is now at version 2: …`

export const DOC_LIMIT = 25_000

// A delete's line is unmeasured; it is written like a set's, without a version.
export type WriteLine = { op?: 'set' | 'delete'; collection: string; docId: string; version: number }

export function batchCommitted(lines: WriteLine[], used: number): string {
  return [
    `Database batch committed atomically — ${lines.length} writes; who can read them follows the page's access rules (by default, everyone who can open the artifact):`,
    ...lines.map(l => (l.op === 'delete' ? `- delete "${l.collection}"/"${l.docId}"` : `- set "${l.collection}"/"${l.docId}" (version ${l.version})`)),
    `${used} of ${DOC_LIMIT} documents used in this artifact's database.`,
  ].join('\n')
}

export type Refusal = { index: number; count: number; path: string }

export const batchExists = (r: Refusal) =>
  `db batch write failed (version_mismatch): writes[${r.index}] (write ${r.index + 1} of ${r.count}) targets ${r.path}, which already exists, and carried no if_version — the whole batch wrote nothing. …`

export const batchStalePin = (r: Refusal & { pinned: number; now: number }) =>
  `db batch write failed (version_mismatch): the batch is atomic, so nothing was written — none of the writes applied. writes[${r.index}] (write ${r.index + 1} of ${r.count}, "${r.path}") was pinned to version ${r.pinned} and that document is now at version ${r.now}: …`

export const setCommitted = (collection: string, docId: string, version: number) =>
  `Database set committed: "${collection}"/"${docId}". The document is now at version ${version}.`

export const setExists = (path: string) =>
  `db write failed (version_mismatch): ${path} already exists and this write carried no if_version — nothing was written. …`

export const setStalePin = (pinned: number, now: number) =>
  `db write failed (version_mismatch): the document is no longer at version ${pinned}, the one this write was pinned to — it is now at version ${now}; nothing was written. Read it back, …`

export const MISSING = 'db write failed (invalid_argument): no such artifact, collection, or document (or no access …)'
