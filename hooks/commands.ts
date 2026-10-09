import type { Host } from './host'
import { joinRoom } from './join'
import { COMMAND } from './limits'
import { isRepo } from './protocol'
import { forgetRoom, pokeRoom } from './room-loop'
import { createRoom, loadRooms, saveRooms, type RoomKind } from './rooms'

export type Verb = 'open' | 'ekle' | 'proje' | 'katil' | 'cik' | 'kur' | 'ayarlar' | 'yardim'
export type Cmd = { verb: Verb; arg: string }
// What a command needs beyond the host: the pane opener lives in register.tsx, beside `$`.
export type CommandDeps = { host: Host; openPane: () => Promise<void> }

const FOLD: Record<string, string> = { ç: 'c', ı: 'i', ğ: 'g', ö: 'o', ş: 's', ü: 'u' }
const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/[çığöşü]/g, c => FOLD[c] ?? c)
const VERBS = new Set<Verb>(['ekle', 'proje', 'katil', 'cik', 'kur', 'ayarlar'])
const PANE_VERBS = new Set<Verb>(['open', 'kur', 'ayarlar'])

export const DESCRIPTION = 'Arkadaşlarınla ve agent\'larla Claude içinde yazış'
export const ARGUMENT_HINT = '[ekle | proje <repo> | katıl <link> | çık <oda> | kur | ayarlar]'
export const HELP = [
  `/${COMMAND} — pencereyi aç`,
  `/${COMMAND} ekle — arkadaş için DM odası aç`,
  `/${COMMAND} proje <sahip/repo> — ortak proje odası aç`,
  `/${COMMAND} katıl <link> — davet linkiyle katıl (başka organizasyondan davetler listede görünmez)`,
  `/${COMMAND} çık <oda adı | link> — odadan çık`,
  `/${COMMAND} kur — bu oturumda bağlan (ilk mesaj için tek onay)`,
  `/${COMMAND} ayarlar — okundu bilgisi, bildirimler, GitHub adın`,
].join('\n')

export function parseCommand(args: string): Cmd {
  const [head = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  if (head === '') return { verb: 'open', arg: '' }
  const verb = fold(head) as Verb
  return VERBS.has(verb) ? { verb, arg } : { verb: 'yardim', arg: head }
}

// The command the person typed is the consent for the room's first writes (publish and meta).
async function addRoom(deps: CommandDeps, opts: { kind: RoomKind; repo?: string; typed: string }): Promise<string> {
  const { host } = deps
  const consent = `The user ran "/${COMMAND} ${opts.typed}"`
  const room = await createRoom({ host, kind: opts.kind, repo: opts.repo, consent }).catch((err: unknown) => err as Error)
  if (room instanceof Error) return `Oda açılamadı: ${room.message}`
  await saveRooms(host, [...(await loadRooms(host)), room])
  pokeRoom(host, room)
  await deps.openPane()
  return `Oda hazır: ${room.url}\nclaude.ai'de bu sayfanın Paylaş menüsünden arkadaşını e-postasıyla davet et; sonra linki ona gönder (/${COMMAND} katıl <link>).`
}

async function leave(host: Host, name: string): Promise<string> {
  if (name === '') return `Kullanım: /${COMMAND} çık <oda adı | link>`
  const rooms = await loadRooms(host)
  const matches = rooms.filter(r => r.status !== 'left' && (r.url === name || r.title.endsWith(name)))
  if (matches.length > 1) return 'Birden fazla oda eşleşti; odanın linkiyle dene.'
  const [room] = matches
  if (room === undefined) return `Oda bulunamadı: ${name}`
  await forgetRoom(host, room.id)
  await saveRooms(host, rooms.map(r => (r.id === room.id ? { ...r, status: 'left' as const } : r)))
  return `${room.title} odasından çıkıldı.`
}

export async function runCommand(opts: CommandDeps & { cmd: Cmd }): Promise<string | null> {
  const { cmd, host } = opts
  if (PANE_VERBS.has(cmd.verb)) {
    await opts.openPane()
    return null
  }
  if (cmd.verb === 'ekle') return addRoom(opts, { kind: 'dm', typed: 'ekle' })
  if (cmd.verb === 'proje') {
    return isRepo(cmd.arg) ? addRoom(opts, { kind: 'project', repo: cmd.arg, typed: `proje ${cmd.arg}` }) : `Kullanım: /${COMMAND} proje <sahip/repo>`
  }
  if (cmd.verb === 'cik') return leave(host, cmd.arg)
  if (cmd.verb === 'katil') return joinRoom(host, cmd.arg)
  return HELP
}
