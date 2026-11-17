// Box/Text colours for the pane: the kit's Tidemark palette plus the spec's `signal` role. The desktop takes hex;
// the terminal takes theme keys so it follows the person's own theme (DESIGN.md §2).
import { palette, ROLE_KEY } from './kit/tokens'
import type { Role } from './kit/tokens'

export type Tone = { fg?: string; tint?: string; line?: string }
// `loText`: quiet words. The desktop draws them dim in the app's own ink, so they read on whatever the panel is.
export type Look = {
  isText: boolean
  isLight: boolean
  // A palette the person pinned (MODZ_THEME): true light, false dark; absent, drawings follow the app.
  pin?: boolean
  loText: { color?: string; dimColor?: boolean }
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

const ROLES: readonly Role[] = ['read', 'edit', 'run', 'ok', 'warn', 'danger', 'plan']

// On the desktop the pane paints no ground and words take the app's own ink (no colour, or dim), so they read on any
// panel a skin paints, navy or paper. Only state keeps a hue, and only fills the pane draws in Svg carry a surface.
function desktopLook(isLight: boolean, pin: boolean | undefined): Look {
  const p = palette(isLight)
  return {
    isText: false, isLight, pin, loText: { dimColor: true },
    // The accent is the one colour of live state: Claude's clay (MODZ DESIGN.md §0), no tint of its own.
    signal: { fg: p.roles.edit.fg },
    role: p.roles,
  }
}

// The terminal has no tints: borders and text take the role's theme key, meta text the theme's inactive grey.
function terminalLook(isLight: boolean): Look {
  const role = Object.fromEntries(ROLES.map(r => [r, { fg: ROLE_KEY[r], line: ROLE_KEY[r] }])) as Record<Role, Tone>
  return {
    isText: true, isLight, lo: 'inactive', loText: { color: 'inactive' }, line: 'subtle', lineStrong: 'inactive',
    signal: { fg: 'planMode', line: 'planMode' },
    role,
  }
}

export const lookOf = (opts: { isText: boolean; isLight: boolean; pin?: boolean }): Look =>
  (opts.isText ? terminalLook(opts.isLight) : desktopLook(opts.isLight, opts.pin))

// One of six kit roles per person, from their uid, so a name keeps its colour in every room.
const AVATAR_ROLES: readonly Role[] = ['read', 'run', 'ok', 'plan', 'edit', 'warn']
const HASH_PRIME = 31

export function avatarRole(seed: string): Role {
  let h = 0
  for (const ch of seed) h = (h * HASH_PRIME + (ch.codePointAt(0) ?? 0)) >>> 0
  return AVATAR_ROLES[h % AVATAR_ROLES.length] ?? 'read'
}
