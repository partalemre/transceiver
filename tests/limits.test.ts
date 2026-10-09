import { expect, test } from 'claude-code/testing'
import * as L from '../hooks/limits'

test('poll intervals grow from open to closed to the cap', () => {
  expect(L.POLL_OPEN_MS < L.POLL_CLOSED_MS && L.POLL_CLOSED_MS < L.POLL_MAX_MS).toBe(true)
})

test('the ask wait fits inside the query lifetime', () => {
  expect(L.ASK_WAIT_MS < L.QUERY_TTL_MS).toBe(true)
})
