// Until the session is connected the loop only reads (spike R1); once it is, what was pulled meanwhile is acked.
import { expect, test } from 'claude-code/testing'

import { emptyHead } from '../hooks/protocol'
import { relayOf } from '../hooks/relay'
import { enqueue, initialSync, tick } from '../hooks/sync'
import { callerFor, fakeDb, writesOf } from './fake-db'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const URL = 'https://claude.ai/artifact/R1'
const A = '01K7A0000000000000000000A1'
const B = '01K7A0000000000000000000A2'

function room() {
  const db = fakeDb(ME)
  db.docs.set(`outbox/${PEER}`, { data: { ...emptyHead(), head: A, headTs: 10 }, version: 1 })
  db.docs.set(`outbox/${PEER}/msgs/${A}`, { data: { v: 1, id: A, ts: 10, kind: 'human', text: 'selam' }, version: 1 })
  return { db, relay: relayOf(callerFor(db), URL) }
}

test('not connected: the tick pulls, but neither sends nor marks read', async () => {
  const { db, relay } = room()
  const state = enqueue(initialSync(ME), { v: 1, id: B, ts: 20, kind: 'human', text: 'naber' })
  const out = await tick({ relay, state, isViewing: true, isReceiptsOn: true, canWrite: false })
  expect(out.fresh.map(e => e.message.id)).toEqual([A])
  expect(writesOf(db)).toEqual([])
  expect(out.state.pending.map(m => m.id)).toEqual([B])
  expect(out.isDenied).toBe(false)
})

test('connected later: the queued message goes out and what was pulled meanwhile is marked seen and read', async () => {
  const { db, relay } = room()
  const state = enqueue(initialSync(ME), { v: 1, id: B, ts: 20, kind: 'human', text: 'naber' })
  const quiet = await tick({ relay, state, isViewing: false, isReceiptsOn: true, canWrite: false })
  const out = await tick({ relay, state: quiet.state, isViewing: true, isReceiptsOn: true, canWrite: true })
  expect(out.fresh).toEqual([])
  expect(db.docs.has(`outbox/${ME}/msgs/${B}`)).toBe(true)
  const head = db.docs.get(`outbox/${ME}`)?.data as { seenUpTo: string; readUpTo: string }
  expect([head.seenUpTo, head.readUpTo]).toEqual([A, A])
})
