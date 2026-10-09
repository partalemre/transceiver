// Rooms, people and conversations for the pane's previews and behaviour tests: a DM with Alperen (unread), a
// project room on partalemre/eliti with agent traffic, and a DM with Zeynep whose last message she has read.
import { emptyHead, type Head, type Message } from '../hooks/protocol'
import type { RoomRecord, Settings } from '../hooks/rooms'
import type { RoomSync } from '../hooks/sync'
import type { Entry } from '../hooks/timeline'
import { newId } from '../hooks/ulid'
import { EMPTY_SESSION, type ModelInput, type SessionUi } from '../hooks/view'

export const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
export const ALPEREN = 'u_BBBBBBBBBBBBBBBBBBBBBB'
export const ZEYNEP = 'u_CCCCCCCCCCCCCCCCCCCCCC'
export const NAMES = { [ALPEREN]: 'Alperen Yıldız', [ZEYNEP]: 'Zeynep' }

const MIN = 60_000
// Friday 9 October 2026, 14:30 on the test machine's clock.
export const NOW = new Date(2026, 9, 9, 14, 30).getTime()
const at = (minutesAgo: number) => NOW - minutesAgo * MIN
export const idAt = (minutesAgo: number) => newId(at(minutesAgo), () => 0)

const human = (minutesAgo: number, text: string): Message => ({ v: 1, id: idAt(minutesAgo), ts: at(minutesAgo), kind: 'human', text })
const said = (author: string, message: Message, isPending = false): Entry => ({ author, message, ...(isPending ? { isPending } : {}) })

export const room = (o: Partial<RoomRecord> & { id: string }): RoomRecord => ({
  url: `https://claude.ai/artifact/${o.id.toUpperCase()}x`, kind: 'dm', title: 'Transceiver · DM', status: 'active',
  isLive: false, isOwner: true, peers: [], joinedAt: at(3 * 24 * 60), ...o,
})

const head = (o: Partial<Head>): Head => ({ ...emptyHead(), ...o })

function sync(o: { peers: Record<string, Head>; entries: Entry[]; failures?: number; readUpTo?: string }): RoomSync {
  const pending = o.entries.filter(e => e.isPending === true).map(e => e.message as Message)
  const seen = o.entries.filter(e => e.author !== ME).reduce((max, e) => (e.message.id > max ? e.message.id : max), '')
  return {
    selfUid: ME, ownHead: head({ readUpTo: o.readUpTo ?? '', seenUpTo: seen }), ownVersion: 3, cursors: {}, peers: o.peers,
    entries: o.entries, pending, failures: o.failures ?? 0,
  }
}

// Yesterday's evening, then today: mine read, mine delivered, theirs unread, one of mine still going out.
export function dmAlperen(opts: { isPending?: boolean } = {}): RoomSync {
  const entries = [
    said(ALPEREN, human(20 * 60, 'Yarın deploy\'dan önce bir bakar mısın? PR açık.')),
    said(ME, human(20 * 60 - 3, 'Tabii, sabah ilk iş.')),
    said(ME, human(95, 'Baktım, iki küçük yorum bıraktım. Gerisi temiz 👍')),
    said(ALPEREN, human(80, 'Süper, düzelttim bile.')),
    said(ME, human(42, 'Akşam maça geliyor musun?')),
    said(ALPEREN, human(12, 'Gelirim! Saat kaçta?')),
    said(ALPEREN, human(11, 'Bu arada yeni branch\'i pushladım, eliti odasından agent\'ına sorabilirsin.')),
  ]
  if (opts.isPending === true) entries.push(said(ME, human(1, 'Sekizde stadyum önünde.'), true))
  return sync({ peers: { [ALPEREN]: head({ seenUpTo: idAt(42), readUpTo: idAt(80) }) }, entries, readUpTo: idAt(42) })
}

export function dmZeynep(): RoomSync {
  const entries = [said(ZEYNEP, human(26 * 60, 'Sunum dosyasını attım.')), said(ME, human(25 * 60, 'Teşekkürler, okudum, çok iyi olmuş.'))]
  return sync({ peers: { [ZEYNEP]: head({ seenUpTo: idAt(25 * 60), readUpTo: idAt(25 * 60) }) }, entries, readUpTo: idAt(26 * 60) })
}

const REPO = 'partalemre/eliti'

// The person asks Alperen's agent; it answers. Alperen's agent asks for .env and is refused.
export function projectEliti(): RoomSync {
  const ask: Message = {
    v: 1, id: idAt(30), ts: at(30), kind: 'query', text: 'Yeni branch neyi değiştiriyor?',
    query: { type: 'ask', repo: REPO, question: 'Yeni branch neyi değiştiriyor? Test durumu ne?' },
  }
  const answer: Message = {
    v: 1, id: idAt(29), ts: at(29), kind: 'answer', text: '',
    answer: { qid: idAt(30), ok: true, tokens: 312, body: 'feat/odeme-akisi: ödeme adımı tek ekrana indi, Stripe webhook\'u kuyruktan geçiyor.\nTestler: 128 geçti, 0 kaldı.' },
  }
  const status: Message = { v: 1, id: idAt(9), ts: at(9), kind: 'query', text: '.env', query: { type: 'file', repo: REPO, path: '.env' } }
  const denied: Message = { v: 1, id: idAt(8), ts: at(8), kind: 'answer', text: '', answer: { qid: idAt(9), ok: false, body: 'erişim yok', tokens: 0 } }
  const entries = [
    said(ALPEREN, human(35, 'Ödeme akışını ayrı branch\'e aldım.')),
    said(ME, ask), said(ALPEREN, answer), said(ALPEREN, status), said(ME, denied),
  ]
  return sync({ peers: { [ALPEREN]: head({ seenUpTo: idAt(8), readUpTo: idAt(8), gh: 'alperenx' }) }, entries, readUpTo: idAt(8) })
}

export const ROOMS = {
  alperen: room({ id: 'ra' }),
  eliti: room({ id: 're', kind: 'project', repo: REPO, title: `Transceiver · ${REPO}`, peers: [{ uid: ALPEREN, gh: 'alperenx', isGhConfirmed: true }] }),
  zeynep: room({ id: 'rz', isOwner: false }),
}

export const SETTINGS: Settings = { isReceiptsOn: true, isToastOn: true, isStatusOn: true }

export function input(o: { rooms?: RoomRecord[]; syncs?: Record<string, RoomSync>; session?: Partial<SessionUi>; isConnected?: boolean } = {}): ModelInput {
  const rooms = o.rooms ?? [ROOMS.alperen, ROOMS.eliti, ROOMS.zeynep]
  const syncs = o.syncs ?? { ra: dmAlperen(), re: projectEliti(), rz: dmZeynep() }
  return {
    rooms, syncs, names: NAMES, settings: SETTINGS, now: NOW, isConnected: o.isConnected ?? true,
    session: { ...EMPTY_SESSION, latencyMs: 680, ...o.session },
  }
}
