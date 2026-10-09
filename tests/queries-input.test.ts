import { expect, test } from 'claude-code/testing'
import { isUnreadable, parseMessage } from '../hooks/protocol'
import { queryFromInput, queryText, SECRET_IN_QUERY } from '../hooks/queries-input'

const REPO = 'partalemre/eliti'
const ID = '01K7A0000000000000000000AB'
const build = (input: Record<string, unknown>) => queryFromInput(input, REPO)

test('each new type takes its own field; the result always parses as a query message', () => {
  const cases = [
    [{ type: 'grep', text: 'needle' }, { type: 'grep', repo: REPO, text: 'needle' }],
    [{ type: 'grep', text: '-e x', path: 'lib', isCaseInsensitive: true }, { type: 'grep', repo: REPO, text: '-e x', path: 'lib', isCaseInsensitive: true }],
    [{ type: 'files' }, { type: 'files', repo: REPO }],
    [{ type: 'files', path: 'src' }, { type: 'files', repo: REPO, path: 'src' }],
    [{ type: 'todo', path: 'lib', text: 'ignored' }, { type: 'todo', repo: REPO, path: 'lib' }],
    [{ type: 'deps', path: 'x' }, { type: 'deps', repo: REPO }],
    [{ type: 'commit', sha: ' ABCDEF1 ' }, { type: 'commit', repo: REPO, sha: 'abcdef1' }],
    [{ type: 'ask', question: '  neden?  ' }, { type: 'ask', repo: REPO, question: 'neden?' }],
  ] as const
  for (const [input, want] of cases) {
    const query = build(input)
    expect(query).toEqual(want)
    if (typeof query === 'string') continue
    const m = parseMessage(ID, { v: 1, id: ID, ts: 1, kind: 'query', text: queryText(query), query })
    expect(isUnreadable(m)).toBe(false)
  }
})

test('a missing or malformed argument is a reason, never a query', () => {
  const bad = [
    { type: 'shell' }, { type: 'toString' }, { type: 'grep' }, { type: 'grep', text: 'a' }, { type: 'grep', text: 'a\nb' },
    { type: 'grep', text: 'ab', path: 'x'.repeat(1_001) }, { type: 'commit' }, { type: 'commit', sha: 'HEAD~1' },
    { type: 'commit', sha: '--all' }, { type: 'file' }, { type: 'file', path: 'x'.repeat(1_001) }, { type: 'ask' },
    { type: 'ask', question: 'q'.repeat(2_001) },
  ]
  for (const input of bad) expect(typeof build(input)).toBe('string')
  expect(build({ type: 'commit' })).toBe('commit için sha gerekli.')
  expect((build({ type: 'rm' }) as string).startsWith('type şunlardan biri olmalı: status, branch')).toBe(true)
})

test('a secret in any argument is never sent', () => {
  for (const input of [{ type: 'grep', text: 'AKIAIOSFODNN7EXAMPLE' }, { type: 'file', path: 'ghp_' + 'a'.repeat(36) }, { type: 'ask', question: 'key = "AKIAIOSFODNN7EXAMPLE"' }]) {
    expect(build(input)).toBe(SECRET_IN_QUERY)
  }
})

test('a query shows as its argument, else its type', () => {
  expect(queryText({ type: 'grep', repo: REPO, text: 'needle', path: 'lib' })).toBe('needle')
  expect(queryText({ type: 'commit', repo: REPO, sha: 'abcdef1' })).toBe('abcdef1')
  expect(queryText({ type: 'deps', repo: REPO })).toBe('deps')
})
