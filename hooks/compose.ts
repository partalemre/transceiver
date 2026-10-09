// The composer's sends: a plain message, a slash command (`/diff`, `/file src/a.ts`, `/ask neden?`), the query
// mode a menu row puts the field in, and the chips. Every query goes the way an agent's `ask` tool sends one: a
// `query` message, checked by the protocol's own guard, that the other side's responder answers.
import { MAX_TEXT_BYTES } from './limits'
import { isRepo, utf8Bytes, type Message } from './protocol'
import { composeOf, isModeType, queryMessage, specOf, type Composed } from './query-menu'
import { enqueueMessage } from './room-loop'
import { loadRooms, type RoomRecord } from './rooms'
import { patchSession, sessionNow, type PanePort } from './state'
import { newId } from './ulid'

export const SAY_COMPOSE = {
  tooLong: 'Mesaj çok uzun (en fazla 16 KB).',
  onlyProject: 'Agent\'a soru yalnızca proje odalarında sorulur.',
  notLoaded: 'Oda henüz yüklenmedi; birazdan tekrar dene.',
  badQuery: 'Bu sorgu gönderilemedi: değeri eksik ya da geçersiz.',
}

// What the composer holds per room, as typed: the send button sends it (the field's own Enter sends too).
const typed = new Map<string, string>()
export const setTyped = (roomId: string, text: string): void => { typed.set(roomId, text) }
export const typedOf = (roomId: string): string => typed.get(roomId) ?? ''

async function activeRoom(p: PanePort, id: string): Promise<RoomRecord | undefined> {
  return (await loadRooms(p.host)).find(r => r.id === id && r.status === 'active')
}

function composedOf(roomId: string, text: string): Composed {
  const mode = sessionNow().composeMode
  if (mode?.roomId === roomId) return { kind: 'query', type: mode.type, ...(text === '' ? {} : { arg: text }) }
  return composeOf(text)
}

async function messageFor(p: PanePort, o: { room: RoomRecord; composed: Composed }): Promise<Message | string> {
  const now = await p.host.now()
  const { composed, room } = o
  if (composed.kind === 'hint') return composed.text
  if (composed.kind === 'text') return { v: 1, id: newId(now), ts: now, kind: 'human', text: composed.text }
  if (room.kind !== 'project' || !isRepo(room.repo)) return SAY_COMPOSE.onlyProject
  return queryMessage({ id: newId(now), ts: now, repo: room.repo, type: composed.type, arg: composed.arg }) ?? SAY_COMPOSE.badQuery
}

// Shown at once as pending; the room's loop sends it, or keeps it waiting until the session is connected. A
// slash the composer does not know is answered with a hint under the field and never sent.
export async function sendComposed(p: PanePort, opts: { roomId: string; text: string }): Promise<void> {
  const text = opts.text.trim()
  const room = await activeRoom(p, opts.roomId)
  const composed = composedOf(opts.roomId, text)
  if (room === undefined || (composed.kind === 'text' && text === '')) return
  if (utf8Bytes(text) > MAX_TEXT_BYTES) return patchSession({ error: SAY_COMPOSE.tooLong })
  const message = await messageFor(p, { room, composed })
  if (typeof message === 'string') return patchSession({ hint: message })
  if (!enqueueMessage({ host: p.host, room, message })) return patchSession({ error: SAY_COMPOSE.notLoaded })
  typed.delete(room.id)
  patchSession({ error: null, hint: null, composeMode: null, sheetRoom: null, composerKey: sessionNow().composerKey + 1 })
}

// A chip or a menu row: a type with no argument goes at once; one that takes an argument puts the field in its
// mode (its placeholder, a removable chip) and Enter sends it.
export async function askAgent(p: PanePort, opts: { roomId: string; type: string }): Promise<void> {
  const spec = specOf(opts.type)
  if (spec === undefined) return
  if (isModeType(spec.type)) {
    return patchSession({ composeMode: { roomId: opts.roomId, type: spec.type }, sheetRoom: null, hint: null, composerKey: sessionNow().composerKey + 1 })
  }
  await sendComposed(p, { roomId: opts.roomId, text: `/${spec.type}` })
}
