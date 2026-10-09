import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { register } from '../hooks/register'

type Seen = { event: string; match: unknown; hasCatch: boolean }

// A recording `on`: what register wires, in order, and which hooks carry a `.catch`.
function recorder(): { on: On; seen: Seen[] } {
  const seen: Seen[] = []
  const on = ((event: string, ...rest: unknown[]) => {
    const row: Seen = { event, match: rest.length > 1 ? rest[0] : null, hasCatch: false }
    seen.push(row)
    return { catch: () => { row.hasCatch = true } }
  }) as unknown as On
  return { on, seen }
}

test('register wires the same nine hooks from its small helpers, each gate with its catch', () => {
  const { on, seen } = recorder()
  register(on, {} as never)
  expect(seen).toEqual([
    { event: 'session.start', match: null, hasCatch: false },
    { event: 'classic.SessionStart', match: null, hasCatch: true },
    { event: 'ui.render', match: { component: 'Pane', requestId: 'transceiver' }, hasCatch: false },
    { event: 'state.set', match: { plugin: 'modz', key: 'open' }, hasCatch: true },
    { event: 'ui.close', match: { id: 'transceiver' }, hasCatch: true },
    { event: 'tool.call', match: { tool: ['mcp__transceiver__send', 'mcp__transceiver__inbox', 'mcp__transceiver__ask'] }, hasCatch: true },
    { event: 'turn.start', match: null, hasCatch: false },
    { event: 'turn.complete', match: null, hasCatch: false },
    { event: 'command.run', match: { command: 'transceiver' }, hasCatch: true },
  ])
})
