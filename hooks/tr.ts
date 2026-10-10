// Turkish endings after a name, by its last vowel and whether it ends in one: Alperen'in, Emre'nin, Can'ın,
// Oğuz'un, Ömür'ün (whose); Alperen'e, Emre'ye, Can'a (to whom).
const VOWELS = 'aeıioöuü'
const BACK = 'aıou'

type Shape = { last: string; endsInVowel: boolean }

function shapeOf(name: string): Shape {
  const lower = [...name.toLocaleLowerCase('tr')]
  const last = lower.filter(c => VOWELS.includes(c)).at(-1) ?? 'e'
  return { last, endsInVowel: VOWELS.includes(lower.at(-1) ?? '') }
}

function genitiveVowel(last: string): string {
  if ('aı'.includes(last)) return 'ı'
  if ('ei'.includes(last)) return 'i'
  return 'ou'.includes(last) ? 'u' : 'ü'
}

export function genitive(name: string): string {
  const { last, endsInVowel } = shapeOf(name)
  return `${name}'${endsInVowel ? 'n' : ''}${genitiveVowel(last)}n`
}

export function dative(name: string): string {
  const { last, endsInVowel } = shapeOf(name)
  return `${name}'${endsInVowel ? 'y' : ''}${BACK.includes(last) ? 'a' : 'e'}`
}

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name

// English's own ending for whose: Leo's, James'.
export const possessive = (name: string): string => (/s$/i.test(name) ? `${name}'` : `${name}'s`)
