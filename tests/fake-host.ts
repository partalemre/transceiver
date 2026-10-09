import type { Timer } from 'claude-code'
import { isConnected } from '../hooks/connection'
import type { CallResult, Host } from '../hooks/host'

type Pending = { due: number; fn: () => void; every?: number; isCancelled: boolean }

// A manual clock and its timers. Several hosts may share one (the E2E test runs two people's mods on it), so a
// sleep in one moves time for all.
export type Scheduler = {
  clock: { now: number }
  add(ms: number, fn: () => void, every?: number): Timer
  advance(ms: number): Promise<void>
}

const TURNS = 200
const clone = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)) as unknown)
const settle = async () => { for (let i = 0; i < TURNS; i++) await Promise.resolve() }

export function scheduler(now = 1_791_545_100_000): Scheduler {
  const timers: Pending[] = []
  const s: Scheduler = {
    clock: { now },
    add: (ms, fn, every) => {
      const t: Pending = { due: s.clock.now + ms, fn, every, isCancelled: false }
      timers.push(t)
      return { cancel: () => { t.isCancelled = true } }
    },
    advance: async ms => {
      const end = s.clock.now + ms
      await settle()
      for (;;) {
        const next = timers.filter(t => !t.isCancelled && t.due <= end).sort((a, b) => a.due - b.due)[0]
        if (next === undefined) break
        s.clock.now = Math.max(s.clock.now, next.due)
        if (next.every === undefined) next.isCancelled = true
        else next.due += next.every
        next.fn()
        await settle()
      }
      s.clock.now = Math.max(s.clock.now, end)
    },
  }
  return s
}

// An in-memory Host: a store, a clock that moves only when `advance` moves it, recorded writes, tools and logs.
export type FakeHost = Host & {
  store: Map<string, unknown>; written: Record<string, string>; tools: Record<string, unknown>[]; logs: string[]
  cwdPath: string; dirs: Set<string>; removed: string[]
  clock: { now: number }; advance(ms: number): Promise<void>
}

export function fakeHost(answer: (input: Record<string, unknown>) => Promise<CallResult>, at: number | Scheduler = 1_791_545_100_000): FakeHost {
  const sched = typeof at === 'number' ? scheduler(at) : at
  const host: FakeHost = {
    store: new Map(), written: {}, tools: [], logs: [], clock: sched.clock, cwdPath: '/w', dirs: new Set(['/w/.git']), removed: [],
    tool: async input => { host.tools.push(input); return answer(input) },
    storeGet: async key => clone(host.store.get(key)),
    storeSet: async (key, value) => { host.store.set(key, clone(value)) },
    now: async () => sched.clock.now,
    after: (ms, fn) => sched.add(ms, fn),
    every: (ms, fn) => sched.add(ms, fn, ms),
    home: async () => '/home/u',
    writeFile: async (path, text) => { host.written[path] = text },
    log: text => { host.logs.push(text) },
    cwd: async () => host.cwdPath,
    isDir: async path => host.dirs.has(path),
    remove: async path => { host.removed.push(path) },
    isConnected: () => isConnected(),
    advance: ms => sched.advance(ms),
  }
  return host
}
