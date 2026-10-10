// Times as the pane says them: "14:03", "Today", "Yesterday", "Oct 9" (Turkish: "Bugün", "Dün", "9 Eki").
import { lang, pick, upper } from './kit/lang'

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  tr: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
}
const DAYS = { en: { today: 'Today', yesterday: 'Yesterday' }, tr: { today: 'Bugün', yesterday: 'Dün' } }
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

const daysAgo = (ts: number, now: number): number => Math.round((dayStart(now) - dayStart(ts)) / DAY_MS)

// "Oct 9" or "Oct 9, 2025" in English, "9 Eki" or "9 Eki 2025" in Turkish.
function dateText(ts: number, now: number): string {
  const d = new Date(ts)
  const month = pick(MONTHS)[d.getMonth()] ?? ''
  const isThisYear = d.getFullYear() === new Date(now).getFullYear()
  if (lang() === 'tr') return `${d.getDate()} ${month}${isThisYear ? '' : ` ${d.getFullYear()}`}`
  return `${month} ${d.getDate()}${isThisYear ? '' : `, ${d.getFullYear()}`}`
}

export function dayLabel(ts: number, now: number): string {
  const days = daysAgo(ts, now)
  if (days === 0) return pick(DAYS).today
  if (days === 1) return pick(DAYS).yesterday
  return dateText(ts, now)
}

// The day rule between messages: capitals in English ("TODAY"), Turkish as written ("Bugün").
export function dayRule(ts: number, now: number): string {
  const label = dayLabel(ts, now)
  return lang() === 'en' ? upper(label) : label
}

// The terminal's day rule, lower-cased in the interface's own casing.
export const dayLower = (ts: number, now: number): string => dayLabel(ts, now).toLocaleLowerCase(lang())

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const MS_PER_S = 1000

const AGO = {
  en: { now: 'just now', minutes: (n: number) => `${n}m ago`, hours: (n: number) => `${n}h ago`, yesterday: 'yesterday' },
  tr: { now: 'az önce', minutes: (n: number) => `${n} dk önce`, hours: (n: number) => `${n} sa önce`, yesterday: 'dün' },
}

// "just now", "3m ago", "2h ago", "yesterday", "Oct 6": how long ago, for a read mark or a check.
export function agoText(ts: number, now: number): string {
  const ms = Math.max(0, now - ts)
  const words = pick(AGO)
  if (ms < MINUTE_MS) return words.now
  if (ms < HOUR_MS) return words.minutes(Math.floor(ms / MINUTE_MS))
  const days = daysAgo(ts, now)
  if (days === 0) return words.hours(Math.floor(ms / HOUR_MS))
  return days === 1 ? words.yesterday : dayLabel(ts, now)
}

// "0.7s" in English; "0,7 sn" with a Turkish comma.
export function secondsText(ms: number): string {
  const text = (Math.max(0, ms) / MS_PER_S).toFixed(1)
  return lang() === 'tr' ? `${text.replace('.', ',')} sn` : `${text}s`
}

// A room row's time: the clock today, the day before that.
export function rowTime(ts: number, now: number): string {
  if (ts <= 0) return ''
  return daysAgo(ts, now) === 0 ? clockText(ts) : dayLabel(ts, now)
}
