// The T16 checklist, simulated: Emre's and Alperen's mods (and a second Alperen session) against one claude.ai
import { authorKey } from '../hooks/authors'
// whose mailboxes enforce the mailbox rules. Each test is one step of the walk and builds on the ones before it.
import { expect, test } from 'claude-code/testing'
import { loadDrafts, settleDraft } from '../hooks/drafts'
import { forgetRepo } from '../hooks/here'
import { forgetLogin } from '../hooks/identity'
import { COLLAB_CACHE_MS, DISCOVER_MS } from '../hooks/limits'
import { DENIED, type Message } from '../hooks/protocol'
import { discover, enqueueMessage, setViewing, startLoop, stopRoom } from '../hooks/room-loop'
import { loadRooms, loadSettings, saveRooms, saveSettings } from '../hooks/rooms'
import { newId } from '../hooks/ulid'
import * as T from './db-texts'
import {
  accept, agentTool, ALPEREN, command, confirmGh, EMRE, fakeNet, machine, person, receipt, REPO, resultOf, roomOf,
  sameStore, share, textsIn, wireMod,
} from './e2e-world'
import type { FakeAgent } from './fake-agent'
import { callerAs } from './fake-db'
import { scheduler } from './fake-host'

const sched = scheduler()
const net = fakeNet()
const collaborators = new Set(['partalemre', 'alperenx'])
const FILES = { '/w/lib/a.dart': 'void main() {}', '/w/config.ts': 'const k = "AKIAIOSFODNN7EXAMPLE";', '/w/.env': 'TOKEN=1' }
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const GH_TOKEN = `ghp_${'a'.repeat(36)}`

type Walk = {
  // `dm` and `project` are Emre's mailboxes, `dmA` and `projectA` Alperen's.
  emre: FakeAgent; alperen: FakeAgent; alperen2: FakeAgent; dm: string; project: string; dmA: string; projectA: string
  unwire: Array<() => void>; unwire2: Array<() => void>
}
const w = { unwire: [], unwire2: [] } as unknown as Walk

const human = (text: string): Message => ({ v: 1, id: newId(sched.clock.now), ts: sched.clock.now, kind: 'human', text })
const urlIn = (text: string | null) => /https:\/\/claude\.ai\/artifact\/\S+/.exec(text ?? '')?.[0] ?? ''
const dbOf = (url: string) => net.rooms.get(url)?.db
const outboxDocs = (url: string, uid: string) =>
  [...(dbOf(url)?.docs ?? new Map())].filter(([k]) => k.startsWith(`outbox/${uid}/msgs/`)).map(([, d]) => d.data)

async function say(host: FakeAgent, url: string, text: string): Promise<void> {
  expect(enqueueMessage({ host, room: await roomOf(host, url), message: human(text) })).toBe(true)
}

async function viewing(host: FakeAgent | null, url = ''): Promise<void> {
  setViewing(host === null ? null : (await roomOf(host, url)).id, true)
}

test('setup: two people, each with the mod and their own machine, on one clock', async () => {
  forgetRepo()
  forgetLogin()
  w.emre = await person({ net, sched, uid: EMRE, gh: 'partalemre', run: machine({ collaborators }) })
  w.alperen = await person({ net, sched, uid: ALPEREN, gh: 'AlperenX', run: machine({ collaborators }) })
  Object.assign(w.alperen.files, FILES)
  w.unwire.push(...wireMod(w.emre), ...wireMod(w.alperen))
  await viewing(null)
  // Alperen's loop starts last: the invite timer is one per process, and he is the one invited.
  await startLoop(w.emre)
  await startLoop(w.alperen)
  expect(w.emre.isConnected()).toBe(true)
})

test('Emre: /transceiver ekle publishes his DM mailbox, writes its meta and shows the link', async () => {
  const text = await command(w.emre, 'ekle')
  w.dm = urlIn(text)
  expect(text).toContain('Oda hazır, kendi kutun:')
  expect(net.rooms.get(w.dm)?.title).toBe('Transceiver · DM')
  expect(dbOf(w.dm)?.docs.get('meta/room')?.data.kind).toBe('dm')
})

test('Alperen: the invite shows within a minute of Emre sharing; Kabul et opens his own mailbox', async () => {
  await sched.advance(DISCOVER_MS)
  expect((await loadRooms(w.alperen)).length).toBe(0)
  share(net, w.dm, ALPEREN)
  await sched.advance(DISCOVER_MS)
  expect((await roomOf(w.alperen, w.dm)).status).toBe('invited')
  w.dmA = await accept(w.alperen, w.dm)
  expect(net.rooms.get(w.dmA)?.db.owner).toBe(ALPEREN)
  expect((await roomOf(w.alperen, w.dm))).toMatchObject({ status: 'active', url: w.dmA, boxes: [w.dm] })
  await sched.advance(2_000)
  // Each head sits in its writer's own mailbox.
  expect(dbOf(w.dmA)?.docs.get(`outbox/${ALPEREN}`)?.data.gh).toBe('AlperenX')
  expect(dbOf(w.dm)?.docs.get(`outbox/${EMRE}`)?.data.gh).toBe('partalemre')
})

test('Emre: Alperen shares his mailbox back and it joins Emre\'s DM within a minute', async () => {
  expect((await roomOf(w.emre, w.dm)).boxes).toEqual([])
  share(net, w.dmA, EMRE)
  // The discovery timer is one per process and runs for Alperen; Emre's mod runs its own the same way.
  await discover(w.emre)
  expect((await roomOf(w.emre, w.dm)).boxes).toEqual([w.dmA])
  expect((await loadRooms(w.emre)).length).toBe(1)
})

test('mailbox rules: only its owner writes it; a member writes nothing there, not even under their own id', async () => {
  const db = dbOf(w.dm)
  if (db === undefined) throw new Error('no dm')
  const asAlperen = callerAs(db, ALPEREN)
  const forged = await asAlperen({ tool: 'ArtifactData', action: 'set', collection: `outbox/${EMRE}/msgs`, doc_id: 'x', data: {} })
  const own = await asAlperen({ tool: 'ArtifactData', action: 'set', collection: `outbox/${ALPEREN}/msgs`, doc_id: 'x', data: {} })
  const meta = await asAlperen({ tool: 'ArtifactData', action: 'set', collection: 'meta', doc_id: 'room', data: { v: 1, kind: 'project' }, if_version: 1 })
  expect([forged.text, own.text, meta.text]).toEqual([T.MISSING, T.MISSING, T.MISSING])
  expect(db.docs.get('meta/room')?.data.kind).toBe('dm')
})

test('DM: ◷ while queued, ✓ written, ✓✓ once it reached Alperen, blue ✓✓ once he reads it', async () => {
  await say(w.emre, w.dm, 'selam')
  expect(await receipt(w.emre, w.dm, 'selam')).toBe('pending')
  await sched.advance(0)
  expect(await receipt(w.emre, w.dm, 'selam')).toBe('sent')
  await sched.advance(3_000)
  expect(await textsIn(w.alperen, w.dm)).toContain('selam')
  expect(await receipt(w.emre, w.dm, 'selam')).toBe('delivered')
  await viewing(w.alperen, w.dm)
  await sched.advance(3_000)
  expect(await receipt(w.emre, w.dm, 'selam')).toBe('read')
})

test('DM: Alperen answers and Emre gets it, with the same receipts the other way', async () => {
  await say(w.alperen, w.dm, 'merhaba')
  await viewing(w.emre, w.dm)
  await sched.advance(3_000)
  expect(await textsIn(w.emre, w.dm)).toContain('merhaba')
  expect(await receipt(w.alperen, w.dm, 'merhaba')).toBe('read')
})

test('receipts off on Alperen\'s side: he sends no blue ✓✓ and sees none from Emre', async () => {
  await saveSettings(w.alperen, { ...(await loadSettings(w.alperen)), isReceiptsOn: false })
  await viewing(w.alperen, w.dm)
  await say(w.emre, w.dm, 'okudun mu')
  await sched.advance(3_000)
  expect(await receipt(w.emre, w.dm, 'okudun mu')).toBe('delivered')
  await say(w.alperen, w.dm, 'evet')
  await viewing(w.emre, w.dm)
  await sched.advance(3_000)
  // Emre read it (his receipts are on), but Alperen's pane does not show it while his are off.
  expect(await receipt(w.alperen, w.dm, 'evet')).toBe('delivered')
  await saveSettings(w.alperen, { ...(await loadSettings(w.alperen)), isReceiptsOn: true })
  expect(await receipt(w.alperen, w.dm, 'evet')).toBe('read')
  await viewing(null)
})

test('project room: Emre opens eliti, Alperen accepts, both heads carry their GitHub login', async () => {
  w.project = urlIn(await command(w.emre, `proje ${REPO}`))
  expect(net.rooms.get(w.project)?.title).toBe(`Transceiver · ${REPO}`)
  share(net, w.project, ALPEREN)
  await sched.advance(DISCOVER_MS)
  w.projectA = await accept(w.alperen, w.project)
  share(net, w.projectA, EMRE)
  await discover(w.emre)
  await sched.advance(3_000)
  expect((await roomOf(w.emre, w.project)).boxes).toEqual([w.projectA])
  expect(dbOf(w.project)?.docs.get(`outbox/${EMRE}`)?.data.gh).toBe('partalemre')
  expect(dbOf(w.projectA)?.docs.get(`outbox/${ALPEREN}`)?.data.gh).toBe('AlperenX')
})

test('gate closed until the GitHub question is answered: a query gets exactly erişim yok', async () => {
  const out = resultOf(await agentTool(w.emre, 'ask', { type: 'status' }))
  expect(out).toContain(DENIED)
  expect(out).not.toContain('main')
})

// A second session reads the person's rooms from their store, so it writes the same mailbox (here its records are
// copied under new ids, which one process needs, see sameStore).
test('both say Evet; a second Alperen session opens the same rooms', async () => {
  await confirmGh(w.emre, w.project, { uid: authorKey({ uid: ALPEREN, url: w.projectA, isOwn: false }), gh: 'AlperenX' })
  await confirmGh(w.alperen, w.project, { uid: authorKey({ uid: EMRE, url: w.project, isOwn: false }), gh: 'partalemre' })
  w.alperen2 = await person({ net, sched, uid: ALPEREN, gh: 'AlperenX', run: machine({ collaborators }) })
  Object.assign(w.alperen2.files, FILES)
  sameStore(w.alperen2, w.alperen)
  w.unwire2.push(...wireMod(w.alperen2))
  await saveRooms(w.alperen2, (await loadRooms(w.alperen)).map(r => ({ ...r, id: `${r.id}2` })))
  await startLoop(w.alperen2)
  expect((await roomOf(w.alperen2, w.project)).url).toBe(w.projectA)
  await sched.advance(3_000)
})

const claimsOf = (host: FakeAgent, qid: string) => host.tools.filter(t => String(t.collection).endsWith('/claims') && t.doc_id === qid).length
const lastQid = () => String(outboxDocs(w.project, EMRE).filter(d => d.kind === 'query').map(d => d.id).sort().at(-1))
const answersTo = (qid: string) => outboxDocs(w.projectA, ALPEREN).filter(d => (d.answer as { qid?: string } | undefined)?.qid === qid)

test('a typed query is answered once, at no token cost, while two Alperen sessions race for it', async () => {
  const out = resultOf(await agentTool(w.emre, 'ask', { type: 'status' }))
  expect(out).toContain('main · 1 değişen dosya')
  await sched.advance(5_000)
  const qid = lastQid()
  expect(answersTo(qid).length).toBe(1)
  expect((answersTo(qid)[0]?.answer as { tokens: number }).tokens).toBe(0)
  expect([claimsOf(w.alperen, qid), claimsOf(w.alperen2, qid)]).toEqual([1, 1])
  expect(w.alperen.asked.length + w.alperen2.asked.length).toBe(0)
})

test('file queries: a source file comes back; .env, a key-bearing file and a path outside get erişim yok', async () => {
  expect(resultOf(await agentTool(w.emre, 'ask', { type: 'file', path: 'lib/a.dart' }))).toContain('void main() {}')
  for (const path of ['.env', 'config.ts', '../../etc/hosts']) {
    const out = resultOf(await agentTool(w.emre, 'ask', { type: 'file', path }))
    expect(out).toContain(DENIED)
    expect(out).not.toContain(AWS_KEY)
  }
})

// The ask budget is per room of the person's store; the second session's record has its own id here (see
// sameStore), so it closes before the budget is counted, as it would after a reload.
test('the second Alperen session closes', async () => {
  for (const off of w.unwire2) off()
  for (const r of await loadRooms(w.alperen2)) stopRoom(r.id)
  await sched.advance(2_000)
})

test('ask: ten a day get a small model\'s answer; the eleventh waits as a draft until Alperen approves', async () => {
  for (let i = 1; i <= 10; i++) expect(resultOf(await agentTool(w.emre, 'ask', { type: 'ask', question: `soru ${i}?` }))).toContain('çünkü')
  const eleventh = resultOf(await agentTool(w.emre, 'ask', { type: 'ask', question: 'soru 11?' }))
  expect(eleventh).toMatch(/^pending:/)
  expect(w.alperen.asked.length).toBe(10)
  const drafts = await loadDrafts(w.alperen)
  expect(drafts.map(d => [d.question, d.asker])).toEqual([['soru 11?', authorKey({ uid: EMRE, url: w.project, isOwn: false })]])
  const draft = drafts[0]
  expect(await settleDraft(w.alperen, { qid: draft?.qid ?? '', isApproved: true })).toBe(true)
  await sched.advance(3_000)
  expect(answersTo(draft?.qid ?? '').length).toBe(1)
  expect(resultOf(await agentTool(w.emre, 'inbox'))).toContain(`[answer ${draft?.qid}]`)
})

test('a secret in an outgoing agent message is refused and never written', async () => {
  const out = await agentTool(w.emre, 'send', { text: `deploy anahtarı ${GH_TOKEN}` })
  expect('deny' in out).toBe(true)
  await sched.advance(3_000)
  const everything = JSON.stringify([...net.rooms.values()].map(r => [...r.db.docs]))
  expect(everything).not.toContain(GH_TOKEN)
  expect(everything).not.toContain(AWS_KEY)
})

test('live on: Alperen\'s agent message wakes Emre\'s idle eliti session, fenced as data', async () => {
  const rooms = await loadRooms(w.emre)
  await saveRooms(w.emre, rooms.map(r => (r.url === w.project ? { ...r, isLive: true } : r)))
  expect(resultOf(await agentTool(w.alperen, 'send', { text: 'build kırıldı' }))).toBe('gönderildi')
  await sched.advance(6_000)
  const woke = [...w.emre.sent, ...w.emre.notes].find(t => t.includes('build kırıldı'))
  expect(woke).toContain('<<<')
})

test('a collaborator removed on GitHub gets exactly erişim yok once the 10-minute cache runs out', async () => {
  collaborators.delete('partalemre')
  setViewing(null, false)
  await sched.advance(COLLAB_CACHE_MS + 1_000)
  await viewing(null)
  expect(resultOf(await agentTool(w.emre, 'ask', { type: 'status' }))).toContain(DENIED)
  collaborators.add('partalemre')
})

test('Emre leaves the DM: his mod stops polling it, Alperen\'s goes on', async () => {
  expect(await command(w.emre, 'çık DM')).toBe('Transceiver · DM odasından çıkıldı.')
  const count = (uid: string) => net.calls.filter(c => c.uid === uid && c.url === w.dm).length
  const [emre, alperen] = [count(EMRE), count(ALPEREN)]
  await sched.advance(30_000)
  expect(count(EMRE)).toBe(emre)
  expect(count(ALPEREN)).toBeGreaterThan(alperen)
})

test('no path, model, session or repo name reaches a DM; no path or model reaches any room', async () => {
  const dump = (url: string) => JSON.stringify([...(dbOf(url)?.docs ?? new Map())])
  for (const url of [w.dm, w.project, w.dmA, w.projectA]) {
    expect(dump(url)).not.toContain('/w/')
    expect(dump(url)).not.toContain('/home/')
    expect(dump(url)).not.toContain('haiku')
  }
  expect(dump(w.dm)).not.toContain('eliti')
  expect(dump(w.dmA)).not.toContain('eliti')
  // Module state outlives this file: leave the pane closed and nothing polling.
  for (const off of w.unwire) off()
  for (const host of [w.emre, w.alperen]) for (const r of await loadRooms(host)) stopRoom(r.id)
  setViewing(null, false)
})
