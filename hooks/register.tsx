import type { EngineInterface, Register } from 'claude-code'

import type { CallResult, Host } from './host'
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await startLoop(hostOf($))
    return next(e)
  })
}
