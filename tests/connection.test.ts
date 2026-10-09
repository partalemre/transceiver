import { expect, test } from 'claude-code/testing'
import { isConnected, persistConnection, restoreConnection, setConnected } from '../hooks/connection'

test('every change of the flag is handed to the session state, which a hot reload leaves alone', () => {
  const saved: boolean[] = []
  persistConnection(is => { saved.push(is) })
  setConnected(true)
  setConnected(false)
  expect(saved).toEqual([true, false])
  persistConnection(() => undefined)
})

test('after a reload the saved flag comes back; nothing saved, false or a failed read leaves it off', async () => {
  persistConnection(() => undefined)
  setConnected(false)
  for (const read of [async () => ({}), async () => ({ value: false }), async () => { throw new Error('gone') }]) {
    await restoreConnection(read)
    expect(isConnected()).toBe(false)
  }
  await restoreConnection(async () => ({ value: true }))
  expect(isConnected()).toBe(true)
  setConnected(false)
})
