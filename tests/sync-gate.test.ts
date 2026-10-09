// Until the session is connected the loop only reads (spike R1); once it is, what was pulled meanwhile is acked.
import { expect, test } from 'claude-code/testing'

import { emptyHead } from '../hooks/protocol'
import { relayOf } from '../hooks/relay'
import { enqueue, initialSync, tick } from '../hooks/sync'
import { callerAs, callerFor, fakeDb, writesOf } from './fake-db'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const URL = 'https://claude.ai/artifact/R1'
const PEER_URL = 'https://claude.ai/artifact/R2'
const A = '01K7A0000000000000000000A1'
const B = '01K7A0000000000000000000A2'

function room() {
  const db = fakeDb(ME)
  const peer = fakeDb(PEER)
  peer.docs.set(`outbox/${PEER}`, { data: { ...emptyHead(), head: A, headTs: 10 }, version: 1 })
  peer.docs.set(`outbox/${PEER}/msgs/${A}`, { data: { v: 1, id: A, ts: 10, kind: 'human', text: 'selam' }, version: 1 })
  return { db, peer, relay: relayOf(callerFor(db), URL), boxes: [relayOf(callerAs(peer, ME), PEER_URL)] }
}

test('not connected: the tick pulls, but neither sends nor marks read', async () => {
  const { db, peer, relay, boxes } = room()
  const state = enqueue(initialSync(ME), { v: 1, id: B, ts: 20, kind: 'human', text: 'naber' })
  const out = await tick({ relay, boxes, state, isViewing: true, isReceiptsOn: true, canWrite: false })
  expect(out.fresh.map(e => e.message.id)).toEqual([A])
  expect([...writesOf(db), ...writesOf(peer)]).toEqual([])
  expect(out.state.pending.map(m => m.id)).toEqual([B])
  expect(out.isDenied).toBe(false)
})

test('connected later: the queued message goes out and what was pulled meanwhile is marked seen and read', async () => {
  const { db, relay, boxes } = room()
  const state = enqueue(initialSync(ME), { v: 1, id: B, ts: 20, kind: 'human', text: 'naber' })
  const quiet = await tick({ relay, boxes, state, isViewing: false, isReceiptsOn: true, canWrite: false })
  const out = await tick({ relay, boxes, state: quiet.state, isViewing: true, isReceiptsOn: true, canWrite: true })
  expect(out.fresh).toEqual([])
  expect(db.docs.has(`outbox/${ME}/msgs/${B}`)).toBe(true)
  const head = db.docs.get(`outbox/${ME}`)?.data as { seenUpTo: string; readUpTo: string }
  expect([head.seenUpTo, head.readUpTo]).toEqual([A, A])
})
