import { GREP_MAX_CHARS, GREP_MIN_CHARS, MAX_ANSWER_PARTS, MAX_PATH_BYTES, MAX_TEXT_BYTES, PROTOCOL_VERSION } from './limits'

export const DENIED = 'erişim yok'
const KINDS = ['human', 'agent', 'query', 'answer', 'system'] as const
const ROOM_KINDS = ['dm', 'project'] as const

// The query field a type reads its argument from.
export type QueryArg = 'path' | 'text' | 'sha' | 'question'
export type QueryTypeSpec = { arg: QueryArg | null; isArgRequired: boolean; isModelless: boolean }
// Every query type, one entry each. Names are wire values and stay stable; the UI's chips and slash commands read
// this. `arg` is the field the type takes (null: none); grep also takes an optional `path` folder and
// `isCaseInsensitive`. A required argument that is missing is a denial, not an unreadable message.
export const QUERY_TYPES = {
  status: { arg: null, isArgRequired: false, isModelless: true },
  branch: { arg: null, isArgRequired: false, isModelless: true },
  log: { arg: null, isArgRequired: false, isModelless: true },
  diff: { arg: null, isArgRequired: false, isModelless: true },
  tests: { arg: null, isArgRequired: false, isModelless: true },
  plan: { arg: null, isArgRequired: false, isModelless: true },
  file: { arg: 'path', isArgRequired: true, isModelless: true },
  grep: { arg: 'text', isArgRequired: true, isModelless: true },
  files: { arg: 'path', isArgRequired: false, isModelless: true },
  todo: { arg: 'path', isArgRequired: false, isModelless: true },
  deps: { arg: null, isArgRequired: false, isModelless: true },
  commit: { arg: 'sha', isArgRequired: true, isModelless: true },
  ask: { arg: 'question', isArgRequired: true, isModelless: false },
} as const satisfies Record<string, QueryTypeSpec>
export type QueryType = keyof typeof QUERY_TYPES
export const QUERY_TYPE_NAMES = Object.keys(QUERY_TYPES) as QueryType[]

export type Kind = (typeof KINDS)[number]
export type Query = {
  type: QueryType; repo: string; path?: string; question?: string; text?: string; sha?: string; isCaseInsensitive?: boolean
}
// A long answer is split into `parts` messages sharing one qid, `part` counting from 1; a single one has neither.
export type Answer = { qid: string; ok: boolean; body: string; tokens: number; part?: number; parts?: number }
export type Message = {
  v: 1; id: string; ts: number; kind: Kind; text: string; replyTo?: string; query?: Query; answer?: Answer
}
export type Unreadable = { id: string; isUnreadable: true; reason: string }
export type Head = {
  v: 1; head: string; headTs: number; seenUpTo: string; readUpTo: string; readTs: number; gh?: string; label?: string
}
// `room` ties the mailboxes of one room together: every member's mailbox for it carries the same id.
export type RoomMeta = { v: 1; kind: (typeof ROOM_KINDS)[number]; repo?: string; room: string; createdAt: number }

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

const SHA = /^[0-9a-f]{7,40}$/
// Control characters, except a tab: a search text is one line.
const SEARCH_BAD_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/
export const isSha = (x: unknown): x is string => typeof x === 'string' && SHA.test(x)
// A literal search text: 2–200 characters, one line, not only spaces.
export function isSearchText(x: unknown): x is string {
  if (typeof x !== 'string' || SEARCH_BAD_CHARS.test(x) || x.trim() === '') return false
  const chars = [...x].length
  return chars >= GREP_MIN_CHARS && chars <= GREP_MAX_CHARS
}
export const isQueryType = (x: unknown): x is QueryType => typeof x === 'string' && Object.hasOwn(QUERY_TYPES, x)

// Each field, when present, must have its shape; fields are kept whatever the type, and the handler reads its own.
function hasQueryFields(x: Obj): boolean {
  if (x.path !== undefined && !isText(x.path, MAX_PATH_BYTES)) return false
  if (x.question !== undefined && !isText(x.question)) return false
  if (x.text !== undefined && !isSearchText(x.text)) return false
  if (x.sha !== undefined && !isSha(x.sha)) return false
  return x.isCaseInsensitive === undefined || typeof x.isCaseInsensitive === 'boolean'
}

function parseQuery(x: unknown): Query | null {
  if (!isObj(x) || !isQueryType(x.type) || !isRepo(x.repo) || !hasQueryFields(x)) return null
  return {
    type: x.type, repo: x.repo, path: x.path as string | undefined, question: x.question as string | undefined,
    text: x.text as string | undefined, sha: x.sha as string | undefined, isCaseInsensitive: x.isCaseInsensitive as boolean | undefined,
  }
}

const isPartNo = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= MAX_ANSWER_PARTS

function parseParts(x: Obj): { part: number; parts: number } | {} | null {
  if (x.part === undefined && x.parts === undefined) return {}
  if (!isPartNo(x.part) || !isPartNo(x.parts) || x.part > x.parts) return null
  return { part: x.part, parts: x.parts }
}

function parseAnswer(x: unknown): Answer | null {
  if (!isObj(x) || !isId(x.qid) || typeof x.ok !== 'boolean' || !isText(x.body) || !isCount(x.tokens)) return null
  const parts = parseParts(x)
  return parts === null ? null : { qid: x.qid, ok: x.ok, body: x.body, tokens: x.tokens, ...parts }
}

const unreadable = (id: string, reason: string): Unreadable => ({ id, isUnreadable: true, reason })

// The author of a doc is the mailbox and outbox it sits in, never a field. The mod never writes one of these, so a
// doc that carries one claims an author it cannot prove and is ignored.
const AUTHOR_FIELDS = ['author', 'from', 'sender', 'uid'] as const
const claimsAuthor = (x: Obj) => AUTHOR_FIELDS.some(k => Object.hasOwn(x, k))

export function parseMessage(id: string, raw: unknown): Message | Unreadable {
  if (!isObj(raw)) return unreadable(id, 'not an object')
  if (raw.v !== PROTOCOL_VERSION) return unreadable(id, 'unknown version')
  if (raw.id !== id || !isId(id)) return unreadable(id, 'id mismatch')
  if (claimsAuthor(raw)) return unreadable(id, 'claims an author')
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
  if (!isId(raw.room)) return null
  return stripUndefined<RoomMeta>({ v: 1, kind: raw.kind, repo: raw.repo as string | undefined, room: raw.room, createdAt: raw.createdAt })
}

// A compacted day (T15): `ts` is its newest message's, so readers can ask for the days after a cursor. Messages
// that do not parse are dropped; the author is the outbox the doc sits in, never a field.
export type Day = { v: 1; ts: number; msgs: Message[] }

export function parseDay(raw: unknown): Day | null {
  if (!isObj(raw) || raw.v !== PROTOCOL_VERSION || !isCount(raw.ts) || !Array.isArray(raw.msgs) || claimsAuthor(raw)) return null
  const msgs = raw.msgs.flatMap(m => {
    const parsed = parseMessage(isObj(m) && typeof m.id === 'string' ? m.id : '', m)
    return isUnreadable(parsed) ? [] : [parsed]
  })
  return { v: 1, ts: raw.ts, msgs }
}

export const emptyHead = (): Head => ({ v: 1, head: '', headTs: 0, seenUpTo: '', readUpTo: '', readTs: 0 })
