import { ASK_MAX_QUESTION_CHARS, GREP_MAX_CHARS, GREP_MIN_CHARS, MAX_PATH_BYTES } from './limits'
import { isQueryType, isSearchText, isSha, QUERY_TYPE_NAMES, QUERY_TYPES, utf8Bytes } from './protocol'
import type { Query, QueryArg, QueryType } from './protocol'
import { hasSecret } from './scan'

// What an agent's `ask` tool input becomes: a query the protocol accepts, or the reason it is not sent (Turkish,
// for the agent to fix its call). Nothing that leaves is unchecked: every argument is scanned for secrets.
export const SECRET_IN_QUERY = 'Sorgu gönderilmedi: gizli anahtar içeriyor.'

const ARG_ERROR: Record<QueryArg, string> = {
  path: `path en fazla ${MAX_PATH_BYTES} bayt olmalı.`,
  text: `text ${GREP_MIN_CHARS}–${GREP_MAX_CHARS} karakterlik, tek satırlık bir metin olmalı.`,
  sha: 'sha 7–40 karakterlik onaltılık bir commit kimliği olmalı.',
  question: `question en fazla ${ASK_MAX_QUESTION_CHARS} karakter olmalı.`,
}

const given = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() !== '' ? x : undefined)

function isArgOk(arg: QueryArg, value: string): boolean {
  if (arg === 'path') return utf8Bytes(value) <= MAX_PATH_BYTES
  if (arg === 'text') return isSearchText(value)
  if (arg === 'sha') return isSha(value)
  return value.length <= ASK_MAX_QUESTION_CHARS
}

// A question is trimmed and a sha lower-cased; a path or a search text is taken as written.
function normalised(arg: QueryArg, raw: string): string {
  if (arg === 'question') return raw.trim()
  return arg === 'sha' ? raw.trim().toLowerCase() : raw
}

// The type's own argument, then grep's optional folder and case switch.
function argsOf(type: QueryType, input: Record<string, unknown>): Partial<Query> | string {
  const { arg, isArgRequired } = QUERY_TYPES[type]
  const out: Partial<Query> = {}
  const raw = arg === null ? undefined : given(input[arg])
  if (arg !== null && raw === undefined && isArgRequired) return `${type} için ${arg} gerekli.`
  if (arg !== null && raw !== undefined) {
    const value = normalised(arg, raw)
    if (!isArgOk(arg, value)) return ARG_ERROR[arg]
    out[arg] = value
  }
  if (type !== 'grep') return out
  const path = given(input.path)
  if (path !== undefined && !isArgOk('path', path)) return ARG_ERROR.path
  return { ...out, ...(path === undefined ? {} : { path }), ...(input.isCaseInsensitive === true ? { isCaseInsensitive: true } : {}) }
}

export function queryFromInput(input: Record<string, unknown>, repo: string): Query | string {
  if (!isQueryType(input.type)) return `type şunlardan biri olmalı: ${QUERY_TYPE_NAMES.join(', ')}`
  const args = argsOf(input.type, input)
  if (typeof args === 'string') return args
  const texts = [args.path, args.text, args.sha, args.question].filter(t => t !== undefined)
  if (hasSecret(texts.join('\n'))) return SECRET_IN_QUERY
  return { ...args, type: input.type, repo }
}

// The message text a query shows as: its argument, else its type.
export const queryText = (q: Query): string => q.question ?? q.text ?? q.sha ?? q.path ?? q.type
