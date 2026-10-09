import { MAX_PATH_BYTES, MAX_TEXT_BYTES, PROTOCOL_VERSION } from './limits'

export const DENIED = 'erişim yok'
const KINDS = ['human', 'agent', 'query', 'answer', 'system'] as const
const QUERY_TYPES = ['status', 'log', 'branch', 'diff', 'file', 'tests', 'plan', 'ask'] as const
const ROOM_KINDS = ['dm', 'project'] as const

export type Kind = (typeof KINDS)[number]
export type QueryType = (typeof QUERY_TYPES)[number]
export type Query = { type: QueryType; repo: string; path?: string; question?: string }
export type Answer = { qid: string; ok: boolean; body: string; tokens: number }
export type Message = {
  v: 1; id: string; ts: number; kind: Kind; text: string; replyTo?: string; query?: Query; answer?: Answer
}
export type Unreadable = { id: string; isUnreadable: true; reason: string }
export type Head = {
  v: 1; head: string; headTs: number; seenUpTo: string; readUpTo: string; readTs: number; gh?: string; label?: string
}
export type RoomMeta = { v: 1; kind: (typeof ROOM_KINDS)[number]; repo?: string; createdAt: number }

export const paths = {
  heads: 'outbox',
  msgs: (uid: string) => `outbox/${uid}/msgs`,
  claims: (uid: string) => `outbox/${uid}/claims`,
  days: (uid: string) => `outbox/${uid}/days`,
  meta: 'meta',
} as const

const UID = /^u_[A-Za-z0-9_-]{22}$/
const ID = /^[0-9A-HJKMNP-TV-Z]{26}$/
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const GH_LOGIN = /^[A-Za-z0-9-]{1,39}$/
const SHORT_TEXT = 200
const ONE_BYTE = 0x80
const TWO_BYTES = 0x800
const THREE_BYTES = 0x10000

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0
const isText = (x: unknown, max = MAX_TEXT_BYTES): x is string => typeof x === 'string' && x.length <= max && utf8Bytes(x) <= max
const isOneOf = <T extends string>(list: readonly T[], x: unknown): x is T => list.includes(x as T)

export const isUid = (x: unknown): x is string => typeof x === 'string' && UID.test(x)
export const isId = (x: unknown): x is string => typeof x === 'string' && ID.test(x)
const isDotsOnly = (segment: string): boolean => /^\.+$/.test(segment)
export const isRepo = (x: unknown): x is string =>
  typeof x === 'string' && REPO.test(x) && !x.includes('..') && !x.split('/').some(isDotsOnly)
const isIdOrEmpty = (x: unknown): x is string => x === '' || isId(x)
export const isUnreadable = (x: Message | Unreadable): x is Unreadable => 'isUnreadable' in x

function charBytes(code: number): number {
  if (code < ONE_BYTE) return 1
  if (code < TWO_BYTES) return 2
  if (code < THREE_BYTES) return 3
  return 4
}

export function utf8Bytes(text: string): number {
  let bytes = 0
  for (const ch of text) bytes += charBytes(ch.codePointAt(0) ?? 0)
  return bytes
}

function parseQuery(x: unknown): Query | null {
  if (!isObj(x) || !isOneOf(QUERY_TYPES, x.type) || !isRepo(x.repo)) return null
  if (x.path !== undefined && !isText(x.path, MAX_PATH_BYTES)) return null
  if (x.question !== undefined && !isText(x.question)) return null
  return { type: x.type, repo: x.repo, path: x.path as string | undefined, question: x.question as string | undefined }
}

function parseAnswer(x: unknown): Answer | null {
  if (!isObj(x) || !isId(x.qid) || typeof x.ok !== 'boolean' || !isText(x.body) || !isCount(x.tokens)) return null
  return { qid: x.qid, ok: x.ok, body: x.body, tokens: x.tokens }
}

const unreadable = (id: string, reason: string): Unreadable => ({ id, isUnreadable: true, reason })

export function parseMessage(id: string, raw: unknown): Message | Unreadable {
  if (!isObj(raw)) return unreadable(id, 'not an object')
  if (raw.v !== PROTOCOL_VERSION) return unreadable(id, 'unknown version')
  if (raw.id !== id || !isId(id)) return unreadable(id, 'id mismatch')
  if (!isOneOf(KINDS, raw.kind) || !isCount(raw.ts) || !isText(raw.text)) return unreadable(id, 'bad fields')
  const message: Message = { v: 1, id, ts: raw.ts, kind: raw.kind, text: raw.text }
  if (raw.replyTo !== undefined) {
    if (!isId(raw.replyTo)) return unreadable(id, 'bad replyTo')
    message.replyTo = raw.replyTo
  }
  if (raw.kind === 'query') {
    const query = parseQuery(raw.query)
    if (query === null) return unreadable(id, 'bad query')
    message.query = stripUndefined(query)
  }
  if (raw.kind === 'answer') {
    const answer = parseAnswer(raw.answer)
    if (answer === null) return unreadable(id, 'bad answer')
    message.answer = answer
  }
  return message
}

function stripUndefined<T extends object>(x: T): T {
  return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as T
}

export function parseHead(raw: unknown): Head | null {
  if (!isObj(raw) || raw.v !== PROTOCOL_VERSION) return null
  const { head, seenUpTo, readUpTo } = raw
  if (!isIdOrEmpty(head) || !isIdOrEmpty(seenUpTo) || !isIdOrEmpty(readUpTo)) return null
  if (!isCount(raw.headTs) || !isCount(raw.readTs)) return null
  if (raw.gh !== undefined && !(typeof raw.gh === 'string' && GH_LOGIN.test(raw.gh))) return null
  if (raw.label !== undefined && !isText(raw.label, SHORT_TEXT)) return null
  return stripUndefined<Head>({
    v: 1, head, headTs: raw.headTs, seenUpTo, readUpTo, readTs: raw.readTs,
    gh: raw.gh as string | undefined, label: raw.label as string | undefined,
  })
}

export function parseMeta(raw: unknown): RoomMeta | null {
  if (!isObj(raw) || raw.v !== PROTOCOL_VERSION || !isOneOf(ROOM_KINDS, raw.kind) || !isCount(raw.createdAt)) return null
  if ((raw.kind === 'project' || 'repo' in raw) && !isRepo(raw.repo)) return null
  return stripUndefined<RoomMeta>({ v: 1, kind: raw.kind, repo: raw.repo as string | undefined, createdAt: raw.createdAt })
}

export const emptyHead = (): Head => ({ v: 1, head: '', headTs: 0, seenUpTo: '', readUpTo: '', readTs: 0 })
