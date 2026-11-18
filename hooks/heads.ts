// A head as a room stores it. The cursors and the keys stay in clear: the poll compares the cursors before it reads
// anything, and the keys are how the others seal to this person. Who they are (GitHub login, name), their branch and
// when they last worked are sealed to the room's members like a message (seal.ts).
import { parseHead, type Head } from './protocol'
import { open, seal } from './seal'

const PERSONAL = ['gh', 'label', 'at', 'branch'] as const

export function sealHead(head: Head, to: readonly string[]): Record<string, unknown> {
  const clear: Record<string, unknown> = { ...head }
  const personal: Record<string, unknown> = {}
  for (const field of PERSONAL) {
    if (head[field] !== undefined) personal[field] = head[field]
    delete clear[field]
  }
  return Object.keys(personal).length === 0 ? clear : { ...clear, sealed: seal(personal, to) }
}

// A head whose personal part is not sealed to this computer reads without it. Fields stored in clear (a head
// written before sealing) still read, and the next write of the head seals them.
export function openHead(raw: unknown): Head | null {
  if (typeof raw !== 'object' || raw === null || !('sealed' in raw)) return parseHead(raw)
  const { sealed, ...clear } = raw as Record<string, unknown>
  const inner = open(sealed)
  const personal = typeof inner === 'object' && inner !== null ? inner as Record<string, unknown> : {}
  const picked = Object.fromEntries(PERSONAL.filter(f => personal[f] !== undefined).map(f => [f, personal[f]]))
  return parseHead({ ...clear, ...picked })
}

export const hasClearPersonal = (raw: unknown): boolean =>
  typeof raw === 'object' && raw !== null && PERSONAL.some(f => f in raw)
