import type { Timer } from 'claude-code'

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
}

export type ToolHost = Pick<Host, 'tool'>
