import type { EngineInterface } from 'claude-code'

import { errorKind, parseDocs, parseSelfUid, parseWriteVersion } from './dbtext'
import { HEADS_PAGE, SINCE_PAGE } from './limits'
import { emptyHead, isUid, parseHead, parseMessage, parseMeta, paths } from './protocol'
import type { Head, Message, RoomMeta, Unreadable } from './protocol'

export type CallResult = { text?: string; isError?: boolean; deny?: string; result?: unknown }
export type ToolCaller = (input: Record<string, unknown>) => Promise<CallResult>
export type RelayErrorKind = 'denied' | 'conflict' | 'missing' | 'failed'
export type HeadEntry = { uid: string; head: Head; version: number }
type HeadWrite = { uid: string; nextHead: (prev: Head) => Head; version?: number }

export class RelayError extends Error {
  constructor(readonly kind: RelayErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RelayError'
  }
}

export type Relay = {
  whoami(): Promise<string>
  meta(): Promise<RoomMeta | null>
  writeMeta(meta: RoomMeta): Promise<void>
  heads(): Promise<HeadEntry[]>
  since(uid: string, afterTs: number): Promise<Array<Message | Unreadable>>
  send(opts: HeadWrite & { message: Message }): Promise<number>
  writeHead(opts: HeadWrite): Promise<number>
  claim(opts: { uid: string; qid: string; now: number }): Promise<boolean>
}

// `consent` is the person's own words for the press that raised a write (the spike showed the first write of a
// session needs their approval); reads never carry it.
export function callerOf($: EngineInterface, consent?: string): ToolCaller {
  return async input => (await $.tool.call({ ...input, ...(consent === undefined ? {} : { consent }) } as never)) as CallResult
}

async function run(call: ToolCaller, input: Record<string, unknown>): Promise<string> {
  let out: CallResult
  try {
    out = await call({ tool: 'ArtifactData', ...input })
  } catch (cause) {
    throw new RelayError('failed', `ArtifactData ${String(input.action)} failed`, { cause })
  }
  if (out.deny !== undefined) throw new RelayError('denied', out.deny)
  const text = out.text ?? ''
  if (out.isError === true) throw new RelayError(errorKind(text), text.split('\n')[0] ?? 'error')
  return text
}

export function relayOf(call: ToolCaller, url: string): Relay {
  const exec = (input: Record<string, unknown>) => run(call, { url, ...input })

  async function ownHead(uid: string): Promise<HeadEntry> {
    try {
      const doc = parseDocs(await exec({ action: 'get', collection: paths.heads, doc_id: uid }))[0]
      return { uid, head: parseHead(doc?.data) ?? emptyHead(), version: doc?.version ?? 0 }
    } catch (err) {
      if (err instanceof RelayError && err.kind === 'missing') return { uid, head: emptyHead(), version: 0 }
      throw err
    }
  }

  async function writeWithRetry(opts: HeadWrite, extra: Record<string, unknown>[]): Promise<number> {
    const attempt = async (head: Head, version: number) => {
      const headWrite = { op: 'set', collection: paths.heads, doc_id: opts.uid, data: head, ...(version > 0 ? { if_version: version } : {}) }
      const text = await exec({ action: 'batch', writes: [...extra, headWrite] })
      return parseWriteVersion(text, paths.heads, opts.uid) ?? version + 1
    }
    // A caller that passes a version owns the whole head (nextHead gets an empty one): no read on the hot path.
    const first = opts.version === undefined ? await ownHead(opts.uid) : { head: emptyHead(), version: opts.version }
    try {
      return await attempt(opts.nextHead(first.head), first.version)
    } catch (err) {
      if (!(err instanceof RelayError && err.kind === 'conflict')) throw err
      const fresh = await ownHead(opts.uid)
      return attempt(opts.nextHead(fresh.head), fresh.version)
    }
  }

  return {
    async whoami() {
      let structured: unknown
      const text = await run(async input => {
        const out = await call(input)
        structured = out.result
        return out
      }, { url, action: 'list', collection: 'data/users/me', query: { limit: 1 } })
      const meId = (structured as { db_read?: { me_id?: unknown } } | undefined)?.db_read?.me_id
      const uid = typeof meId === 'string' ? meId : parseSelfUid(text)
      if (uid === null) throw new RelayError('failed', 'could not resolve own uid')
      return uid
    },
    async meta() {
      try {
        const doc = parseDocs(await exec({ action: 'get', collection: paths.meta, doc_id: 'room' }))[0]
        return parseMeta(doc?.data)
      } catch (err) {
        if (err instanceof RelayError && err.kind === 'missing') return null
        throw err
      }
    },
    async writeMeta(meta) {
      await exec({ action: 'set', collection: paths.meta, doc_id: 'room', data: meta })
    },
    async heads() {
      const docs = parseDocs(await exec({ action: 'list', collection: paths.heads, query: { limit: HEADS_PAGE } }))
      return docs.filter(d => isUid(d.id)).flatMap(d => {
        const head = parseHead(d.data)
        return head === null ? [] : [{ uid: d.id, head, version: d.version }]
      })
    },
    async since(uid, afterTs) {
      const query = { where: [['ts', '>', afterTs]], order_by: { field: 'ts', direction: 'asc' }, limit: SINCE_PAGE }
      const docs = parseDocs(await exec({ action: 'query', collection: paths.msgs(uid), query }))
      return docs.map(d => parseMessage(d.id, d.data))
    },
    send(opts) {
      const message = { op: 'set', collection: paths.msgs(opts.uid), doc_id: opts.message.id, data: opts.message }
      return writeWithRetry(opts, [message])
    },
    writeHead(opts) {
      return writeWithRetry(opts, [])
    },
    async claim({ uid, qid, now }) {
      try {
        await exec({ action: 'set', collection: paths.claims(uid), doc_id: qid, data: { v: 1, at: now } })
        return true
      } catch (err) {
        // Any refusal means another session already holds it, or we cannot tell: either way, do not answer.
        if (err instanceof RelayError) return false
        throw err
      }
    },
  }
}
