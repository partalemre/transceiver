import { parseArtifactUrls } from './dbtext'
import type { Host } from './host'
import { callerOf, relayOf } from './relay'
import { pokeRoom } from './room-loop'
import { createRoom, failText, homeOf, loadRooms, saveRooms, withBox, type RoomRecord } from './rooms'
import { stepWords } from './words-steps'

export type Joined = { text: string; room?: RoomRecord; isNew: boolean }

export const shareBack = (): string => stepWords().shareBack

export function joinUrlOf(text: string): string | null {
  const trimmed = text.trim()
  const urls = parseArtifactUrls(trimmed)
  return urls.length === 1 && trimmed === urls[0] ? urls[0] : null
}

async function saveRoom(host: Host, room: RoomRecord): Promise<void> {
  const rooms = await loadRooms(host)
  await saveRooms(host, [...rooms.filter(r => r.id !== room.id && !(r.status === 'invited' && r.room === room.room)), room])
  pokeRoom(host, room)
}

// Accepting an invite publishes this person's own mailbox for the room; `consent` is their press or command.
export async function acceptInvite(opts: { host: Host; invite: RoomRecord; consent: string }): Promise<RoomRecord> {
  const { host, invite } = opts
  const own = await createRoom({ host, kind: invite.kind, repo: invite.repo, room: invite.room, boxes: invite.boxes, consent: opts.consent })
  const room = { ...own, id: invite.id, peers: invite.peers }
  await saveRoom(host, room)
  return room
}

// Invites from another organization never show in the shared list (spike R3), so a friend there joins by link, and
// the room's other members add this person's mailbox the same way. A link is a mailbox only if its meta parses; the
// person typed the link, so it needs no extra yes. A link to a room they are already in adds that member's mailbox;
// any other link joins its room, which publishes their own mailbox for it.
export async function joinRoom(host: Host, text: string, consent?: string): Promise<Joined> {
  const url = joinUrlOf(text)
  if (url === null) return { text: stepWords().joinUsage, isNew: false }
  const rooms = (await loadRooms(host)).filter(r => r.status === 'active')
  const held = rooms.find(r => r.url === url || r.boxes.includes(url))
  if (held !== undefined) return { text: stepWords().alreadyIn, room: held, isNew: false }
  const meta = await relayOf(callerOf(host), url).meta().catch((err: unknown) => err as Error)
  if (meta instanceof Error) return { text: failText(meta, stepWords().notABox), isNew: false }
  if (meta === null) return { text: stepWords().notABox, isNew: false }
  const home = homeOf(rooms, { url, meta })
  if (home !== undefined) {
    const room = withBox(home, url)
    await saveRoom(host, room)
    return { text: stepWords().boxAdded(room.title), room, isNew: false }
  }
  if (rooms.some(r => r.room === meta.room)) return { text: stepWords().dmTaken, isNew: false }
  const said = consent ?? `The user ran "/transceiver ${stepWords().joinVerb} ${url}"`
  const room = await createRoom({ host, kind: meta.kind, repo: meta.repo, room: meta.room, boxes: [url], consent: said }).catch((err: unknown) => err as Error)
  if (room instanceof Error) return { text: failText(room, stepWords().joinFailed), isNew: false }
  await saveRoom(host, room)
  return { text: `${stepWords().joined({ title: room.title, url: room.url })}\n${shareBack()}`, room, isNew: true }
}
