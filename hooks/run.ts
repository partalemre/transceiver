import { RUN_TIMEOUT_MS } from './limits'

export type RunResult = { exitCode: number; stdout: string; stderr: string }
export type Run = (argv: string[], init?: { cwd?: string; timeoutMs?: number }) => Promise<RunResult>
// Absolute path with every link and `..` resolved, or null when it leads nowhere.
export type RealPath = (abs: string) => Promise<string | null>

// The engine's calls as register.tsx hands them over: `$` itself never leaves that file (the engine refuses a
// module that passes it into an imported function).
export type ProcessRun = (argv: string[], init: { cwd?: string; timeoutMs?: number }) => Promise<RunResult>
export type StatResolve = (abs: string) => Promise<{ realPath?: string }>

export function runnerOf(processRun: ProcessRun): Run {
  return async (argv, init) => {
    const out = await processRun(argv, { timeoutMs: RUN_TIMEOUT_MS, ...init })
    return { exitCode: out.exitCode, stdout: out.stdout, stderr: out.stderr }
  }
}

// The engine's own resolver (`$.fs.stat(p, { resolve: true })`): no binary on PATH needed, same answer as realpath(1).
export function realPathOf(stat: StatResolve): RealPath {
  return async abs => {
    const out = await stat(abs).catch(() => undefined)
    return out?.realPath ?? null
  }
}
