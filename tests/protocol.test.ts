import { expect, test } from 'claude-code/testing'
import { DENIED, isRepo, isUnreadable, parseHead, parseMessage, parseMeta, paths, utf8Bytes } from '../hooks/protocol'

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
  expect(parseMeta({ v: 1, kind: 'project', repo: 'a/b', createdAt: 1 })).not.toBe(null)
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
  expect(parseMeta({ v: 1, kind: 'dm', createdAt: 1 })).not.toBe(null)
  expect(parseMeta({ v: 1, kind: 'dm', repo: { x: 1 }, createdAt: 1 })).toBe(null)
  expect(parseMeta({ v: 1, kind: 'dm', repo: null, createdAt: 1 })).toBe(null)
  expect(parseMeta({ v: 1, kind: 'dm', repo: '../x', createdAt: 1 })).toBe(null)
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
