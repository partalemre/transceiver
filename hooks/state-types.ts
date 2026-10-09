import type { PaneModel } from '../types'

export type { Receipt, GateBadge, Line, RoomView, Draft, Invite, GhAsk, PaneModel } from '../types'

export const EMPTY_PANE: PaneModel = {
  rooms: [], activeId: null, lines: [], latencyMs: null, error: null,
  invites: [], ghAsk: null, drafts: [], needsSetup: false, isReceiptsOn: true,
}
