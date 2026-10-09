// Box/Text colours for the pane: the kit's Tidemark palette plus the spec's `signal` role. The desktop takes hex;
// the terminal takes theme keys so it follows the person's own theme (DESIGN.md §2).
import { palette, ROLE_KEY } from './kit/tokens'
import type { Role } from './kit/tokens'

export type Tone = { fg?: string; tint?: string; line?: string }
export type Look = {
  isText: boolean
  isLight: boolean
  hi?: string
  mid?: string
  lo?: string
  line?: string
  lineStrong?: string
  card?: string
  inset?: string
  sheet?: string
  track?: string
  signal: Tone
  role: Record<Role, Tone>
}

const SIGNAL = {
  dark: { fg: '#5CC8B8', tint: '#1A2E2B', line: '#2E5650' },
  light: { fg: '#0E6F66', tint: '#E3F3F0', line: '#A9D8CF' },
} as const

const ROLES: readonly Role[] = ['read', 'edit', 'run', 'ok', 'warn', 'danger', 'plan']

function desktopLook(isLight: boolean): Look {
  const p = palette(isLight)
  return {
    isText: false, isLight,
    hi: p.hi, mid: p.mid, lo: p.lo, line: p.line, lineStrong: p.lineStrong, card: p.card, inset: p.inset,
    sheet: p.sheet, track: p.track,
    signal: isLight ? SIGNAL.light : SIGNAL.dark,
    role: p.roles,
  }
}

// The terminal has no tints: borders and text take the role's theme key, meta text the theme's inactive grey.
function terminalLook(isLight: boolean): Look {
  const role = Object.fromEntries(ROLES.map(r => [r, { fg: ROLE_KEY[r], line: ROLE_KEY[r] }])) as Record<Role, Tone>
  return {
    isText: true, isLight, lo: 'inactive', line: 'subtle', lineStrong: 'inactive',
    signal: { fg: 'planMode', line: 'planMode' },
    role,
  }
}

export const lookOf = (opts: { isText: boolean; isLight: boolean }): Look =>
  (opts.isText ? terminalLook(opts.isLight) : desktopLook(opts.isLight))

// One of six kit roles per person, from their uid, so a name keeps its colour in every room.
const AVATAR_ROLES: readonly Role[] = ['read', 'run', 'ok', 'plan', 'edit', 'warn']
const HASH_PRIME = 31

export function avatarRole(seed: string): Role {
  let h = 0
  for (const ch of seed) h = (h * HASH_PRIME + (ch.codePointAt(0) ?? 0)) >>> 0
  return AVATAR_ROLES[h % AVATAR_ROLES.length] ?? 'read'
}

// "Alperen Yılmaz" → "AY", "alperenx" → "A"; Turkish casing, so "ilker" → "İ".
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words.at(-1)] : [words[0]]
  return letters.map(w => [...(w ?? '')][0] ?? '').join('').toLocaleUpperCase('tr') || '·'
}
