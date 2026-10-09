import type { Timer } from 'claude-code'
import type { CallResult, Host } from '../hooks/host'

type Pending = { due: number; fn: () => void; every?: number; isCancelled: boolean }

// An in-memory Host: a store, a clock that moves only when `advance` moves it, recorded writes, tools and logs.
export type FakeHost = Host & {
  store: Map<string, unknown>; written: Record<string, string>; tools: Record<string, unknown>[]; logs: string[]
  clock: { now: number }; advance(ms: number): Promise<void>
}

const TURNS = 200
const clone = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)) as unknown)
const settle = async () => { for (let i = 0; i < TURNS; i++) await Promise.resolve() }

export function fakeHost(answer: (input: Record<string, unknown>) => Promise<CallResult>, now = 1_791_545_100_000): FakeHost {
  const timers: Pending[] = []
  const add = (ms: number, fn: () => void, every?: number): Timer => {
    const t: Pending = { due: host.clock.now + ms, fn, every, isCancelled: false }
    timers.push(t)
    return { cancel: () => { t.isCancelled = true } }
  }
  const host: FakeHost = {
    store: new Map(), written: {}, tools: [], logs: [], clock: { now },
    tool: async input => { host.tools.push(input); return answer(input) },
    storeGet: async key => clone(host.store.get(key)),
    storeSet: async (key, value) => { host.store.set(key, clone(value)) },
    now: async () => host.clock.now,
    after: (ms, fn) => add(ms, fn),
    every: (ms, fn) => add(ms, fn, ms),
    home: async () => '/home/u',
    writeFile: async (path, text) => { host.written[path] = text },
    log: text => { host.logs.push(text) },
    advance: async ms => {
      const end = host.clock.now + ms
      await settle()
      for (;;) {
        const next = timers.filter(t => !t.isCancelled && t.due <= end).sort((a, b) => a.due - b.due)[0]
        if (next === undefined) break
        host.clock.now = Math.max(host.clock.now, next.due)
        if (next.every === undefined) next.isCancelled = true
        else next.due += next.every
        next.fn()
        await settle()
      }
      host.clock.now = end
    },
  }
  return host
}
