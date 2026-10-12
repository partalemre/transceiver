// The MODZ hub's side of Transceiver (MODZ DESIGN.md §9): the one line the hub shows for it, and the hub's open
// requests, which name a pane by id. Pure: register.tsx writes the line, and only when it changed.
import type { HubCard, HubTone } from '../types'
import { isSame } from './kit/same'
import type { RoomView } from './state-types'
import { agentWords } from './words-agent'

export const HUB_PANE = 'transceiver'

export type HubShown = { detail: string; tone: HubTone }

// "2 unread · 3 rooms" while something waits to be read (live, so the hub may lead with it), "3 oda" otherwise;
// nothing to say before the first room.
export function hubOf(rooms: readonly RoomView[]): HubShown {
  if (rooms.length === 0) return { detail: '', tone: 'idle' }
  const unread = rooms.reduce((sum, room) => sum + room.unread, 0)
  const w = agentWords()
  const count = w.rooms(rooms.length)
  if (unread === 0) return { detail: count, tone: 'idle' }

  return { detail: `${w.unreadHub(unread)} · ${count}`, tone: 'live' }
}

// The card already written says the same: writing it again would only redraw the hub.
export function isSameLine(card: HubCard | undefined, shown: HubShown): boolean {
  return card !== undefined && isSame({ detail: card.detail, tone: card.tone }, shown)
}

export function isOpenFor(value: unknown, pane: string): boolean {
  return typeof value === 'object' && value !== null && (value as { pane?: unknown }).pane === pane
}
