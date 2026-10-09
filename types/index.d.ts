export type Receipt = 'pending' | 'sent' | 'delivered' | 'read'
export type GateBadge = 'open' | 'closed' | 'unknown'

// Structural view of a protocol message or an unreadable doc; Task 2's protocol types satisfy it.
export type LineMessage = { id: string; [key: string]: unknown }

// `seed` picks the author's avatar colour (their uid), the same in every room.
// `replyTo`: the message this one answers, as the person sees it; `roomLink`: a shared project room a DM names.
export type Line = {
  id: string; message: LineMessage; authorName: string; isMine: boolean; receipt?: Receipt; authorUid: string; seed: string
  replyTo?: { name: string; text: string }
  roomLink?: { roomId: string; repo: string }
}

// A project room's gate as this side last knew it: the four conditions the responder checks. `isCollaborator` is
// GitHub's last answer to the gate itself (null until it asked, on the first query); `isSessionRepo` is null while
// the session's repo is not known.
export type GateChecks = {
  isConfirmed: boolean
  login?: string
  isCollaborator: boolean | null
  checkedAt: number | null
  isSessionRepo: boolean | null
}
// What this machine answered in the room today: every answer, those with no model, and the refusals.
export type DayCounts = { answered: number; modelless: number; denied: number }
export type ProjectInfo = { checks: GateChecks; askUsed: number; askLimit: number; today: DayCounts; queriesToday: number }

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
  // The other person (first peer), for copy ("Alperen'e yaz"); absent until someone joined.
  peerName?: string
  // The peer's head: when it last moved (a send or a read mark) and when they last read; 0 when unknown.
  peerSeenTs: number
  peerReadTs: number
  project?: ProjectInfo
}

export type Draft = { roomId: string; qid: string; question: string; asker: string }
export type Invite = { id: string; title: string; kind?: 'dm' | 'project'; repo?: string; url?: string; joinedAt?: number }
export type PaneView = 'rooms' | 'chat' | 'add' | 'settings'
export type PaneSettings = { isReceiptsOn: boolean; isToastOn: boolean; isStatusOn: boolean }
// A room this session just opened, shown with the steps to invite the friend.
export type Created = { url: string; title: string }
// `repos`: what the gate last heard from GitHub about this login, per shared project room (when it asked).
export type GhAsk = { roomId: string; uid: string; gh: string; name: string; repos?: Array<{ repo: string; isCollaborator: boolean }> }

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
  // Where "n yeni mesaj" goes in the open chat: the first message that was unread when the room was opened.
  divider: { id: string; count: number } | null
  // Messages written while the session may not write yet, oldest first (the "Bağlan" card lists them).
  waiting: string[]
  // Answers the person opened in full ("Göster").
  expanded: string[]
  // The open chat's composer: the query type the field is set to, whether the menu of every query is open, and a
  // one-line hint under the field (an unknown slash command, a missing value).
  composeMode: string | null
  isSheetOpen: boolean
  hint: string | null
  // The session's GitHub repo (its git origin), offered as a new project room's name; null outside one.
  sessionRepo: string | null
}

declare module 'claude-code' {
  interface PluginState {
    transceiver: {
      pane: PaneModel
    }
  }
}
