// What the pane says about a room, the same on every surface: the head's status line, the gate's word and why,
// its four conditions, how long ago GitHub was asked, and the one notice a room shows when something is wrong.
// Built from the model only: nothing is said that the sync state or the gate did not see.
import { pick } from './kit/lang'
import type { GateBadge, RoomView } from './state-types'
import { agoText } from './when'

const EN = {
  waitingPeer: 'Project room · waiting for a teammate',
  withPeer: (peer: string) => `Project room · you and ${peer}`,
  dmWaiting: 'Starts when your friend accepts',
  here: 'here',
  read: (ago: string) => `read ${ago}`,
  gate: { open: 'Gate open', closed: 'Gate closed', unknown: 'Gate pending' } as Record<GateBadge, string>,
  noMatch: 'No GitHub match',
  notPair: 'agents talk only in a two-person room',
  notCollab: (login: string) => `@${login} is not a collaborator`,
  otherRepo: 'this session is in another repo',
  askFirst: (login: string) => `@${login} · GitHub is asked on the first question`,
  readingRepo: (login: string) => `@${login} · reading the session's repo`,
  collab: (login: string) => `@${login} is a collaborator`,
  otherSide: 'The other side',
  confirmed: (who: string) => `${who} confirmed`,
  unconfirmed: (who: string) => `${who} not confirmed on GitHub`,
  collabRow: (login?: string) => (login === undefined ? 'Collaborator' : `@${login} · collaborator`),
  sessionRepo: 'This session\'s repo',
  notPairRow: 'Not a two-person room',
  pairRow: 'Two-person project room',
  notChecked: 'GitHub not asked yet; asked on the first question',
  checked: (ago: string) => `GitHub checked ${ago}`,
  troubled: 'Connection problem. The room will be read again shortly.',
  blocked: (who: string) => `${who} hasn't shared their mailbox with you yet. Ask them to share it on claude.ai.`,
  closed: (why: string) => `Agents are off: ${why}.`,
  spent: (limit: number) => `Your agent used today's ${limit} answers. New questions wait for your approval.`,
}

const TR: typeof EN = {
  waitingPeer: 'davet bekleniyor',
  withPeer: peer => `sen ve ${peer}`,
  dmWaiting: 'Arkadaşın daveti kabul edince başlar',
  here: 'burada',
  read: ago => `${ago} okudu`,
  gate: { open: 'Kapı açık', closed: 'Kapı kapalı', unknown: 'Kapı bekliyor' },
  noMatch: 'GitHub eşleşmesi yok',
  notPair: 'agent trafiği yalnızca iki kişilik odada',
  notCollab: login => `@${login} collaborator değil`,
  otherRepo: 'bu oturum başka bir repoda',
  askFirst: login => `@${login} · GitHub ilk soruda sorulur`,
  readingRepo: login => `@${login} · oturumun reposu okunuyor`,
  collab: login => `@${login} collaborator`,
  otherSide: 'Karşı taraf',
  confirmed: who => `${who} onaylı`,
  unconfirmed: who => `${who} GitHub'da onaylanmadı`,
  collabRow: login => (login === undefined ? 'collaborator' : `@${login} collaborator`),
  sessionRepo: 'Bu oturumun reposu',
  notPairRow: 'İki kişilik oda değil',
  pairRow: 'İki kişilik proje odası',
  notChecked: 'GitHub henüz sorulmadı; ilk soruda sorulur',
  checked: ago => `GitHub ${ago} kontrol edildi`,
  troubled: 'Bağlantı sorunu; oda birazdan yeniden okunacak.',
  blocked: who => `${who} kutusunu henüz seninle paylaşmadı; claude.ai'de paylaşmasını iste.`,
  closed: why => `Agent'lar kapalı: ${why}.`,
  spent: limit => `Agent'ının bugünkü ${limit} cevap hakkı doldu; yeni sorular onayını bekler.`,
}

const words = () => pick({ en: EN, tr: TR })

export type Status = { text: string; isHere: boolean }

// "here · read 1m ago" for a DM (each part only when known), "Project room · you and Leo" for a project. A
// mailbox that cannot be read is the notice line's to say, not the head's.
export function statusOf(room: RoomView, o: { now: number; isHere: boolean }): Status | null {
  const w = words()
  if (room.kind === 'project') return { text: room.peerName === undefined ? w.waitingPeer : w.withPeer(room.peerName), isHere: false }
  if (room.isWaiting) return { text: w.dmWaiting, isHere: false }
  const parts = [o.isHere ? w.here : '', room.peerReadTs > 0 ? w.read(agoText(room.peerReadTs, o.now)) : ''].filter(Boolean)
  return parts.length === 0 ? null : { text: parts.join(' · '), isHere: o.isHere }
}

export type GateWord = { paint: string; label: string; glyph: string }

const GATE_LOOK: Record<GateBadge, Omit<GateWord, 'label'>> = {
  open: { paint: 'ok', glyph: '⛨' },
  closed: { paint: 'danger', glyph: '⛨' },
  unknown: { paint: 'warn', glyph: '◷' },
}

export const gateWord = (badge: GateBadge): GateWord => ({ ...GATE_LOOK[badge], label: words().gate[badge] })

// Why the gate is what it is, in a few words: the first condition that fails, or the one still unknown.
export function gateDetail(room: RoomView): string {
  const c = room.project?.checks
  const w = words()
  if (c === undefined || !c.isConfirmed || c.login === undefined) return w.noMatch
  if (c.isPair === false) return w.notPair
  if (c.isCollaborator === false) return w.notCollab(c.login)
  if (c.isSessionRepo === false) return w.otherRepo
  if (c.isCollaborator === null) return w.askFirst(c.login)
  return c.isSessionRepo === null ? w.readingRepo(c.login) : w.collab(c.login)
}

export type CheckRow = { text: string; state: boolean | null; isMono?: boolean }

export function checkRows(room: RoomView): CheckRow[] {
  const c = room.project?.checks
  const w = words()
  const who = room.peerName ?? w.otherSide
  return [
    { text: c?.isConfirmed === true ? w.confirmed(who) : w.unconfirmed(who), state: c?.isConfirmed === true },
    { text: w.collabRow(c?.login), state: c?.isConfirmed === true ? c.isCollaborator : false },
    { text: w.sessionRepo, state: c?.isSessionRepo ?? null },
    { text: c?.isPair === false ? w.notPairRow : w.pairRow, state: c?.isPair !== false },
  ]
}

export const passedOf = (rows: readonly CheckRow[]): number => rows.filter(r => r.state === true).length

export function checkedText(room: RoomView, now: number): string {
  const at = room.project?.checks.checkedAt ?? null
  return at === null ? words().notChecked : words().checked(agoText(at, now))
}

// The one line a room shows under its head when something is wrong, most pressing first; null while all is well,
// so the gate and the budget stay out of sight. `hasWhy`: the line offers the room's details (the gate's checks).
export type Notice = { text: string; paint: 'warn' | 'danger'; hasWhy: boolean }

export function noticeOf(room: RoomView): Notice | null {
  const w = words()
  if (room.isTroubled) return { text: w.troubled, paint: 'warn', hasWhy: false }
  if (room.isBoxBlocked) return { text: w.blocked(room.peerName ?? w.otherSide), paint: 'warn', hasWhy: false }
  const p = room.project
  if (p === undefined) return null
  if (room.gate === 'closed') return { text: w.closed(gateDetail(room)), paint: 'danger', hasWhy: true }
  if (p.askUsed >= p.askLimit) return { text: w.spent(p.askLimit), paint: 'warn', hasWhy: false }
  return null
}
