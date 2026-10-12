// Counted nouns. English inflects ("1 file", "3 files"); Turkish keeps the noun as it is after a number
// ("3 dosya"), so a Turkish table passes the same word twice.
import { pick } from './kit/lang'

export const countOf = (n: number, o: { one: string; many: string }): string => `${n} ${n === 1 ? o.one : o.many}`

// "0 tokens", "1 token"; "0 token" in Turkish.
export const tokensText = (n: number): string => countOf(n, pick({ en: { one: 'token', many: 'tokens' }, tr: { one: 'token', many: 'token' } }))
