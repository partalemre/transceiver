// What a person can ask the other side's agent from the composer: every query type `QUERY_TYPES` (protocol.ts)
// holds, in the V2-Ask board's order, with its one-line description, an icon and, when it takes an argument,
// the field's placeholder; and the slash commands that send the same. Pure.
import type { IconName } from './kit/icons'
import { isUnreadable, parseMessage, QUERY_TYPES, type Message, type QueryType } from './protocol'

export type QuerySpec = { type: QueryType; desc: string; icon: IconName; arg?: { field: string; placeholder: string; isOptional: boolean } }
type Words = { desc: string; icon: IconName; placeholder?: string }

// The board's words, keyed by type so a new protocol type does not compile without them.
const WORDS: Record<QueryType, Words> = {
  status: { desc: 'Değişenler, ileride/geride', icon: 'gauge' },
  branch: { desc: 'Şu anki branch ve takip', icon: 'branch' },
  diff: { desc: 'Commit edilmemiş değişiklik', icon: 'pencil' },
  log: { desc: 'Son 20 commit', icon: 'list' },
  tests: { desc: 'Son test sonucu', icon: 'check' },
  plan: { desc: 'Çalıştığı plan ve adım', icon: 'flag' },
  todo: { desc: 'TODO ve FIXME\'ler', icon: 'bookmark', placeholder: 'Klasör (boş bırakırsan bütün repo)' },
  deps: { desc: 'Bağımlılıklar', icon: 'cube' },
  grep: { desc: 'Repoda metin ara', icon: 'eye', placeholder: 'Aranacak metin' },
  file: { desc: 'Bir dosyayı oku', icon: 'file', placeholder: 'Dosya yolu, örn. src/app.ts' },
  files: { desc: 'Klasördeki dosyalar', icon: 'folder', placeholder: 'Klasör (boş bırakırsan kök)' },
  commit: { desc: 'Tek commit\'in özeti', icon: 'bolt', placeholder: 'Commit sha' },
  ask: { desc: 'Serbest soru · Haiku · token harcar', icon: 'sparkle', placeholder: 'Agent\'a sorun' },
}
const ORDER: readonly QueryType[] = ['status', 'branch', 'diff', 'log', 'tests', 'plan', 'todo', 'deps', 'grep', 'file', 'files', 'commit', 'ask']

// An optional folder (todo's) is not offered as a mode: the sheet sends it at once, `/todo <klasör>` narrows it.
const asksForArg = (type: QueryType): boolean => QUERY_TYPES[type].arg !== null && (QUERY_TYPES[type].isArgRequired || type === 'files')

export function supportedSpecs(): QuerySpec[] {
  return ORDER.filter(t => Object.hasOwn(QUERY_TYPES, t)).map(type => {
    const t = QUERY_TYPES[type]
    const words = WORDS[type]
    const arg = t.arg === null ? undefined : { field: t.arg, placeholder: words.placeholder ?? '', isOptional: !t.isArgRequired }
    return { type, desc: words.desc, icon: words.icon, ...(arg === undefined ? {} : { arg }) }
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
  return spec.arg.isOptional ? ' [değer]' : ' <değer>'
}

const usage = (spec: QuerySpec) => `/${spec.type}${argHint(spec)}`

// `/diff`, `/file src/a.ts`, `/ask neden?`: a query; another slash word: a hint, never sent; else plain text.
export function composeOf(text: string): Composed {
  const trimmed = text.trim()
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(trimmed)
  if (match === null) return { kind: 'text', text: trimmed }
  const spec = specOf((match[1] ?? '').toLowerCase())
  const arg = (match[2] ?? '').trim()
  if (spec === undefined) return { kind: 'hint', text: `Bilinmeyen komut. Şunlar var: ${supportedSpecs().map(s => `/${s.type}`).join(' ')}` }
  if (spec.arg === undefined) return arg === '' ? { kind: 'query', type: spec.type } : { kind: 'hint', text: `${usage(spec)} değer almaz.` }
  if (arg === '' && !spec.arg.isOptional) return { kind: 'hint', text: `Kullanım: ${usage(spec)} (${spec.arg.placeholder})` }
  return { kind: 'query', type: spec.type, ...(arg === '' ? {} : { arg }) }
}
