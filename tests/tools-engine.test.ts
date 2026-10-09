import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { forgetRepo } from '../hooks/here'

const ROOM = {
  id: 'te', url: 'https://claude.ai/artifact/TE1', kind: 'project', repo: 'partalemre/eliti', title: 't',
  status: 'active', isLive: false, isOwner: true, peers: [], joinedAt: 0,
}

// The engine answers $.session.root and $.process.run from the test's own hooks (`git remote get-url` here).
function world(on: On, rooms: unknown[]) {
  forgetRepo()
  mock.store(on, { 'tx.rooms': rooms })
  mock.clock(on, { now: 1_791_545_100_000 })
  mock.env(on, { HOME: '/home/u' })
  on('session.root' as never, (() => ({ value: '/w' })) as never)
  on('process.run' as never, (() => ({ value: { exitCode: 0, stdout: 'git@github.com:partalemre/eliti.git\n', stderr: '' } })) as never)
}

test('the agent tools are answered through the engine by their full names', async ($, on) => {
  world(on, [])
  const out = await $.tool.call({ tool: 'mcp__transceiver__inbox' } as never)
  expect(out.deny?.includes('proje odası yok')).toBe(true)
  const send = await $.tool.call({ tool: 'mcp__transceiver__send', text: 'selam' } as never)
  expect(send.deny?.includes('proje odası yok')).toBe(true)
})

// The plugin runs in its own module instance, which starts unconnected: input is checked first, then the connection.
test('the tool reads its arguments from the call, and waits for the connection before writing', async ($, on) => {
  world(on, [ROOM])
  const empty = await $.tool.call({ tool: 'mcp__transceiver__send', text: '' } as never)
  expect(empty.deny?.startsWith('Mesaj gönderilmedi')).toBe(true)
  expect((await $.tool.call({ tool: 'mcp__transceiver__ask', type: 'rm' } as never)).deny?.startsWith('type şunlardan')).toBe(true)
  expect((await $.tool.call({ tool: 'mcp__transceiver__send', text: 'selam' } as never)).deny).toBe('bağlantı bekleniyor')
  const inbox = await $.tool.call({ tool: 'mcp__transceiver__inbox' } as never)
  expect(inbox.deny).toBe(undefined)
})
