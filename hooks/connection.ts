// Whether this session may write to rooms (spike R1). The first artifact write of a session needs the person's
// approval, so nothing writes until they press "Bağlan" (or create a room, whose publish carries their command
// as consent). A session in `bypassPermissions` is connected from the start. Until then every write waits and
// says so with WAITING; reads never wait.

export const WAITING = 'bağlantı bekleniyor'

let isOn = false
let save: ((is: boolean) => void) | null = null

export const isConnected = (): boolean => isOn

// The flag is kept in the host's session state too, which outlives a hot reload of this module (a reload starts
// it at false again): `session.start` reads it back, so a reloaded session stays connected instead of waiting.
export function persistConnection(fn: (is: boolean) => void): void {
  save = fn
}

export function setConnected(is: boolean): void {
  isOn = is
  save?.(is)
}

// Brings back the flag a reload dropped. A failed read only means asking for "Bağlan" again; it never throws, so it
// cannot keep the session from starting.
export async function restoreConnection(read: () => Promise<{ value?: unknown }>): Promise<void> {
  const saved = await read().catch(() => null)
  if (saved?.value === true) isOn = true
}

export const isBypassMode = (mode: unknown): boolean => mode === 'bypassPermissions'
