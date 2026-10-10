// What a person can ask the other side's agent from the composer: every query type `QUERY_TYPES` (protocol.ts)
// holds, in the V2-Ask board's order, with its one-line description, an icon and, when it takes an argument,
// the field's placeholder; and the slash commands that send the same. Pure.
import type { IconName } from './kit/icons'
import { pick } from './kit/lang'
import { isUnreadable, parseMessage, QUERY_TYPES, type Message, type QueryType } from './protocol'

export type QuerySpec = { type: QueryType; desc: string; icon: IconName; arg?: { field: string; placeholder: string; isOptional: boolean } }
type Words = { desc: string; placeholder?: string }

const ICONS: Record<QueryType, IconName> = {
  status: 'gauge', branch: 'branch', diff: 'pencil', log: 'list', tests: 'check', plan: 'flag', todo: 'bookmark',
  deps: 'cube', grep: 'eye', file: 'file', files: 'folder', commit: 'bolt', ask: 'sparkle',
}

// The board's words, keyed by type so a new protocol type does not compile without them.
const EN: Record<QueryType, Words> = {
  status: { desc: 'Changes, ahead and behind' },
  branch: { desc: 'Current branch and upstream' },
  diff: { desc: 'Uncommitted changes' },
  log: { desc: 'Last 20 commits' },
  tests: { desc: 'Last test result' },
  plan: { desc: 'The plan and step they are on' },
  todo: { desc: 'TODOs and FIXMEs', placeholder: 'Folder (leave empty for the whole repo)' },
  deps: { desc: 'Dependencies' },
  grep: { desc: 'Search text in the repo', placeholder: 'Text to find' },
  file: { desc: 'Read one file', placeholder: 'File path, e.g. src/app.ts' },
  files: { desc: 'Files in a folder', placeholder: 'Folder (leave empty for the root)' },
  commit: { desc: 'Summary of one commit', placeholder: 'Commit sha' },
  ask: { desc: 'Free question · Haiku · spends tokens', placeholder: 'Ask the agent' },
}
const TR: Record<QueryType, Words> = {
  status: { desc: 'Değişenler, ileride/geride' },
  branch: { desc: 'Şu anki branch ve takip' },
  diff: { desc: 'Commit edilmemiş değişiklik' },
  log: { desc: 'Son 20 commit' },
  tests: { desc: 'Son test sonucu' },
  plan: { desc: 'Çalıştığı plan ve adım' },
  todo: { desc: 'TODO ve FIXME\'ler', placeholder: 'Klasör (boş bırakırsan bütün repo)' },
  deps: { desc: 'Bağımlılıklar' },
  grep: { desc: 'Repoda metin ara', placeholder: 'Aranacak metin' },
  file: { desc: 'Bir dosyayı oku', placeholder: 'Dosya yolu, örn. src/app.ts' },
  files: { desc: 'Klasördeki dosyalar', placeholder: 'Klasör (boş bırakırsan kök)' },
  commit: { desc: 'Tek commit\'in özeti', placeholder: 'Commit sha' },
  ask: { desc: 'Serbest soru · Haiku · token harcar', placeholder: 'Agent\'a sorun' },
}
const HINTS = {
  en: {
    value: { optional: ' [value]', required: ' <value>' },
    unknown: (all: string) => `Unknown command. Available: ${all}`,
    noValue: (usage: string) => `${usage} takes no value.`,
    usage: (o: { usage: string; placeholder: string }) => `Usage: ${o.usage} (${o.placeholder})`,
  },
  tr: {
    value: { optional: ' [değer]', required: ' <değer>' },
    unknown: (all: string) => `Bilinmeyen komut. Şunlar var: ${all}`,
    noValue: (usage: string) => `${usage} değer almaz.`,
    usage: (o: { usage: string; placeholder: string }) => `Kullanım: ${o.usage} (${o.placeholder})`,
  },
}
const ORDER: readonly QueryType[] = ['status', 'branch', 'diff', 'log', 'tests', 'plan', 'todo', 'deps', 'grep', 'file', 'files', 'commit', 'ask']

// An optional folder (todo's) is not offered as a mode: the sheet sends it at once, `/todo <klasör>` narrows it.
const asksForArg = (type: QueryType): boolean => QUERY_TYPES[type].arg !== null && (QUERY_TYPES[type].isArgRequired || type === 'files')

export function supportedSpecs(): QuerySpec[] {
  return ORDER.filter(t => Object.hasOwn(QUERY_TYPES, t)).map(type => {
    const t = QUERY_TYPES[type]
    const words = pick({ en: EN, tr: TR })[type]
    const arg = t.arg === null ? undefined : { field: t.arg, placeholder: words.placeholder ?? '', isOptional: !t.isArgRequired }
    return { type, desc: words.desc, icon: ICONS[type], ...(arg === undefined ? {} : { arg }) }
  })
}

export const specOf = (type: string): QuerySpec | undefined => supportedSpecs().find(s => s.type === type)
export const isModeType = (type: string): boolean => Object.hasOwn(QUERY_TYPES, type) && asksForArg(type as QueryType)

// The query a type builds, run through the protocol's own guard: an unknown type, a missing required argument
// or one of the wrong shape (a sha that is not one, a one-letter search) is refused before it is sent.
export function queryMessage(o: { id: string; ts: number; repo: string; type: string; arg?: string }): Message | null {
  const spec = specOf(o.type)
  const arg = o.arg?.trim() ?? ''
  if (spec === undefined || (spec.arg !== undefined && !spec.arg.isOptional && arg === '')) return null
  if (spec.arg === undefined && arg !== '') return null
  const value = spec.type === 'commit' ? arg.toLowerCase() : arg
  const query = { type: spec.type, repo: o.repo, ...(spec.arg !== undefined && value !== '' ? { [spec.arg.field]: value } : {}) }
  const message = parseMessage(o.id, { v: 1, id: o.id, ts: o.ts, kind: 'query', text: value === '' ? spec.type : value, query })
  return isUnreadable(message) ? null : message
}

export type Composed = { kind: 'text'; text: string } | { kind: 'query'; type: string; arg?: string } | { kind: 'hint'; text: string }

function argHint(spec: QuerySpec): string {
  if (spec.arg === undefined) return ''
  const value = pick(HINTS).value
  return spec.arg.isOptional ? value.optional : value.required
}

const usage = (spec: QuerySpec) => `/${spec.type}${argHint(spec)}`

// `/diff`, `/file src/a.ts`, `/ask neden?`: a query; another slash word: a hint, never sent; else plain text.
export function composeOf(text: string): Composed {
  const trimmed = text.trim()
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(trimmed)
  if (match === null) return { kind: 'text', text: trimmed }
  const spec = specOf((match[1] ?? '').toLowerCase())
  const arg = (match[2] ?? '').trim()
  const hints = pick(HINTS)
  if (spec === undefined) return { kind: 'hint', text: hints.unknown(supportedSpecs().map(s => `/${s.type}`).join(' ')) }
  if (spec.arg === undefined) return arg === '' ? { kind: 'query', type: spec.type } : { kind: 'hint', text: hints.noValue(usage(spec)) }
  if (arg === '' && !spec.arg.isOptional) return { kind: 'hint', text: hints.usage({ usage: usage(spec), placeholder: spec.arg.placeholder }) }
  return { kind: 'query', type: spec.type, ...(arg === '' ? {} : { arg }) }
}
