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

// A room row's time: the clock today, the day before that.
export const rowTime = (ts: number, now: number): string => (ts <= 0 ? '' : dayLabel(ts, now) === 'Bugün' ? clockText(ts) : dayLabel(ts, now))
