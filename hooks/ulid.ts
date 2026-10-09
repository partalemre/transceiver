const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const BASE = 32
const TIME_LEN = 10
const RANDOM_LEN = 16

export type Random = () => number

export function newId(now: number, random: Random = Math.random): string {
  let time = ''
  let rest = Math.floor(now)
  for (let i = 0; i < TIME_LEN; i++) {
    time = ALPHABET[rest % BASE] + time
    rest = Math.floor(rest / BASE)
  }
  let tail = ''
  for (let i = 0; i < RANDOM_LEN; i++) tail += ALPHABET[Math.floor(random() * BASE) % BASE]
  return time + tail
}

export function idTime(id: string): number {
  let time = 0
  for (const ch of id.slice(0, TIME_LEN)) time = time * BASE + ALPHABET.indexOf(ch)
  return time
}
