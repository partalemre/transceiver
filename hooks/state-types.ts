import type { PaneModel } from '../types'

export type {
  Receipt, GateBadge, Line, RoomView, Draft, Invite, GhAsk, PaneModel, PaneView, EmptyForm, PaneSettings, Created, GateChecks, DayCounts,
  ProjectInfo,
} from '../types'

export const EMPTY_PANE: PaneModel = {
  rooms: [], activeId: null, lines: [], error: null,
  invites: [], ghAsk: null, drafts: [], needsSetup: false, isReceiptsOn: true,
  view: 'rooms', isConnected: false, settings: { isReceiptsOn: true, isToastOn: true, isStatusOn: true },
  now: 0, busy: null, created: null, composerKey: 0, canSettleDrafts: false, divider: null, waiting: [], expanded: [],
  composeMode: null, isSheetOpen: false, hint: null, sessionRepo: null, emptyForm: null, isInfoOpen: false,
}
