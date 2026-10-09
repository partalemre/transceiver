import type { EngineInterface } from 'claude-code'

import { RUN_TIMEOUT_MS } from './limits'

export type RunResult = { exitCode: number; stdout: string; stderr: string }
export type Run = (argv: string[], init?: { cwd?: string; timeoutMs?: number }) => Promise<RunResult>
// Absolute path with every link and `..` resolved, or null when it leads nowhere.
export type RealPath = (abs: string) => Promise<string | null>

export function runnerOf($: EngineInterface): Run {
  return async (argv, init) => {
    const out = await $.process.run(argv, { timeoutMs: RUN_TIMEOUT_MS, ...init })
    return { exitCode: out.exitCode, stdout: out.stdout, stderr: out.stderr }
  }
}

// The engine's own resolver: no binary on PATH needed, same answer as realpath(1).
export function realPathOf($: EngineInterface): RealPath {
  return async abs => {
    const stat = await $.fs.stat(abs, { resolve: true }).catch(() => undefined)
    return stat?.realPath ?? null
  }
}
