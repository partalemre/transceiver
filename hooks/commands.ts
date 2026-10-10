import type { Host } from './host'
import { joinRoom } from './join'
import { pick } from './kit/lang'
import { COMMAND } from './limits'
import { isRepo } from './protocol'
import { forgetRoom, pokeRoom } from './room-loop'
import { createRoom, failText, loadRooms, saveRooms, type RoomKind } from './rooms'

export type Verb = 'open' | 'ekle' | 'proje' | 'katil' | 'cik' | 'kur' | 'ayarlar' | 'yardim'
export type Cmd = { verb: Verb; arg: string }
// What a command needs beyond the host: the pane opener lives in register.tsx, beside `$`.
export type CommandDeps = { host: Host; openPane: () => Promise<void> }

const FOLD: Record<string, string> = { ç: 'c', ı: 'i', ğ: 'g', ö: 'o', ş: 's', ü: 'u' }
const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/[çığöşü]/g, c => FOLD[c] ?? c)
const VERBS = new Set<Verb>(['ekle', 'proje', 'katil', 'cik', 'kur', 'ayarlar'])
const PANE_VERBS = new Set<Verb>(['open', 'kur', 'ayarlar'])
// The verbs keep their Turkish names inside; either language's word works when typed.
const ALIASES: Record<string, Verb> = { add: 'ekle', project: 'proje', join: 'katil', leave: 'cik', connect: 'kur', settings: 'ayarlar' }

const EN = {
  description: 'Message friends and agents: opens the pane',
  help: [
    `/${COMMAND} — open the pane`,
    `/${COMMAND} add — open a DM room for a friend`,
    `/${COMMAND} project <owner/repo> — open a shared project room`,
    `/${COMMAND} join <link> — join with an invite link (invites from another organization do not show in the list)`,
    `/${COMMAND} leave <room name | link> — leave a room`,
    `/${COMMAND} connect — connect in this session (one approval for the first message)`,
    `/${COMMAND} settings — read receipts, notifications, your GitHub name`,
  ],
  add: 'add',
  project: 'project',
  roomFailed: (why: string) => `The room could not be opened: ${why}`,
  roomReady: (url: string) => `Room ready, your mailbox: ${url}\nOn claude.ai, add your friend by email from this page's Share menu (Viewer is enough), then send them the link (/${COMMAND} join <link>). When they send you their own mailbox link, type /${COMMAND} join <their link>.`,
  leaveUsage: `Usage: /${COMMAND} leave <room name | link>`,
  manyRooms: 'More than one room matches. Try the room\'s link.',
  noRoom: (name: string) => `No room found: ${name}`,
  left: (title: string) => `Left ${title}.`,
  projectUsage: `Usage: /${COMMAND} project <owner/repo>`,
}

const TR: typeof EN = {
  description: 'Arkadaşlarınla ve agent\'larla yazış: pencereyi açar',
  help: [
    `/${COMMAND} — pencereyi aç`,
    `/${COMMAND} ekle — arkadaş için DM odası aç`,
    `/${COMMAND} proje <sahip/repo> — ortak proje odası aç`,
    `/${COMMAND} katıl <link> — davet linkiyle katıl (başka organizasyondan davetler listede görünmez)`,
    `/${COMMAND} çık <oda adı | link> — odadan çık`,
    `/${COMMAND} kur — bu oturumda bağlan (ilk mesaj için tek onay)`,
    `/${COMMAND} ayarlar — okundu bilgisi, bildirimler, GitHub adın`,
  ],
  add: 'ekle',
  project: 'proje',
  roomFailed: why => `Oda açılamadı: ${why}`,
  roomReady: url => `Oda hazır, kendi kutun: ${url}\nclaude.ai'de bu sayfanın Paylaş menüsünden arkadaşını e-postasıyla ekle (Viewer yeter); sonra linki ona gönder (/${COMMAND} katıl <link>). O da kendi kutusunun linkini sana gönderince /${COMMAND} katıl <onun linki> yaz.`,
  leaveUsage: `Kullanım: /${COMMAND} çık <oda adı | link>`,
  manyRooms: 'Birden fazla oda eşleşti; odanın linkiyle dene.',
  noRoom: name => `Oda bulunamadı: ${name}`,
  left: title => `${title} odasından çıkıldı.`,
  projectUsage: `Kullanım: /${COMMAND} proje <sahip/repo>`,
}

const words = () => pick({ en: EN, tr: TR })

// No argument hint: a bare /transceiver opens the pane, where every step is a button. The verbs below still work
// when typed, and a wrong one answers with the help, which lists the current language's words.
export const description = (): string => words().description
export const helpText = (): string => words().help.join('\n')

export function parseCommand(args: string): Cmd {
  const [head = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  if (head === '') return { verb: 'open', arg: '' }
  const word = fold(head)
  const verb = ALIASES[word] ?? (word as Verb)
  return VERBS.has(verb) ? { verb, arg } : { verb: 'yardim', arg: head }
}

// The command the person typed is the consent for the room's first writes (publish and meta).
async function addRoom(deps: CommandDeps, opts: { kind: RoomKind; repo?: string; typed: string }): Promise<string> {
  const { host } = deps
  const consent = `The user ran "/${COMMAND} ${opts.typed}"`
  const room = await createRoom({ host, kind: opts.kind, repo: opts.repo, consent }).catch((err: unknown) => err as Error)
  if (room instanceof Error) return failText(room, words().roomFailed(room.message))
  await saveRooms(host, [...(await loadRooms(host)), room])
  pokeRoom(host, room)
  await deps.openPane()
  return words().roomReady(room.url)
}

async function leave(host: Host, name: string): Promise<string> {
  if (name === '') return words().leaveUsage
  const rooms = await loadRooms(host)
  const matches = rooms.filter(r => r.status !== 'left' && (r.url === name || r.title.endsWith(name)))
  if (matches.length > 1) return words().manyRooms
  const [room] = matches
  if (room === undefined) return words().noRoom(name)
  await forgetRoom(host, room.id)
  await saveRooms(host, rooms.map(r => (r.id === room.id ? { ...r, status: 'left' as const } : r)))
  return words().left(room.title)
}

export async function runCommand(opts: CommandDeps & { cmd: Cmd }): Promise<string | null> {
  const { cmd, host } = opts
  if (PANE_VERBS.has(cmd.verb)) {
    await opts.openPane()
    return null
  }
  if (cmd.verb === 'ekle') return addRoom(opts, { kind: 'dm', typed: words().add })
  if (cmd.verb === 'proje') {
    return isRepo(cmd.arg) ? addRoom(opts, { kind: 'project', repo: cmd.arg, typed: `${words().project} ${cmd.arg}` }) : words().projectUsage
  }
  if (cmd.verb === 'cik') return leave(host, cmd.arg)
  if (cmd.verb === 'katil') return (await joinRoom(host, cmd.arg)).text
  return helpText()
}
