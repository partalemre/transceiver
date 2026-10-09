// What the pane says about a room, the same on every surface: the head's status line, the gate's word and why,
// its four conditions, how long ago GitHub was asked, and the one notice a room shows when something is wrong.
// Built from the model only: nothing is said that the sync state or the gate did not see.
import type { GateBadge, RoomView } from './state-types'
import { agoText } from './when'

export type Status = { text: string; isHere: boolean }

// "burada · 1 dk önce okudu" for a DM (each part only when known), "sen ve Alperen" for a project. A mailbox that
// cannot be read is the notice line's to say, not the head's.
export function statusOf(room: RoomView, o: { now: number; isHere: boolean }): Status | null {
  if (room.kind === 'project') return { text: room.peerName === undefined ? 'davet bekleniyor' : `sen ve ${room.peerName}`, isHere: false }
  if (room.isWaiting) return { text: 'Arkadaşın daveti kabul edince başlar', isHere: false }
  const parts = [o.isHere ? 'burada' : '', room.peerReadTs > 0 ? `${agoText(room.peerReadTs, o.now)} okudu` : ''].filter(Boolean)
  return parts.length === 0 ? null : { text: parts.join(' · '), isHere: o.isHere }
}

export type GateWord = { paint: string; label: string; glyph: string }

export const GATE_WORD: Record<GateBadge, GateWord> = {
  open: { paint: 'ok', label: 'Kapı açık', glyph: '⛨' },
  closed: { paint: 'danger', label: 'Kapı kapalı', glyph: '⛨' },
  unknown: { paint: 'warn', label: 'Kapı bekliyor', glyph: '◷' },
}

// Why the gate is what it is, in a few words: the first condition that fails, or the one still unknown.
export function gateDetail(room: RoomView): string {
  const c = room.project?.checks
  if (c === undefined || !c.isConfirmed || c.login === undefined) return 'GitHub eşleşmesi yok'
  if (c.isPair === false) return 'agent trafiği yalnızca iki kişilik odada'
  if (c.isCollaborator === false) return `@${c.login} collaborator değil`
  if (c.isSessionRepo === false) return 'bu oturum başka bir repoda'
  if (c.isCollaborator === null) return `@${c.login} · GitHub ilk soruda sorulur`
  return c.isSessionRepo === null ? `@${c.login} · oturumun reposu okunuyor` : `@${c.login} collaborator`
}

export type CheckRow = { text: string; state: boolean | null; isMono?: boolean }

export function checkRows(room: RoomView): CheckRow[] {
  const c = room.project?.checks
  const who = room.peerName ?? 'Karşı taraf'
  return [
    { text: c?.isConfirmed === true ? `${who} onaylı` : `${who} GitHub'da onaylanmadı`, state: c?.isConfirmed === true },
    { text: c?.login === undefined ? 'collaborator' : `@${c.login} collaborator`, state: c?.isConfirmed === true ? c.isCollaborator : false },
    { text: 'Bu oturumun reposu', state: c?.isSessionRepo ?? null },
    { text: c?.isPair === false ? 'İki kişilik oda değil' : 'İki kişilik proje odası', state: c?.isPair !== false },
  ]
}

export const passedOf = (rows: readonly CheckRow[]): number => rows.filter(r => r.state === true).length

export function checkedText(room: RoomView, now: number): string {
  const at = room.project?.checks.checkedAt ?? null
  return at === null ? 'GitHub henüz sorulmadı; ilk soruda sorulur' : `GitHub ${agoText(at, now)} kontrol edildi`
}

// The one line a room shows under its head when something is wrong, most pressing first; null while all is well,
// so the gate and the budget stay out of sight. `hasWhy`: the line offers the room's details (the gate's checks).
export type Notice = { text: string; paint: 'warn' | 'danger'; hasWhy: boolean }

export function noticeOf(room: RoomView): Notice | null {
  if (room.isTroubled) return { text: 'Bağlantı sorunu; oda birazdan yeniden okunacak.', paint: 'warn', hasWhy: false }
  if (room.isBoxBlocked) {
    return { text: `${room.peerName ?? 'Karşı taraf'} kutusunu henüz seninle paylaşmadı; claude.ai'de paylaşmasını iste.`, paint: 'warn', hasWhy: false }
  }
  const p = room.project
  if (p === undefined) return null
  if (room.gate === 'closed') return { text: `Agent'lar kapalı: ${gateDetail(room)}.`, paint: 'danger', hasWhy: true }
  if (p.askUsed >= p.askLimit) return { text: `Agent'ının bugünkü ${p.askLimit} cevap hakkı doldu; yeni sorular onayını bekler.`, paint: 'warn', hasWhy: false }
  return null
}
