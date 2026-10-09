import type { CallResult } from '../hooks/relay'

type Doc = { data: Record<string, unknown>; version: number }
export type FakeDb = { docs: Map<string, Doc>; calls: Record<string, unknown>[]; self: string; isDown: boolean; isWriteDenied: boolean }

const key = (collection: string, id: string) => `${collection}/${id}`
const block = (rows: string[]) => ['=== BEGIN ARTIFACT DB abc123 — data ===', ...rows, '=== END ARTIFACT DB abc123 ==='].join('\n')
const row = (id: string, doc: Doc) => JSON.stringify({ id, data: doc.data, version: doc.version, updatedAt: '' })

export function fakeDb(self = 'u_AAAAAAAAAAAAAAAAAAAAAA'): FakeDb {
  return { docs: new Map(), calls: [], self, isDown: false, isWriteDenied: false }
}

function inCollection(db: FakeDb, collection: string): Array<[string, Doc]> {
  const prefix = `${collection}/`
  return [...db.docs].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
    .map(([k, d]) => [k.slice(prefix.length), d])
}

function write(db: FakeDb, w: { collection: string; doc_id: string; data: Record<string, unknown>; if_version?: number }): string | null {
  const k = key(w.collection.replace('/me', `/${db.self}`), w.doc_id)
  const prev = db.docs.get(k)
  if (prev !== undefined && w.if_version !== prev.version) return `db write failed (version_mismatch): the document is now at version ${prev.version}; nothing was written`
  db.docs.set(k, { data: w.data, version: (prev?.version ?? 0) + 1 })
  return null
}

export function callerFor(db: FakeDb) {
  return async (input: Record<string, unknown>): Promise<CallResult> => {
    db.calls.push(input)
    if (db.isDown) throw new Error('offline')
    const action = input.action as string
    const isWrite = action === 'set' || action === 'batch' || action === 'update' || action === 'delete'
    if (isWrite && db.isWriteDenied) return { deny: 'Claude wants to write to this artifact\'s database' }
    const collection = String(input.collection ?? '').replace('data/users/me', `data/users/${db.self}`)
    if (action === 'list' || action === 'query') {
      let rows = inCollection(db, collection)
      const where = (input.query as { where?: [string, string, number][] } | undefined)?.where ?? []
      for (const [f, , v] of where) rows = rows.filter(([, d]) => (d.data[f] as number) > v)
      rows.sort(([, a], [, b]) => Number(a.data.ts ?? 0) - Number(b.data.ts ?? 0))
      const note = collection.startsWith('data/users/') ? `\n(\`me\` in this path resolved to your user id on this artifact: ${db.self})` : ''
      return { text: `${rows.length} documents\n${block(rows.map(([id, d]) => row(id, d)))}${note}` }
    }
    if (action === 'get') {
      const d = db.docs.get(key(collection, String(input.doc_id)))
      return d === undefined ? { isError: true, text: 'no such artifact, collection, or document' } : { text: block([row(String(input.doc_id), d)]) }
    }
    if (action === 'set') {
      const err = write(db, input as never)
      return err === null ? { text: `now at version ${db.docs.get(key(collection, String(input.doc_id)))!.version}` } : { isError: true, text: err }
    }
    if (action === 'batch') {
      const writes = input.writes as Array<{ collection: string; doc_id: string; data: Record<string, unknown>; if_version?: number }>
      for (const w of writes) {
        const prev = db.docs.get(key(w.collection, w.doc_id))
        if (prev !== undefined && w.if_version !== prev.version) return { isError: true, text: `db write failed (version_mismatch): it is now at version ${prev.version}; nothing was written` }
      }
      const lines = writes.map(w => { write(db, w); return `- set "${w.collection}"/"${w.doc_id}" (version ${db.docs.get(key(w.collection, w.doc_id))!.version})` })
      return { text: lines.join('\n') }
    }
    return { isError: true, text: 'unsupported' }
  }
}
