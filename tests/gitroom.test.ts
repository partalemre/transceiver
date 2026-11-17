import { expect, test } from 'claude-code/testing'
import { makeGate } from '../hooks/gate'
import { gitUrl, isGitUrl, isSafePath, parseGitUrl } from '../hooks/gitbox'
import { repoRoomOf, repoRoomRecord, roomIdOf } from '../hooks/gitroom'
import { projectRoomFor } from '../hooks/here'
import { emptyHead, isId, parseHead, parseMeta, type Message } from '../hooks/protocol'
import type { RoomRecord } from '../hooks/rooms'
import { initialSync, type RoomSync } from '../hooks/sync'
import { teamOf } from '../hooks/team'
import { gateBadge, gateChecks } from '../hooks/view-room'

const REPO = 'yzd-info/ai-dj-director'
const ME = 'u_AAAAAAAAAAAAAAAAAAAAAA'
const YUSUF = 'u_BBBBBBBBBBBBBBBBBBBBBB'
const KEY = `${YUSUF}@ai-dj-director#${YUSUF}`
const room = repoRoomRecord({ repo: REPO, uid: ME, now: 5 })
const artifact: RoomRecord = { ...room, id: 'old', url: 'https://claude.ai/artifact/abc' }
const msg = (o: Partial<Message> & { id: string; ts: number }): Message => ({ v: 1, kind: 'human', text: 'selam', ...o })
const ID1 = '01K7A0000000000000000000A1'
const ID2 = '01K7A0000000000000000000A2'

test('a repo room address names the repo and the mailbox, and nothing else parses as one', () => {
  expect(parseGitUrl(gitUrl(REPO, ME))).toEqual({ repo: REPO, uid: ME })
  expect(isGitUrl('https://claude.ai/artifact/abc')).toBe(false)
  expect(parseGitUrl('git:a/b#not-a-uid')).toBe(null)
  expect(isSafePath(`outbox/${ME}/msgs/${ID1}`)).toBe(true)
  expect(isSafePath('outbox/../x')).toBe(false)
  expect(isSafePath('out box/x')).toBe(false)
})

test('every member derives the same room id from the repo, whatever the case', () => {
  expect(isId(roomIdOf(REPO))).toBe(true)
  expect(roomIdOf('YZD-Info/AI-DJ-Director')).toBe(roomIdOf(REPO))
  expect(roomIdOf('a/b')).not.toBe(roomIdOf('a/c'))
  expect(parseMeta({ v: 1, kind: 'project', repo: REPO, room: room.room, createdAt: 1 })?.room).toBe(room.room)
  expect(repoRoomOf([artifact, room], 'YZD-INFO/ai-dj-director')).toBe(room)
})

test('agent traffic goes to the repo room before an older artifact room of the same repo', () => {
  expect(projectRoomFor([artifact, room], REPO)).toBe(room)
  expect(projectRoomFor([artifact], REPO)).toBe(artifact)
})

test('in a repo room the gate needs only the room and the session to be this repo', async () => {
  const gate = makeGate(async () => { throw new Error('GitHub is never asked') })
  const base = { room, peerUid: KEY, headGh: undefined, now: 1, otherMembers: 3, isRepoRoom: true }
  expect(await gate({ ...base, query: { type: 'status', repo: REPO }, sessionRepo: REPO })).toBe(true)
  expect(await gate({ ...base, query: { type: 'status', repo: REPO }, sessionRepo: 'someone/else' })).toBe(false)
  expect(await gate({ ...base, query: { type: 'status', repo: 'someone/else' }, sessionRepo: 'someone/else' })).toBe(false)
  expect(await gate({ ...base, isRepoRoom: false, query: { type: 'status', repo: REPO }, sessionRepo: REPO })).toBe(false)
})

test('the pane shows a repo room\'s gate open in its own repo, with no GitHub question', () => {
  expect(gateBadge(gateChecks(room, undefined, { sessionRepo: REPO }))).toBe('open')
  expect(gateBadge(gateChecks(room, undefined, { sessionRepo: 'someone/else' }))).toBe('closed')
})

test('a head carries when its owner last worked and on which branch', () => {
  expect(parseHead({ ...emptyHead(), at: 9, branch: 'feature/mix', label: 'Yusuf' })).toEqual({ ...emptyHead(), at: 9, branch: 'feature/mix', label: 'Yusuf' })
  expect(parseHead({ ...emptyHead(), at: 'soon' })).toBe(null)
})

const syncWith = (patch: Partial<RoomSync>): RoomSync => ({ ...initialSync(ME), ...patch })
const teamIn = (sync: RoomSync, names: Record<string, string> = { [KEY]: 'Yusuf Ziya Demirbas' }) =>
  teamOf({ rooms: [room], syncs: { [room.id]: sync }, names, repo: REPO, readMark: s => s.ownHead.readUpTo })

test('the team line is empty until someone else has a mailbox in the repo', () => {
  expect(teamIn(syncWith({}))).toBe(null)
  expect(teamOf({ rooms: [room], syncs: {}, names: {}, repo: null, readMark: () => '' })).toBe(null)
})

test('the team line names the teammate, their branch, and the newest line they or their agent wrote', () => {
  const head = { ...emptyHead(), head: ID2, headTs: 40, at: 50, branch: 'feature/mix', label: 'Yusuf Ziya Demirbas' }
  const entries = [
    { author: ME, message: msg({ id: ID1, ts: 30 }) },
    { author: KEY, message: msg({ id: ID2, ts: 40, kind: 'agent', text: 'testler geçti' }) },
  ]
  const line = teamIn(syncWith({ peers: { [KEY]: head }, entries }))
  expect(line?.mates).toEqual([{ name: 'Yusuf', at: 50, branch: 'feature/mix' }])
  expect(line?.last).toEqual({ id: ID2, name: 'Yusuf', text: 'testler geçti', ts: 40, isAgent: true })
  expect(line?.unread).toBe(1)
  expect(line?.recent.map(r => [r.isMine, r.isAgent, r.text])).toEqual([[true, false, 'selam'], [false, true, 'testler geçti']])
  const read = teamIn(syncWith({ peers: { [KEY]: head }, entries, ownHead: { ...emptyHead(), readUpTo: ID2 } }))
  expect(read?.unread).toBe(0)
})
