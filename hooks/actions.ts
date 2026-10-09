// What each press and submit in the pane does. Every handler runs against the bound port, catches its own
// failure (a short Turkish line, never tool text or a message body) and redraws.
import type { RenderSurface } from 'claude-code'

import { isConnected, setConnected } from './connection'
import { joinUrlOf, joinRoom } from './join'
import { MAX_TEXT_BYTES } from './limits'
import { isRepo, paths, utf8Bytes, type Message } from './protocol'
import { enqueueMessage, pokeRoom, syncOf } from './room-loop'
import { createRoom, loadRooms, loadSettings, saveRooms, saveSettings, type RoomKind, type RoomRecord } from './rooms'
import { draftSettlerNow, modelNow, patchSession, portNow, refreshPane, sessionNow, type PanePort } from './state'
import type { PaneSettings, PaneView } from './state-types'
import { newId } from './ulid'

const ASK_PREFIX = '/ask '
const CONNECT_CONSENT = 'The user pressed "Bağlan" on the Transceiver pane to send messages from this session.'
const SAY = {
  tooLong: 'Mesaj çok uzun (en fazla 16 KB).',
  askOnlyProject: '/ask yalnızca proje odalarında çalışır.',
  notLoaded: 'Oda henüz yüklenmedi; birazdan tekrar dene.',
  declined: 'Onay verilmedi; yazdıkların sırada bekliyor.',
  offline: 'Bağlanılamadı; ağ bağlantını kontrol et.',
  failed: 'Bir şey ters gitti; birazdan tekrar dene.',
  badRepo: 'Repo adını sahip/repo biçiminde yaz (ör. partalemre/eliti).',
  badLink: 'claude.ai/artifact/… biçiminde bir oda linki yapıştır.',
  draftWaits: 'Önce "Bağlan": cevap bu oturumdan gönderilir.',
}

type Step = (p: PanePort) => Promise<void>

// Runs one press; a press while a long step is in flight waits its turn by being ignored.
function run(step: Step): void {
  const p = portNow()
  if (p === null) return
  void step(p).catch(() => patchSession({ error: SAY.failed, busy: null })).finally(() => void refreshPane())
}

async function patchRoom(p: PanePort, id: string, patch: Partial<RoomRecord>): Promise<RoomRecord | undefined> {
  const rooms = (await loadRooms(p.host)).map(r => (r.id === id ? { ...r, ...patch } : r))
  await saveRooms(p.host, rooms)
  return rooms.find(r => r.id === id)
}

function messageOf(opts: { text: string; now: number; room: RoomRecord }): Message | string {
  const id = newId(opts.now)
  if (!opts.text.startsWith(ASK_PREFIX)) return { v: 1, id, ts: opts.now, kind: 'human', text: opts.text }
  if (opts.room.kind !== 'project' || !isRepo(opts.room.repo)) return SAY.askOnlyProject
  const question = opts.text.slice(ASK_PREFIX.length).trim()
  return { v: 1, id, ts: opts.now, kind: 'query', text: question, query: { type: 'ask', repo: opts.room.repo, question } }
}

// Shown at once as pending; the room's loop sends it, or keeps it waiting until the session is connected.
async function send(p: PanePort, opts: { roomId: string; text: string }): Promise<void> {
  const text = opts.text.trim()
  const room = (await loadRooms(p.host)).find(r => r.id === opts.roomId && r.status === 'active')
  if (text === '' || room === undefined) return
  if (utf8Bytes(text) > MAX_TEXT_BYTES) return patchSession({ error: SAY.tooLong })
  const message = messageOf({ text, now: await p.host.now(), room })
  if (typeof message === 'string') return patchSession({ error: message })
  if (!enqueueMessage({ host: p.host, room, message })) return patchSession({ error: SAY.notLoaded })
  patchSession({ error: null, composerKey: sessionNow().composerKey + 1 })
}

async function select(p: PanePort, id: string): Promise<void> {
  patchSession({ activeId: id, view: 'chat', error: null })
  const room = (await loadRooms(p.host)).find(r => r.id === id)
  if (room !== undefined) pokeRoom(p.host, room)
}

async function accept(p: PanePort, id: string): Promise<void> {
  const room = await patchRoom(p, id, { status: 'active' })
  if (room !== undefined) await select(p, room.id)
}

async function answerGh(p: PanePort, isYes: boolean): Promise<void> {
  const ask = modelNow()?.ghAsk
  const room = ask == null ? undefined : (await loadRooms(p.host)).find(r => r.id === ask.roomId)
  if (ask == null || room === undefined) return
  // A "no" is kept too, against this login, so the same question is not asked again.
  const peer = { uid: ask.uid, gh: ask.gh, isGhConfirmed: isYes }
  await patchRoom(p, room.id, { peers: [...room.peers.filter(x => x.uid !== ask.uid), peer] })
}

// The session's first write, raised by the press: the person's own head, written back as it is (spike R1). Any
// answer but a refusal means the write was allowed, and every later write this session passes without asking.
async function connect(p: PanePort): Promise<void> {
  const rooms = (await loadRooms(p.host)).filter(r => r.status === 'active')
  const room = rooms.find(r => syncOf(r.id) !== undefined)
  const sync = room === undefined ? undefined : syncOf(room.id)
  if (room === undefined || sync === undefined) return patchSession({ error: SAY.notLoaded })
  patchSession({ busy: 'Bağlanıyor…', error: null })
  await refreshPane()
  const pin = sync.ownVersion > 0 ? { if_version: sync.ownVersion } : {}
  const out = await p.host.tool({
    tool: 'ArtifactData', action: 'set', url: room.url, collection: paths.heads, doc_id: sync.selfUid, data: sync.ownHead,
    ...pin, consent: CONNECT_CONSENT,
  }).catch(() => null)
  const isOk = out !== null && out.deny === undefined
  setConnected(isOk)
  patchSession({ busy: null, error: isOk ? null : out === null ? SAY.offline : SAY.declined })
  if (isOk) for (const r of rooms) pokeRoom(p.host, r)
}

async function addRoom(p: PanePort, opts: { kind: RoomKind; repo?: string; label: string }): Promise<void> {
  if (sessionNow().busy !== null) return
  patchSession({ busy: 'Oda açılıyor…', error: null, created: null })
  await refreshPane()
  const consent = `The user pressed "${opts.label}" on the Transceiver pane`
  const room = await createRoom({ host: p.host, kind: opts.kind, repo: opts.repo, consent }).catch(() => null)
  if (room === null) return patchSession({ busy: null, error: 'Oda açılamadı; claude.ai bağlantısını kontrol edip tekrar dene.' })
  await saveRooms(p.host, [...(await loadRooms(p.host)), room])
  pokeRoom(p.host, room)
  patchSession({ busy: null, view: 'rooms', created: { url: room.url, title: room.title } })
}

async function join(p: PanePort, link: string): Promise<void> {
  const url = joinUrlOf(link)
  if (url === null) return patchSession({ error: SAY.badLink })
  patchSession({ busy: 'Katılınıyor…', error: null })
  await refreshPane()
  const text = await joinRoom(p.host, url)
  const room = (await loadRooms(p.host)).find(r => r.url === url && r.status === 'active')
  patchSession({ busy: null, error: room === undefined ? text : null })
  if (room !== undefined) await select(p, room.id)
}

async function toggleSetting(p: PanePort, key: keyof PaneSettings): Promise<void> {
  const settings = await loadSettings(p.host)
  await saveSettings(p.host, { ...settings, [key]: !settings[key] })
  if (key === 'isStatusOn' && settings.isStatusOn) p.ui.status(undefined)
}

async function copy(p: PanePort, opts: { text: string; surface: RenderSurface }): Promise<void> {
  const isCopied = await p.ui.copy(opts.text, opts.surface)
  p.ui.toast(isCopied ? 'Link kopyalandı.' : 'Kopyalanamadı; linki elle seç.')
}

export type PaneHandlers = {
  select(id: string): void
  back(): void
  send(roomId: string, text: string): void
  accept(id: string): void
  reject(id: string): void
  answerGh(isYes: boolean): void
  connect(): void
  dismissConnect(): void
  toggleLive(id: string): void
  toggleSetting(key: keyof PaneSettings): void
  openView(view: PaneView): void
  addDm(): void
  addProject(repo: string): void
  join(link: string): void
  copy(text: string, surface: RenderSurface): void
  dismissCreated(): void
  dismissError(): void
  settleDraft(qid: string, isApproved: boolean): void
}

export const paneHandlers: PaneHandlers = {
  select: id => run(p => select(p, id)),
  back: () => run(async () => patchSession({ view: 'rooms', error: null })),
  send: (roomId, text) => run(p => send(p, { roomId, text })),
  accept: id => run(p => accept(p, id)),
  reject: id => run(async p => { await patchRoom(p, id, { status: 'left' }) }),
  answerGh: isYes => run(p => answerGh(p, isYes)),
  connect: () => run(p => (isConnected() ? Promise.resolve() : connect(p))),
  dismissConnect: () => run(async () => patchSession({ isConnectDismissed: true })),
  toggleLive: id => run(async p => {
    const room = (await loadRooms(p.host)).find(r => r.id === id)
    if (room?.kind === 'project') await patchRoom(p, id, { isLive: !room.isLive })
  }),
  toggleSetting: key => run(p => toggleSetting(p, key)),
  openView: view => run(async () => patchSession({ view, error: null })),
  addDm: () => run(p => addRoom(p, { kind: 'dm', label: 'Arkadaş ekle' })),
  addProject: repo => run(p => (isRepo(repo.trim())
    ? addRoom(p, { kind: 'project', repo: repo.trim(), label: 'Proje odası aç' })
    : Promise.resolve(patchSession({ error: SAY.badRepo })))),
  join: link => run(p => join(p, link)),
  copy: (text, surface) => run(p => copy(p, { text, surface })),
  dismissCreated: () => run(async () => patchSession({ created: null })),
  dismissError: () => run(async () => patchSession({ error: null })),
  settleDraft: (qid, isApproved) => run(async () => {
    const isDone = await draftSettlerNow()?.(qid, isApproved)
    if (isDone === false && !isConnected()) patchSession({ error: SAY.draftWaits })
  }),
}
