import { expect, test } from 'claude-code/testing'
import { localDay, spendAsk, takeBudget } from '../hooks/budget'
import { fakeHost } from './fake-host'

test('ten asks per room per day, then no; a new day resets', () => {
  let counts = { day: '2026-10-09', byRoom: {} as Record<string, number> }
  for (let i = 0; i < 10; i++) {
    const r = takeBudget({ counts, roomId: 'r', day: '2026-10-09' })
    expect(r.isAllowed).toBe(true)
    counts = r.counts
  }
  expect(takeBudget({ counts, roomId: 'r', day: '2026-10-09' }).isAllowed).toBe(false)
  expect(takeBudget({ counts, roomId: 'other', day: '2026-10-09' }).isAllowed).toBe(true)
  expect(takeBudget({ counts, roomId: 'r', day: '2026-10-10' }).isAllowed).toBe(true)
})

test('the day is the local calendar day', () => {
  const noonLocal = new Date(2026, 9, 9, 12, 0, 0).getTime()
  expect(localDay(noonLocal)).toBe('2026-10-09')
  expect(localDay(new Date(2026, 0, 2, 0, 0, 1).getTime())).toBe('2026-01-02')
})

test('the count is kept in the store, survives a reload, and a refusal spends nothing', async () => {
  const host = fakeHost(async () => ({}), new Date(2026, 9, 9, 12).getTime())
  for (let i = 0; i < 10; i++) expect(await spendAsk(host, 'r')).toBe(true)
  expect(await spendAsk(host, 'r')).toBe(false)
  expect(host.store.get('tx.budget')).toEqual({ day: '2026-10-09', byRoom: { r: 10 } })
  host.store.set('tx.budget', 'garbage')
  expect(await spendAsk(host, 'r')).toBe(true)
  await host.advance(24 * 60 * 60 * 1_000)
  host.store.set('tx.budget', { day: '2026-10-09', byRoom: { r: 10 } })
  expect(await spendAsk(host, 'r')).toBe(true)
})
