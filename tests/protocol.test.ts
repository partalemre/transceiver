import { expect, test } from 'claude-code/testing'
import { DENIED, isRepo, isUnreadable, parseHead, parseMessage, parseMeta, paths, utf8Bytes } from '../hooks/protocol'
import { isSearchText, isSha, QUERY_TYPE_NAMES, QUERY_TYPES } from '../hooks/protocol'
import { QUERY_CATALOG } from '../hooks/query-catalog'

const ID = '01K7A0000000000000000000AB'
const ok = { v: 1, id: ID, ts: 5, kind: 'human', text: 'merhaba' }

test('a valid human message parses', () => {
  expect(parseMessage(ID, ok)).toEqual(ok)
})

test('an id that differs from the doc id is unreadable, so nobody can overwrite another message', () => {
  expect(isUnreadable(parseMessage('01K7A0000000000000000000ZZ', ok))).toBe(true)
})

test('unknown version, kind or oversized text is unreadable, not dropped', () => {
  expect(isUnreadable(parseMessage(ID, { ...ok, v: 2 }))).toBe(true)
  expect(isUnreadable(parseMessage(ID, { ...ok, kind: 'shell' }))).toBe(true)
  expect(isUnreadable(parseMessage(ID, { ...ok, text: 'ş'.repeat(9000) }))).toBe(true)
})

test('a query needs a known type and an owner/repo', () => {
  const q = { ...ok, kind: 'query', query: { type: 'file', repo: 'partalemre/eliti', path: 'lib/a.dart' } }
  expect(isUnreadable(parseMessage(ID, q))).toBe(false)
  expect(isUnreadable(parseMessage(ID, { ...q, query: { type: 'rm', repo: 'partalemre/eliti' } }))).toBe(true)
  expect(isUnreadable(parseMessage(ID, { ...q, query: { type: 'file', repo: '../x' } }))).toBe(true)
})

test('an answer carries qid, ok, body and tokens', () => {
  const a = { ...ok, kind: 'answer', answer: { qid: ID, ok: false, body: DENIED, tokens: 0 } }
  expect(parseMessage(ID, a)).toEqual(a)
})

test('a split answer numbers its parts; a part out of range or alone is unreadable', () => {
  const part = (answer: Record<string, unknown>) => ({ ...ok, kind: 'answer', answer: { qid: ID, ok: true, body: 'x', tokens: 0, ...answer } })
  expect(parseMessage(ID, part({ part: 2, parts: 3 }))).toEqual(part({ part: 2, parts: 3 }))
  for (const bad of [{ part: 0, parts: 3 }, { part: 4, parts: 3 }, { part: 1 }, { parts: 2 }, { part: 1.5, parts: 2 }, { part: 1, parts: 99 }]) {
    expect(isUnreadable(parseMessage(ID, part(bad)))).toBe(true)
  }
})

test('heads and meta reject junk', () => {
  expect(parseHead({ v: 1, head: '', headTs: 0, seenUpTo: '', readUpTo: '', readTs: 0 })).not.toBe(null)
  expect(parseHead({ v: 1, head: 3 })).toBe(null)
  expect(parseMeta({ v: 1, kind: 'project', repo: 'a/b', room: '01K7A0000000000000000000R1', createdAt: 1 })).not.toBe(null)
  expect(parseMeta({ v: 1, kind: 'project', repo: 'a/b', createdAt: 1 })).toBe(null)
  expect(parseMeta({ v: 1, kind: 'project', repo: 'a/b', room: 'x', createdAt: 1 })).toBe(null)
  expect(parseMeta({ v: 1, kind: 'group', createdAt: 1 })).toBe(null)
})

test('utf8 byte count matches multi-byte text', () => {
  expect(utf8Bytes('aş€😀')).toBe(1 + 2 + 3 + 4)
})

test('paths keep each author in its own subtree', () => {
  expect(paths.msgs('u_x')).toBe('outbox/u_x/msgs')
  expect(paths.claims('u_x')).toBe('outbox/u_x/claims')
})

test('a dm meta may omit repo but a present repo must be valid', () => {
  expect(parseMeta({ v: 1, kind: 'dm', room: '01K7A0000000000000000000R1', createdAt: 1 })).not.toBe(null)
  expect(parseMeta({ v: 1, kind: 'dm', repo: { x: 1 }, room: '01K7A0000000000000000000R1', createdAt: 1 })).toBe(null)
  expect(parseMeta({ v: 1, kind: 'dm', repo: null, room: '01K7A0000000000000000000R1', createdAt: 1 })).toBe(null)
  expect(parseMeta({ v: 1, kind: 'dm', repo: '../x', room: '01K7A0000000000000000000R1', createdAt: 1 })).toBe(null)
})

test('head pointers are empty or a valid id', () => {
  const head = { v: 1, head: '', headTs: 0, seenUpTo: '', readUpTo: '', readTs: 0 }
  expect(parseHead({ ...head, head: 'x'.repeat(5000) })).toBe(null)
  expect(parseHead({ ...head, seenUpTo: 'nope' })).toBe(null)
  expect(parseHead({ ...head, readUpTo: 'nope' })).toBe(null)
  expect(parseHead({ ...head, head: ID, seenUpTo: ID, readUpTo: ID })).not.toBe(null)
})

test('text longer than the byte cap in UTF-16 units is unreadable', () => {
  expect(isUnreadable(parseMessage(ID, { ...ok, text: 'a'.repeat(20_000) }))).toBe(true)
})

test('repo segments made only of dots are rejected', () => {
  expect(isRepo('./x')).toBe(false)
  expect(isRepo('a/.')).toBe(false)
  expect(isRepo('a/...')).toBe(false)
  expect(isRepo('partalemre/eliti')).toBe(true)
})

test('the query types keep their wire names, each with the one field it reads', () => {
  expect(QUERY_TYPE_NAMES).toEqual(['status', 'branch', 'log', 'diff', 'tests', 'plan', 'file', 'grep', 'files', 'todo', 'deps', 'commit', 'ask'])
  const args = Object.fromEntries(QUERY_TYPE_NAMES.map(t => [t, QUERY_TYPES[t].arg]))
  expect(args).toEqual({
    status: null, branch: null, log: null, diff: null, tests: null, plan: null, file: 'path', grep: 'text', files: 'path',
    todo: 'path', deps: null, commit: 'sha', ask: 'question',
  })
  expect(QUERY_TYPE_NAMES.filter(t => !QUERY_TYPES[t].isModelless)).toEqual(['ask'])
})

test('the catalog names every type in Turkish, as plain data', () => {
  expect(Object.keys(QUERY_CATALOG).sort()).toEqual([...QUERY_TYPE_NAMES].sort())
  expect(QUERY_CATALOG.grep).toEqual({ label: 'Metin ara', description: 'Repoda bir metni arar' })
  for (const t of QUERY_TYPE_NAMES) {
    const { label, description } = QUERY_CATALOG[t]
    expect(label.length > 0 && label.length <= 20 && description.length > 0 && description.length <= 80).toBe(true)
    expect(`${label}${description}`.includes('$')).toBe(false)
  }
})

test('grep, files, todo, deps and commit queries parse with their fields; a bad field is unreadable', () => {
  const query = (q: Record<string, unknown>) => parseMessage(ID, { ...ok, kind: 'query', query: { repo: 'partalemre/eliti', ...q } })
  const good = [
    { type: 'grep', text: 'needle', path: 'lib', isCaseInsensitive: true }, { type: 'files' }, { type: 'files', path: 'src' },
    { type: 'todo' }, { type: 'deps' }, { type: 'commit', sha: 'abcdef1' }, { type: 'commit', sha: 'a'.repeat(40) },
  ]
  for (const q of good) expect(query(q)).toEqual({ ...ok, kind: 'query', query: { repo: 'partalemre/eliti', ...q } })
  const bad = [
    { type: 'grep', text: 'a' }, { type: 'grep', text: 'a\nb' }, { type: 'grep', text: 7 }, { type: 'grep', text: 'ab', isCaseInsensitive: 'yes' },
    { type: 'commit', sha: '--output=x' }, { type: 'commit', sha: 'HEAD' }, { type: 'commit', sha: 'ABCDEF1' }, { type: 'commit', sha: 'abc' },
    { type: 'files', path: 'x'.repeat(1_001) }, { type: 'constructor' }, { type: 'toString' }, { type: '__proto__' },
  ]
  for (const q of bad) expect(isUnreadable(query(q))).toBe(true)
})

test('a search text is one line of 2–200 characters; a sha is 7–40 lower-case hex', () => {
  expect(isSearchText('ab')).toBe(true)
  expect(isSearchText('-e')).toBe(true)
  expect(isSearchText('\tx')).toBe(true)
  expect(isSearchText('😀'.repeat(200))).toBe(true)
  for (const x of ['a', '😀'.repeat(201), 'a\u0000b', 'a\rb', '  ', null]) expect(isSearchText(x)).toBe(false)
  expect(isSha('0123456789abcdef0123456789abcdef01234567')).toBe(true)
  for (const x of ['012345', 'g123456', '-123456', '1234567\n', `${'a'.repeat(41)}`]) expect(isSha(x)).toBe(false)
})
