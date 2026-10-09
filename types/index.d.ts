export type Receipt = 'pending' | 'sent' | 'delivered' | 'read'
export type GateBadge = 'open' | 'closed' | 'unknown'

// Structural view of a protocol message or an unreadable doc; Task 2's protocol types satisfy it.
export type LineMessage = { id: string; [key: string]: unknown }

// `seed` picks the author's avatar colour (their uid), the same in every room.
export type Line = {
  id: string; message: LineMessage; authorName: string; isMine: boolean; receipt?: Receipt; authorUid: string; seed: string
}

export type RoomView = {
  id: string
  title: string
  kind: 'dm' | 'project'
  unread: number
  lastText: string
  lastTs: number
  gate: GateBadge
  isLive: boolean
  url: string
  repo?: string
  // The peer's confirmed GitHub login (project rooms), shown beside the gate.
  ghLogin?: string
  seed: string
  // The room's last poll failed; it is tried again with backoff.
  isTroubled: boolean
  lastIsMine: boolean
  lastReceipt?: Receipt
  // A DM this person opened that no friend has joined yet.
  isWaiting: boolean
}

export type Draft = { roomId: string; qid: string; question: string; asker: string }
export type Invite = { id: string; title: string; kind?: 'dm' | 'project'; repo?: string }
export type PaneView = 'rooms' | 'chat' | 'add' | 'settings'
export type PaneSettings = { isReceiptsOn: boolean; isToastOn: boolean; isStatusOn: boolean }
// A room this session just opened, shown with the steps to invite the friend.
export type Created = { url: string; title: string }
export type GhAsk = { roomId: string; uid: string; gh: string; name: string }

export type PaneModel = {
  rooms: RoomView[]
  activeId: string | null
  lines: Line[]
  latencyMs: number | null
  error: string | null
  invites: Invite[]
  ghAsk: GhAsk | null
  drafts: Draft[]
  // True when the "Bağlan" card should show: an active room, and this session may not write yet.
  needsSetup: boolean
  isReceiptsOn: boolean
  view: PaneView
  isConnected: boolean
  settings: PaneSettings
  now: number
  // A long step in flight ("Oda açılıyor…"); the buttons that would start another wait.
  busy: string | null
  created: Created | null
  // Bumped after each send, so the composer comes back empty.
  composerKey: number
  canSettleDrafts: boolean
}

declare module 'claude-code' {
  interface PluginState {
    transceiver: {
      pane: PaneModel
    }
  }
}
