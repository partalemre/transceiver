// Times as the pane says them, in Turkish: "14:03", "Bugün", "Dün", "9 Eki".

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const DAY_MS = 86_400_000
const PAD = 2

const two = (n: number) => String(n).padStart(PAD, '0')

export const clockText = (ts: number): string => {
  const d = new Date(ts)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

const dayStart = (ts: number): number => {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export const dayKey = (ts: number): number => dayStart(ts)

export function dayLabel(ts: number, now: number): string {
  const days = Math.round((dayStart(now) - dayStart(ts)) / DAY_MS)
  if (days === 0) return 'Bugün'
  if (days === 1) return 'Dün'
  const d = new Date(ts)
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}${year}`
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const MS_PER_S = 1000

// "az önce", "3 dk önce", "2 sa önce", "dün", "6 Eki": how long ago, for a read mark or a check.
export function agoText(ts: number, now: number): string {
  const ms = Math.max(0, now - ts)
  if (ms < MINUTE_MS) return 'az önce'
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} dk önce`
  const day = dayLabel(ts, now)
  if (day === 'Bugün') return `${Math.floor(ms / HOUR_MS)} sa önce`
  return day === 'Dün' ? 'dün' : day
}

// "0,7 sn": seconds with one decimal and a Turkish comma.
export const secondsText = (ms: number): string => `${(Math.max(0, ms) / MS_PER_S).toFixed(1).replace('.', ',')} sn`

// A room row's time: the clock today, the day before that.
export function rowTime(ts: number, now: number): string {
  if (ts <= 0) return ''
  const day = dayLabel(ts, now)
  return day === 'Bugün' ? clockText(ts) : day
}
