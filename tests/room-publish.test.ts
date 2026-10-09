// Where the room page is written for the Artifact tool, which publishes only files under the session's working
// directory, and that it never stays behind.
import { expect, test } from 'claude-code/testing'

import { isConnected, setConnected } from '../hooks/connection'
import { createRoom } from '../hooks/rooms'
import { callerFor, fakeDb } from './fake-db'
import { fakeHost } from './fake-host'

const ROOM = 'https://claude.ai/artifact/AAA111'

function world(publish: () => Record<string, unknown> = () => ({ result: { url: ROOM }, text: '' })) {
  const db = fakeDb()
  const host = fakeHost(async input => (input.tool === 'Artifact' ? publish() : callerFor(db)(input)))
  return { db, host }
}

const publishedPath = (tools: Record<string, unknown>[]) => String(tools.find(t => t.tool === 'Artifact')?.file_path)

test('in a git repo the page goes inside .git, is published from there, and is removed', async () => {
  const { host } = world()
  await createRoom({ host, kind: 'dm' })
  const file = publishedPath(host.tools)
  expect(file.startsWith('/w/.git/transceiver/room-') && file.endsWith('.html')).toBe(true)
  expect(host.written[file]?.startsWith('<title>Transceiver · DM</title>')).toBe(true)
  expect(host.removed).toEqual([file])
})

test('outside a repo the page goes in a .transceiver folder of the cwd, and the file and folder are removed', async () => {
  const { host } = world()
  host.dirs.clear()
  host.cwdPath = '/work/notes/'
  await createRoom({ host, kind: 'dm' })
  const file = publishedPath(host.tools)
  expect(file.startsWith('/work/notes/.transceiver/room-')).toBe(true)
  expect(host.removed).toEqual([file, '/work/notes/.transceiver'])
})

test('a refused publish still removes the page', async () => {
  const { host } = world(() => ({ deny: 'not now' }))
  setConnected(false)
  await createRoom({ host, kind: 'dm' }).catch(() => null)
  expect(host.removed).toEqual([publishedPath(host.tools)])
  expect(isConnected()).toBe(false)
})

test('a room created with the person\'s consent connects the session', async () => {
  const { host } = world()
  setConnected(false)
  await createRoom({ host, kind: 'dm', consent: 'The user ran "/transceiver ekle"' })
  expect(isConnected()).toBe(true)
  setConnected(false)
})
