export type Receipt = 'pending' | 'sent' | 'delivered' | 'read'
export type GateBadge = 'open' | 'closed' | 'unknown'

// Structural view of a protocol message or an unreadable doc; Task 2's protocol types satisfy it.
export type LineMessage = { id: string; [key: string]: unknown }

export type Line = { id: string; message: LineMessage; authorName: string; isMine: boolean; receipt?: Receipt }

export type RoomView = {
  id: string
  title: string
  kind: 'dm' | 'project'
  unread: number
  lastText: string
  lastTs: number
  gate: GateBadge
  isLive: boolean
}

export type Draft = { roomId: string; qid: string; question: string; asker: string }
export type Invite = { id: string; title: string }
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
  needsSetup: boolean
  isReceiptsOn: boolean
}

declare module 'claude-code' {
  interface PluginState {
    transceiver: {
      pane: PaneModel
    }
  }
}
