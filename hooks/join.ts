import { parseArtifactUrls } from './dbtext'
import type { Host } from './host'
import { callerOf, relayOf } from './relay'
import { pokeRoom } from './room-loop'
import { loadRooms, recordOf, saveRooms } from './rooms'

export function joinUrlOf(text: string): string | null {
  const trimmed = text.trim()
  const urls = parseArtifactUrls(trimmed)
  return urls.length === 1 && trimmed === urls[0] ? urls[0] : null
}

// Invites from another organization never show in the shared list (spike R3), so a friend there joins by link.
// A link is a room only if its meta doc parses; the person typed the link, so joining needs no extra yes. Joining
// only reads: the session's first write waits for the pane's connect press (T8).
export async function joinRoom(host: Host, text: string): Promise<string> {
  const url = joinUrlOf(text)
  if (url === null) return 'Kullanım: /transceiver katıl <https://claude.ai/artifact/…>'
  const rooms = await loadRooms(host)
  if (rooms.some(r => r.url === url && r.status === 'active')) return 'Bu odaya zaten katıldın.'
  const meta = await relayOf(callerOf(host), url).meta().catch(() => null)
  if (meta === null) return 'Bu link bir Transceiver odası değil ya da sana paylaşılmamış.'
  const room = recordOf({ url, meta, now: await host.now(), status: 'active' })
  await saveRooms(host, [...rooms.filter(r => r.url !== url), room])
  pokeRoom(host, room)
  return `${room.title} odasına katıldın.`
}
