// Answer bodies and room notices travel between peers in one fixed wording (Turkish, as the first version wrote
// them), because the other side parses them: a refusal is DENIED, an empty answer one of the NONE words, a
// commit's stat "3 dosya · +41 -12", a moved mailbox MOVED + its link. The wire never changes with the reader's
// language; only what this side shows does. In Turkish a body is shown as it came; in English the known phrases
// are put into English and anything else (code, paths, the other side's own text) stays as written.
import { lang } from './kit/lang'

const SENTENCES: Record<string, string> = {
  'erişim yok': 'No access',
  'kayıt yok': 'Nothing yet',
  'değişiklik yok': 'No changes',
  'eşleşme yok': 'No matches',
  'dosya yok': 'No files',
  'bağımlılık dosyası yok': 'No dependency files',
  'boş': 'Empty',
}

const PHRASES: Array<[RegExp, string]> = [
  [/(\d+) değişen dosya/g, '$1 changed files'],
  [/… ilk (\d+) eşleşme; aramayı daralt/g, '… first $1 matches; narrow the search'],
  [/ \(ilk (\d+) dosya\)/g, ' (first $1 files)'],
  [/(\d+) dosya · ilk (\d+)/g, '$1 files · first $2'],
  [/… (\d+) dosya daha/g, '… $1 more files'],
  [/… (\d+) not daha/g, '… $1 more notes'],
  [/… (\d+) daha/g, '… $1 more'],
  [/\(ikili\)/g, '(binary)'],
  [/…\[kırpıldı\]/g, '…[cut]'],
  [/^(\d+) dosya\b/gm, '$1 files'],
]

// The wire's words for the person reading them.
export function shownWire(text: string): string {
  if (lang() === 'tr') return text
  const whole = SENTENCES[text.trim()]
  if (whole !== undefined) return whole
  return PHRASES.reduce((out, [re, to]) => out.replace(re, to), text)
}

// A moved mailbox's notice on the wire: MOVED and the new mailbox's link (retention.ts writes and reads it).
export const MOVED = 'Kutu doldu, yeni kutu: '

// That notice as the system line the chat shows.
export function shownSystem(text: string): string {
  if (lang() === 'tr' || !text.startsWith(MOVED)) return text
  return `Mailbox full, new mailbox: ${text.slice(MOVED.length)}`
}
