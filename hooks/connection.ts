// Whether this session may write to rooms (spike R1). The first artifact write of a session needs the person's
// approval, so nothing writes until they press "Bağlan" (or create a room, whose publish carries their command
// as consent). A session in `bypassPermissions` is connected from the start. Until then every write waits and
// says so with WAITING; reads never wait.

export const WAITING = 'bağlantı bekleniyor'

let isOn = false

export const isConnected = (): boolean => isOn

export function setConnected(is: boolean): void {
  isOn = is
}

export const isBypassMode = (mode: unknown): boolean => mode === 'bypassPermissions'
