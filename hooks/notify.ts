// Outside the pane: one status line under the prompt (the unread count) and a toast for a friend's new message,
// both only while the pane is not on screen. Nothing here opens the pane or takes the focus.
import { TOAST_CHARS } from './limits'
import { isUnreadable } from './protocol'
import type { PaneModel, RoomView } from './state-types'
import type { Entry } from './timeline'

export function statusText(rooms: readonly RoomView[], isShown: boolean): string | undefined {
  const total = rooms.reduce((n, r) => n + r.unread, 0)
  if (isShown || total === 0) return undefined
  const from = rooms.filter(r => r.unread > 0)
  const who = from.length === 1 ? ` · ${from[0]?.title ?? ''}` : ` · ${from.length} oda`
  return `((·)) ${total} okunmamış${who}`
}

const firstLine = (text: string) => text.split('\n').find(l => l.trim() !== '')?.trim() ?? ''
const clip = (text: string) => (text.length > TOAST_CHARS ? `${text.slice(0, TOAST_CHARS - 1)}…` : text)

// A person's words only: agent traffic and system lines stay in the pane.
export function toastText(opts: { name: string; entries: readonly Entry[] }): string | null {
  const human = opts.entries.filter(e => !isUnreadable(e.message) && e.message.kind === 'human')
  const last = human.at(-1)?.message
  if (last === undefined || isUnreadable(last)) return null
  if (human.length > 1) return `${opts.name}: ${human.length} yeni mesaj`
  return `${opts.name}: ${clip(firstLine(last.text))}`
}

export type NotifyPort = { toast(text: string): void; status(text: string | undefined): void }

let lastStatus: string | undefined

// Called after each room's poll with what it brought in. The status line is set only when its text changes.
export type NotifyOpts = {
  ui: NotifyPort; model: PaneModel; roomId: string; fresh: readonly Entry[]; isShown: boolean; names: Record<string, string>
}

export function notifyTick(o: NotifyOpts): void {
  const { settings } = o.model
  const status = settings.isStatusOn ? statusText(o.model.rooms, o.isShown) : undefined
  if (status !== lastStatus) {
    lastStatus = status
    o.ui.status(status)
  }
  if (!settings.isToastOn || o.isShown || o.fresh.length === 0) return
  const room = o.model.rooms.find(r => r.id === o.roomId)
  const author = o.names[o.fresh.at(-1)?.author ?? ''] || 'Biri'
  const name = room?.kind === 'project' ? `${author} · ${room.title}` : room?.title ?? author
  const text = toastText({ name, entries: o.fresh })
  if (text !== null) o.ui.toast(text)
}

