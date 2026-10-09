import { expect, test } from 'claude-code/testing'
import { MAX_TEXT_BYTES } from '../hooks/limits'
import { DENIED, isUnreadable, parseMessage, utf8Bytes, type Message } from '../hooks/protocol'
import { answerParts, respond, type Deps } from '../hooks/responder'
import type { Draft } from '../hooks/state-types'

const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const PEER = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const QID = '01K7A0000000000000000000Q1'
const NOW = 2_000_000
const query = (type: string, over: Record<string, unknown> = {}): Message =>
  ({ v: 1, id: QID, ts: NOW - 1_000, kind: 'query', text: '', query: { type, repo: 'partalemre/eliti', question: 'neden?' }, ...over }) as Message
const entry = (message: Message, author = PEER) => ({ roomId: 'r', entry: { author, message } })

type Probe = Deps & { posted: Message[]; drafts: Draft[]; calls: string[] }

function deps(over: Partial<Deps> = {}): Probe {
  const posted: Message[] = []
  const drafts: Draft[] = []
  const calls: string[] = []
  const d: Probe = {
    posted, drafts, calls, selfUid: ME, sessionRepo: 'partalemre/eliti', now: async () => NOW,
    rate: new Map(), seen: new Set(), isConnected: () => true,
    claim: async () => { calls.push('claim'); return true },
    gate: async o => { calls.push(`gate:${o.peerUid}`); return true },
    typed: async () => ({ ok: true, body: 'main · 0 değişen dosya' }),
    ask: async () => { calls.push('ask'); return { text: 'çünkü', tokens: 120 } },
    budget: async () => { calls.push('budget'); return true },
    post: async m => { posted.push(m) },
    addDraft: async draft => { drafts.push(draft) },
    ...over,
  }
  return d
}

test('a typed query is claimed, gated and answered with zero tokens', async () => {
  const d = deps()
  expect(await respond(d, entry(query('status')))).toBe('answered')
  expect(d.calls).toEqual(['claim', `gate:${PEER}`])
  expect(d.posted[0]?.answer).toEqual({ qid: QID, ok: true, body: 'main · 0 değişen dosya', tokens: 0 })
  expect(d.posted[0]?.replyTo).toBe(QID)
})

test('my own queries, stale or far-future queries and lost claims are skipped', async () => {
  expect(await respond(deps(), entry(query('status'), ME))).toBe('skipped')
  expect(await respond(deps(), entry(query('status', { ts: NOW - 600_001 })))).toBe('skipped')
  expect(await respond(deps(), entry(query('status', { ts: NOW + 3_600_000 })))).toBe('skipped')
  const lost = deps({ claim: async () => false })
  expect(await respond(lost, entry(query('status')))).toBe('skipped')
  expect(lost.posted.length).toBe(0)
})

test('a replayed qid is decided once per session, and a claim that throws answers nothing', async () => {
  const d = deps()
  expect(await respond(d, entry(query('status')))).toBe('answered')
  expect(await respond(d, entry(query('status')))).toBe('skipped')
  expect(d.posted.length).toBe(1)
  const broken = deps({ claim: async () => { throw new Error('offline') } })
  expect(await respond(broken, entry(query('status')))).toBe('skipped')
  expect(broken.posted.length).toBe(0)
})

test('a session open on another repo never claims; repo names compare case-insensitively', async () => {
  const other = deps({ sessionRepo: 'partalemre/other' })
  expect(await respond(other, entry(query('status')))).toBe('skipped')
  expect(other.calls).toEqual([])
  const upper = deps({ sessionRepo: 'PartalEmre/Eliti' })
  expect(await respond(upper, entry(query('status')))).toBe('answered')
})

test('before the session is connected nothing is claimed, and the query is answered once it is', async () => {
  let isOn = false
  const d = deps({ isConnected: () => isOn })
  expect(await respond(d, entry(query('status')))).toBe('skipped')
  expect(d.calls).toEqual([])
  isOn = true
  expect(await respond(d, entry(query('status')))).toBe('answered')
})

test('a closed or failing gate sends exactly the denial text, after the claim', async () => {
  for (const gate of [async () => false, async () => { throw new Error('gh down') }]) {
    const d = deps({ gate })
    expect(await respond(d, entry(query('file', { query: { type: 'file', repo: 'partalemre/eliti', path: '.env' } })))).toBe('denied')
    expect(d.posted.length).toBe(1)
    expect(d.posted[0]?.answer).toEqual({ qid: QID, ok: false, body: DENIED, tokens: 0 })
    expect(d.posted[0]?.text).toBe(DENIED)
  }
})

test('the gate is asked about the outbox author, whatever the message claims to be from', async () => {
  const d = deps()
  const spoofed = { ...query('status'), from: ME, author: ME } as unknown as Message
  await respond(d, entry(parseMessage(QID, spoofed) as Message))
  expect(d.calls).toContain(`gate:${PEER}`)
})

test('ask over budget becomes a draft and spends nothing', async () => {
  const d = deps({ budget: async () => false })
  expect(await respond(d, entry(query('ask')))).toBe('drafted')
  expect(d.calls.includes('ask')).toBe(false)
  expect(d.drafts).toEqual([{ roomId: 'r', qid: QID, question: 'neden?', asker: PEER }])
  expect(d.posted.length).toBe(0)
})

test('an ask answer with a secret in it, or a model that gave nothing, is denied', async () => {
  const leaky = deps({ ask: async () => ({ text: 'key = "AKIAIOSFODNN7EXAMPLE"', tokens: 50 }) })
  expect(await respond(leaky, entry(query('ask')))).toBe('denied')
  expect(leaky.posted[0]?.answer?.body).toBe(DENIED)
  expect(leaky.posted[0]?.answer?.tokens).toBe(50)
  const silent = deps({ ask: async () => null })
  expect(await respond(silent, entry(query('ask')))).toBe('denied')
})

test('a typed answer the scan flags is denied', async () => {
  const d = deps({ typed: async () => ({ ok: true, body: `ghp_${'a'.repeat(36)}` }) })
  expect(await respond(d, entry(query('log')))).toBe('denied')
  expect(d.posted[0]?.answer?.body).toBe(DENIED)
})

test('a 10 001-character question or an empty one is denied before any budget or model', async () => {
  for (const question of ['x'.repeat(10_001), '   ']) {
    const d = deps()
    const m = query('ask', { query: { type: 'ask', repo: 'partalemre/eliti', question } })
    expect(await respond(d, entry(m))).toBe('denied')
    expect(d.calls.filter(c => c === 'ask' || c === 'budget')).toEqual([])
  }
})

test('long bodies split into numbered parts under the message cap that parse and join back', () => {
  const body = 'ş'.repeat(20_000) + 'a'.repeat(10_000)
  const parts = answerParts(QID, { ok: true, body, tokens: 7 }, 5)
  expect(parts.length).toBe(4)
  expect(parts[0]?.text.startsWith('1/4\n')).toBe(true)
  for (const p of parts) {
    expect(utf8Bytes(p.text) <= MAX_TEXT_BYTES).toBe(true)
    expect(isUnreadable(parseMessage(p.id, JSON.parse(JSON.stringify(p))))).toBe(false)
  }
  expect(parts.map(p => p.answer?.tokens)).toEqual([7, 0, 0, 0])
  expect(parts.map(p => p.answer?.body).join('')).toBe(body)
})

test('a refusal is always one part with the exact denial text', () => {
  const parts = answerParts(QID, { ok: false, body: 'stack trace…', tokens: 3 }, 5)
  expect(parts.map(p => p.answer)).toEqual([{ qid: QID, ok: false, body: DENIED, tokens: 3 }])
})

test('more than 60 queries a minute from one room are skipped', async () => {
  const d = deps()
  const id = (i: number) => `01K7A00000000000000000${String(i).padStart(4, '0')}`
  for (let i = 0; i < 60; i++) expect(await respond(d, entry({ ...query('status'), id: id(i) }))).toBe('answered')
  expect(await respond(d, entry({ ...query('status'), id: id(60) }))).toBe('skipped')
})

test('every modelless type is answered by the typed path with zero tokens, never the budget or the model', async () => {
  const queries = [
    { type: 'grep', text: 'needle' }, { type: 'files', path: 'lib' }, { type: 'todo' }, { type: 'deps' }, { type: 'commit', sha: 'abcdef1' },
  ]
  for (const q of queries) {
    const seen: unknown[] = []
    const d = deps({ typed: async query => { seen.push(query); return { ok: true, body: 'x' } } })
    const m = parseMessage(QID, query('grep', { query: { repo: 'partalemre/eliti', ...q } })) as Message
    expect(await respond(d, entry(m))).toBe('answered')
    expect(seen).toEqual([{ repo: 'partalemre/eliti', ...q }])
    expect(d.calls.filter(c => c === 'ask' || c === 'budget')).toEqual([])
    expect(d.posted[0]?.answer?.tokens).toBe(0)
  }
})

test('a new type behind a closed gate is denied with the exact text and never reaches the typed answer', async () => {
  let isTyped = false
  const d = deps({ gate: async () => false, typed: async () => { isTyped = true; return { ok: true, body: 'x' } } })
  const m = parseMessage(QID, query('grep', { query: { type: 'grep', repo: 'partalemre/eliti', text: 'needle' } })) as Message
  expect(await respond(d, entry(m))).toBe('denied')
  expect(d.posted[0]?.answer).toEqual({ qid: QID, ok: false, body: DENIED, tokens: 0 })
  expect(isTyped).toBe(false)
})
