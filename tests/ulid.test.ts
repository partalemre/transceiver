import { expect, test } from 'claude-code/testing'
import { idTime, newId } from '../hooks/ulid'

test('ids are 26 Crockford characters and sort by time', () => {
  const a = newId(1_791_545_100_000, () => 0.99)
  const b = newId(1_791_545_100_001, () => 0)
  expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  expect(a < b).toBe(true)
})

test('the time part round-trips', () => {
  expect(idTime(newId(1_791_545_100_123))).toBe(1_791_545_100_123)
})
