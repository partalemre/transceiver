import { expect, test } from 'claude-code/testing'
import { DENIED, isUnreadable, parseHead, parseMessage, parseMeta, paths, utf8Bytes } from '../hooks/protocol'

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
