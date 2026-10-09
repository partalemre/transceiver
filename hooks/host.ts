import type { McpToolResult, ModelCompleteRequest, ModelCompleteResult, Timer } from 'claude-code'

import type { RealPath, Run } from './run'

// What a tool call resolves to, as far as this mod reads it.
export type CallResult = { text?: string; isError?: boolean; deny?: string; result?: unknown }

// The engine's reach, bound in register.tsx: the engine follows `$` only into functions of the hooks module's own
// file, so every other module gets this port instead (the reflect-mod `io($)` pattern).
export type Host = {
  tool(input: Record<string, unknown>): Promise<CallResult>
  storeGet(key: string): Promise<unknown>
  storeSet(key: string, value: unknown): Promise<void>
  now(): Promise<number>
  after(ms: number, fn: () => void): Timer
  every(ms: number, fn: () => void): Timer
  home(): Promise<string | undefined>
  writeFile(path: string, text: string): Promise<void>
  log(text: string): void
  // The session's working directory: the Artifact tool publishes only files under it (or Claude's scratchpad).
  cwd(): Promise<string>
  isDir(path: string): Promise<boolean>
  // A file, or an empty directory; anything else is left alone.
  remove(path: string): Promise<void>
  // Whether this session may write to rooms yet (connection.ts; spike R1). The poll loop only reads until then.
  isConnected(): boolean
}

export type ToolHost = Pick<Host, 'tool'>

// The agent side's reach (T13–T14), bound beside Host in register.tsx: commands, files, the model, the session's
// own conversation. `isConnected` says whether this session may write yet (the pane's "Bağlan" press, spike R1).
export type AgentHost = Host & {
  run: Run
  realPath: RealPath
  readFile(path: string): Promise<string>
  root(): Promise<string>
  readState(plugin: string, key: string): Promise<unknown>
  mcpCall(server: string, tool: string, args?: Record<string, unknown>): Promise<McpToolResult>
  complete(request: ModelCompleteRequest): Promise<ModelCompleteResult>
  sleep(ms: number): Promise<void>
  sendSelf(text: string): Promise<boolean>
  note(text: string): Promise<void>
  toast(text: string): void
  isConnected(): boolean
}
