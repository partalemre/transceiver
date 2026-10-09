// What the pane says about a room, the same on every surface: the head's status line, the gate's word and why,
// its four conditions, and how long ago GitHub was asked. Built from the model only: nothing is said that the
// sync state or the gate did not see.
import type { GateBadge, RoomView } from './state-types'
import { agoText } from './when'

export type Status = { text: string; isHere: boolean }

// "burada · 1 dk önce okudu" for a DM (each part only when known), "Proje odası · sen ve Alperen" for a project.
export function statusOf(room: RoomView, o: { now: number; isHere: boolean }): Status | null {
  if (room.kind === 'project') return { text: `Proje odası · ${room.peerName === undefined ? 'davet bekleniyor' : `sen ve ${room.peerName}`}`, isHere: false }
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
    { text: 'Proje odası', state: true },
  ]
}

export const passedOf = (rows: readonly CheckRow[]): number => rows.filter(r => r.state === true).length

export function checkedText(room: RoomView, now: number): string {
  const at = room.project?.checks.checkedAt ?? null
  return at === null ? 'GitHub henüz sorulmadı; ilk soruda sorulur' : `GitHub ${agoText(at, now)} kontrol edildi`
}

// A project row's second line: the gate's word and today's agent questions.
export function projectLine(room: RoomView): string {
  const count = room.project?.queriesToday ?? 0
  const gate = room.gate === 'closed' ? `kapı kapalı · ${gateDetail(room)}` : room.gate === 'open' ? 'kapı açık' : 'kapı bekliyor'
  return room.gate === 'closed' || count === 0 ? gate : `${gate} · ${count} agent sorusu`
}
