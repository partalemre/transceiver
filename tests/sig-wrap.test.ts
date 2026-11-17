// Message words in a drawing: the writer's line breaks stay, a path or link wider than the line breaks instead of
// being cut, and a very long message ends with "…".
import { expect, test } from 'claude-code/testing'

import { wrapLines } from '../hooks/sig-wrap'

// One px a character keeps the arithmetic plain.
const measure = (text: string): number => [...text].length

test('words fill a line, and the writer\'s own breaks stay', () => {
  expect(wrapLines('one two three four', { max: 9, measure })).toEqual(['one two', 'three', 'four'])
  expect(wrapLines('first\nsecond line', { max: 20, measure })).toEqual(['first', 'second line'])
})

test('a word wider than the line breaks where it must, nothing is lost', () => {
  const lines = wrapLines('see src/features/checkout/stripe.ts', { max: 10, measure })
  expect(lines.join('')).toBe('seesrc/features/checkout/stripe.ts')
  expect(lines.every(line => measure(line) <= 10)).toBe(true)
})

test('past the cap the last line ends in an ellipsis', () => {
  const lines = wrapLines(Array.from({ length: 50 }, (_, i) => `w${i}`).join('\n'), { max: 10, measure, maxLines: 3 })
  expect(lines).toHaveLength(3)
  expect(lines[2]?.endsWith('…')).toBe(true)
})
