// Message words laid into lines for a drawing: the writer's own line breaks kept, a word wider than the line (a
// path, a link) broken where it must instead of cut, and a very long message ended with "…" past MAX_LINES.
import type { Measure } from './kit/svg-metrics'
import { fitText } from './kit/svg-metrics'

const MAX_LINES = 40

// A word wider than `max` in pieces that fit.
function pieces(word: string, o: { max: number; measure: Measure }): string[] {
  if (o.measure(word) <= o.max) return [word]
  const out: string[] = []
  let piece = ''
  for (const ch of word) {
    if (piece !== '' && o.measure(piece + ch) > o.max) {
      out.push(piece)
      piece = ''
    }
    piece += ch
  }
  return piece === '' ? out : [...out, piece]
}

function paragraph(text: string, o: { max: number; measure: Measure }): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/[ \t]+/).filter(Boolean).flatMap(w => pieces(w, o))) {
    const next = line === '' ? word : `${line} ${word}`
    if (line !== '' && o.measure(next) > o.max) {
      lines.push(line)
      line = word
    } else line = next
  }
  return [...lines, line]
}

export function wrapLines(text: string, o: { max: number; measure: Measure; maxLines?: number }): string[] {
  const cap = o.maxLines ?? MAX_LINES
  const lines = text.replace(/\r/g, '').trim().split('\n').flatMap(p => paragraph(p, o))
  if (lines.length <= cap) return lines
  return [...lines.slice(0, cap - 1), fitText(`${lines[cap - 1] ?? ''} …`, o.max, o.measure)]
}
