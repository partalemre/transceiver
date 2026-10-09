import type { EngineInterface, Register } from 'claude-code'

import { ARGUMENT_HINT, DESCRIPTION, parseCommand, runCommand } from './commands'
import type { CallResult, Host } from './host'
import { PANE_ID } from './limits'
import { startLoop } from './room-loop'

// The only place `$` is held: every other module reaches the engine through this port.
function hostOf($: EngineInterface): Host {
  return {
    tool: async input => (await $.tool.call(input as never)) as CallResult,
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    every: (ms, fn) => $.clock.every(ms, fn),
    home: () => $.env.get('HOME'),
    writeFile: (path, text) => $.fs.write(path, text),
    log: text => $.ui.log(text),
  }
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE_ID, title: 'Transceiver', focus: true, closeOnEscape: true })
}

// The command's name is written as a literal (it is COMMAND in limits.ts): the engine reads a literal name to know
// this hook answers only its own command.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A refused registration must not keep the rooms from polling.
    await $.command.register({ name: 'transceiver', description: DESCRIPTION, argumentHint: ARGUMENT_HINT, immediate: true })
      .catch(() => $.ui.log('transceiver: /transceiver could not be registered'))
    await startLoop(hostOf($))
    return next(e)
  })
  on('command.run', { command: 'transceiver' }, async ($, e) => {
    const text = await runCommand({ host: hostOf($), openPane: () => openPane($), cmd: parseCommand(e.args) })
    return text === null ? {} : { text }
  }).catch(() => ({ text: 'Transceiver: komut tamamlanamadı, birazdan yeniden dene.' }))
}
