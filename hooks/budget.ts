import type { Host } from './host'
import { ASK_DAILY_LIMIT } from './limits'

export type BudgetState = { day: string; byRoom: Record<string, number> }
type Take = { isAllowed: boolean; counts: BudgetState }

const KEY = 'tx.budget'
const DAY_DIGITS = 2

const isBudget = (x: unknown): x is BudgetState =>
  typeof x === 'object' && x !== null && typeof (x as BudgetState).day === 'string' &&
  typeof (x as BudgetState).byRoom === 'object' && (x as BudgetState).byRoom !== null

// Pure: ten asks per room per day; a new day starts every room at zero.
export function takeBudget(opts: { counts: BudgetState; roomId: string; day: string }): Take {
  const counts = opts.counts.day === opts.day ? opts.counts : { day: opts.day, byRoom: {} }
  const used = counts.byRoom[opts.roomId] ?? 0
  if (used >= ASK_DAILY_LIMIT) return { isAllowed: false, counts }
  return { isAllowed: true, counts: { ...counts, byRoom: { ...counts.byRoom, [opts.roomId]: used + 1 } } }
}

// The person's local calendar day: the limit resets at their midnight.
export function localDay(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(DAY_DIGITS, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Spends one ask of the room's day when one is left. The count lives in the store, so a reload does not reset it.
export async function spendAsk(host: Pick<Host, 'storeGet' | 'storeSet' | 'now'>, roomId: string): Promise<boolean> {
  const raw = await host.storeGet(KEY)
  const counts = isBudget(raw) ? raw : { day: '', byRoom: {} }
  const out = takeBudget({ counts, roomId, day: localDay(await host.now()) })
  if (out.isAllowed) await host.storeSet(KEY, out.counts)
  return out.isAllowed
}
