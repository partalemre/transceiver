import type { Host } from './host'
import { SOUND_FRESH_MS, SOUND_GAP_MS } from './limits'
import { isUnreadable } from './protocol'
import { onTick, type TickEvent } from './room-loop'
import { loadSettings } from './rooms'

// A soft sound for someone else's new message. Every open session polls the same rooms, so the store says which message
// has already rung on this computer: one sound per message, however many sessions are open.
const RUNG_KEY = 'tx.sound.rung'

type Rung = { id: string; at: number }

function newestToRing(ev: TickEvent, now: number): string | null {
  const ids = ev.fresh.flatMap(e => {
    const m = e.message
    if (isUnreadable(m) || now - m.ts > SOUND_FRESH_MS) return []
    return m.kind === 'human' || (m.kind === 'agent' && ev.room.kind === 'devices') ? [m.id] : []
  })
  return ids.sort().at(-1) ?? null
}

export async function onSoundTick(host: Host, ev: TickEvent): Promise<boolean> {
  const now = await host.now()
  const id = newestToRing(ev, now)
  if (id === null || !(await loadSettings(host)).isSoundOn) return false
  const rung = (await host.storeGet(RUNG_KEY)) as Rung | null | undefined
  if (rung != null && (rung.id >= id || now - rung.at < SOUND_GAP_MS)) return false
  await host.storeSet(RUNG_KEY, { id, at: now })
  await host.ding()
  return true
}

export function wireSound(host: Host): () => void {
  return onTick(ev => onSoundTick(host, ev).then(() => undefined, () => undefined))
}
