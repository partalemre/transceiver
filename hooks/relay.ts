import type { EngineInterface } from 'claude-code'

import { alreadyStoredPath, errorKind, parseDocs, parseSelfUid, parseWriteVersion } from './dbtext'
import { HEADS_PAGE, SINCE_PAGE } from './limits'
import { emptyHead, isUid, parseHead, parseMessage, parseMeta, paths } from './protocol'
import type { Head, Message, RoomMeta, Unreadable } from './protocol'

export type CallResult = { text?: string; isError?: boolean; deny?: string; result?: unknown }
export type ToolCaller = (input: Record<string, unknown>) => Promise<CallResult>
export type RelayErrorKind = 'denied' | 'conflict' | 'missing' | 'failed'
export type HeadState = { head: Head; version: number }
export type HeadEntry = HeadState & { uid: string }

// A head write names only the fields its caller owns; the relay merges them over the stored head, so a send never
// drops a read cursor and a read mark never drops `gh` or `label`. A function patch sees the head it lands on.
export type HeadFields = Partial<Omit<Head, 'v'>>
export type HeadPatch = HeadFields | ((current: Head) => HeadFields)

// `known` is the caller's cached head and its version: the write is pinned to it, so a stale cache costs one
// re-read and a retry, never a lost field.
export type HeadWrite = { uid: string; patch: HeadPatch; known?: HeadState }
export type SendOpts = { uid: string; message: Message; known?: HeadState }
export type ReadMark = { uid: string; seenUpTo: string; readUpTo?: string; readTs?: number; known?: HeadState }

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
  send(opts: SendOpts): Promise<HeadState>
  markRead(opts: ReadMark): Promise<HeadState>
  writeHead(opts: HeadWrite): Promise<HeadState>
  claim(opts: { uid: string; qid: string; now: number }): Promise<boolean>
}

type Ctx = { call: ToolCaller; url: string }
type Merge = HeadWrite & { extra: Record<string, unknown>[] }

// `consent` is the person's own words for the press that raised a write (the spike showed the first write of a
// session needs their approval); reads never carry it.
export function callerOf($: EngineInterface, consent?: string): ToolCaller {
  return async input => (await $.tool.call({ ...input, ...(consent === undefined ? {} : { consent }) } as never)) as CallResult
}

async function invoke(call: ToolCaller, input: Record<string, unknown>): Promise<CallResult> {
  try {
    return await call({ tool: 'ArtifactData', ...input })
  } catch (cause) {
    throw new RelayError('failed', `ArtifactData ${String(input.action)} failed`, { cause })
  }
}

function textOf(out: CallResult): string {
  if (out.deny !== undefined) throw new RelayError('denied', out.deny)
  const text = out.text ?? ''
  if (out.isError === true) throw new RelayError(errorKind(text), text.split('\n')[0] ?? 'error')
  return text
}

const exec = async (ctx: Ctx, input: Record<string, unknown>) => textOf(await invoke(ctx.call, { url: ctx.url, ...input }))
const isKind = (err: unknown, kind: RelayErrorKind): err is RelayError => err instanceof RelayError && err.kind === kind
const maxId = (a: string, b: string) => (a >= b ? a : b)

async function getDoc(ctx: Ctx, collection: string, docId: string) {
  try {
    return parseDocs(await exec(ctx, { action: 'get', collection, doc_id: docId }))[0] ?? null
  } catch (err) {
    if (isKind(err, 'missing')) return null
    throw err
  }
}

async function readOwnHead(ctx: Ctx, uid: string): Promise<HeadState> {
  const doc = await getDoc(ctx, paths.heads, uid)
  // A head that no longer parses is rebuilt from scratch at its version, so the next write repairs it.
  return { head: parseHead(doc?.data) ?? emptyHead(), version: doc?.version ?? 0 }
}

function applyPatch(head: Head, patch: HeadPatch): Head {
  const fields = typeof patch === 'function' ? patch(head) : patch
  return { ...head, ...fields, v: 1 }
}

function headWriteOf(uid: string, head: Head, version: number): Record<string, unknown> {
  return { op: 'set', collection: paths.heads, doc_id: uid, data: head, ...(version > 0 ? { if_version: version } : {}) }
}

function isSameHead(a: Head, b: Head): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Head>
  return [...keys].every(k => a[k] === b[k])
}

async function attempt(ctx: Ctx, w: Merge, base: HeadState): Promise<HeadState> {
  const head = applyPatch(base.head, w.patch)
  // A head-only write that changes nothing is not sent: read marks run on every poll.
  if (w.extra.length === 0 && base.version > 0 && isSameHead(head, base.head)) return base
  const text = await exec(ctx, { action: 'batch', writes: [...w.extra, headWriteOf(w.uid, head, base.version)] })
  return { head, version: parseWriteVersion(text, paths.heads, w.uid) ?? base.version + 1 }
}

// A stale pin is re-read and merged once. A refusal that names an existing doc is not a stale head: retrying
// the same batch could not succeed, so it goes back to the caller to settle.
async function writeMerged(ctx: Ctx, w: Merge): Promise<HeadState> {
  const base = w.known ?? (await readOwnHead(ctx, w.uid))
  try {
    return await attempt(ctx, w, base)
  } catch (err) {
    if (!isKind(err, 'conflict') || alreadyStoredPath(err.message) !== null) throw err
    return attempt(ctx, w, await readOwnHead(ctx, w.uid))
  }
}

const advanceTo = (message: Message): HeadPatch => current =>
  current.head >= message.id ? {} : { head: message.id, headTs: message.ts }

// The message is in the room already (an earlier send landed and its reply was lost). Confirm it is there, then
// make sure the head announces it, without moving a head that is already at or past it.
async function settleDelivered(ctx: Ctx, opts: SendOpts): Promise<HeadState> {
  const stored = await getDoc(ctx, paths.msgs(opts.uid), opts.message.id)
  if (stored === null || stored.data.id !== opts.message.id) throw new RelayError('conflict', 'message reported stored but not found')
  const current = await readOwnHead(ctx, opts.uid)
  if (current.head.head >= opts.message.id) return current
  return writeMerged(ctx, { uid: opts.uid, patch: advanceTo(opts.message), known: current, extra: [] })
}

async function send(ctx: Ctx, opts: SendOpts): Promise<HeadState> {
  const message = { op: 'set', collection: paths.msgs(opts.uid), doc_id: opts.message.id, data: opts.message }
  try {
    return await writeMerged(ctx, { uid: opts.uid, patch: advanceTo(opts.message), known: opts.known, extra: [message] })
  } catch (err) {
    const isDelivered = isKind(err, 'conflict') && alreadyStoredPath(err.message) === `${paths.msgs(opts.uid)}/${opts.message.id}`
    if (!isDelivered) throw err
    return settleDelivered(ctx, opts)
  }
}

// Cursors only move forward, so a late write from another session of the same person never rewinds them.
function readPatch(mark: ReadMark): HeadPatch {
  return current => {
    const fields: HeadFields = { seenUpTo: maxId(current.seenUpTo, mark.seenUpTo) }
    if (mark.readUpTo === undefined || mark.readUpTo <= current.readUpTo) return fields
    return { ...fields, readUpTo: mark.readUpTo, readTs: Math.max(current.readTs, mark.readTs ?? 0) }
  }
}

async function whoami(ctx: Ctx): Promise<string> {
  const out = await invoke(ctx.call, { url: ctx.url, action: 'list', collection: 'data/users/me', query: { limit: 1 } })
  const text = textOf(out)
  const meId = (out.result as { db_read?: { me_id?: unknown } } | undefined)?.db_read?.me_id
  const uid = isUid(meId) ? meId : parseSelfUid(text)
  if (uid === null) throw new RelayError('failed', 'could not resolve own uid')
  return uid
}

async function heads(ctx: Ctx): Promise<HeadEntry[]> {
  const docs = parseDocs(await exec(ctx, { action: 'list', collection: paths.heads, query: { limit: HEADS_PAGE } }))
  return docs.filter(d => isUid(d.id)).flatMap(d => {
    const head = parseHead(d.data)
    return head === null ? [] : [{ uid: d.id, head, version: d.version }]
  })
}

async function since(ctx: Ctx, uid: string, afterTs: number): Promise<Array<Message | Unreadable>> {
  const query = { where: [['ts', '>', afterTs]], order_by: { field: 'ts', direction: 'asc' }, limit: SINCE_PAGE }
  const docs = parseDocs(await exec(ctx, { action: 'query', collection: paths.msgs(uid), query }))
  return docs.map(d => parseMessage(d.id, d.data))
}

async function claim(ctx: Ctx, opts: { uid: string; qid: string; now: number }): Promise<boolean> {
  try {
    await exec(ctx, { action: 'set', collection: paths.claims(opts.uid), doc_id: opts.qid, data: { v: 1, at: opts.now } })
    return true
  } catch (err) {
    // Any refusal means another session already holds it, or we cannot tell: either way, do not answer.
    if (err instanceof RelayError) return false
    throw err
  }
}

export function relayOf(call: ToolCaller, url: string): Relay {
  const ctx: Ctx = { call, url }
  return {
    whoami: () => whoami(ctx),
    meta: async () => parseMeta((await getDoc(ctx, paths.meta, 'room'))?.data),
    writeMeta: async meta => { await exec(ctx, { action: 'set', collection: paths.meta, doc_id: 'room', data: meta }) },
    heads: () => heads(ctx),
    since: (uid, afterTs) => since(ctx, uid, afterTs),
    send: opts => send(ctx, opts),
    markRead: mark => writeMerged(ctx, { uid: mark.uid, patch: readPatch(mark), known: mark.known, extra: [] }),
    writeHead: opts => writeMerged(ctx, { ...opts, extra: [] }),
    claim: opts => claim(ctx, opts),
  }
}
