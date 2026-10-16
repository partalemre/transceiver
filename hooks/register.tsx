import type { EngineInterface, On, Register } from 'claude-code'

import { paneHandlers } from './actions'
import { wireAgents } from './agents'
import { description, parseCommand, runCommand } from './commands'
import { isBypassMode, isConnected, persistConnection, restoreConnection, setConnected } from './connection'
import { repoHere } from './here'
import type { AgentHost, CallResult, Host } from './host'
import { HUB_PANE, isOpenFor, isSameLine } from './hub'
import { setLang } from './kit/lang'
import { pinned } from './kit/pin'
import { isOffStage, shownOf } from './kit/stage'
import { resolveLight } from './kit/tokens'
import { PANE_ID, RUN_TIMEOUT_MS } from './limits'
import { setTurnRunning } from './live'
import { drawPane } from './pane'
import { onPaneTick } from './pane-tick'
import { onTick, startLoop } from './room-loop'
import { realPathOf, runnerOf } from './run'
import { bindPane, patchSession, refreshPane, setPaneShown, setRepoSource, type UiHost } from './state'
import { EMPTY_PANE } from './state-types'
import { runTool, TOOL_SPECS } from './tools'
import { agentWords } from './words-agent'

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
    cwd: () => $.session.cwd(),
    isDir: async path => (await $.fs.stat(path).catch(() => null))?.kind === 'dir',
    remove: async path => {
      const isDir = (await $.fs.stat(path).catch(() => null))?.kind === 'dir'
      await $.process.run(isDir ? ['rmdir', '--', path] : ['rm', '-f', '--', path], { timeoutMs: RUN_TIMEOUT_MS })
    },
    isConnected: () => isConnected(),
  }
}

// The pane's reach: its model in `$.state` (the render hook reads it), whether it is on screen, the status line,
// toasts and the clipboard. Nothing here opens the pane: only the person's command or hub press does (openPane).
const PANE_STATE = { plugin: 'transceiver', key: 'pane' } as const
const CONNECTION_STATE = { plugin: 'transceiver', key: 'connected' } as const
const HUB_STATE = { plugin: 'transceiver', key: 'hub' } as const
const DEFAULT_COLUMNS = 80

function uiOf($: EngineInterface): UiHost {
  return {
    setPane: async model => { await $.state.set(PANE_STATE, model) },
    setHub: async line => {
      if (isSameLine((await $.state.get(HUB_STATE)).value, line)) return
      await $.state.set(HUB_STATE, { pane: HUB_PANE, ...line, at: await $.clock.now() })
    },
    isPaneShown: async () => (await $.ui.panes()).some(p => p.id === PANE_ID && p.isShown),
    toast: text => $.ui.toast(text),
    status: text => $.ui.status(text),
    copy: async (text, surface) => (await $.ui.copy({ text, surface })).isCopied,
  }
}

// Light or dark for Box/Text hex: MODZ_THEME, then Claude's theme setting (kit resolveLight).
async function isLightOf($: EngineInterface): Promise<boolean> {
  const override = await $.env.get('MODZ_THEME').catch(() => undefined)
  const theme = await $.config.list().then(rows => rows.find(row => row.key === 'theme')?.value).catch(() => undefined)
  return resolveLight({ override, theme })
}

// Other mods' state is read by literal reference only: the engine reads the names from the source.
async function readState($: EngineInterface, ref: { plugin: string; key: string }): Promise<unknown> {
  type Read = Promise<{ value?: unknown }>
  if (ref.plugin === 'test-badge' && ref.key === 'badge') return (await ($.state.get({ plugin: 'test-badge', key: 'badge' } as never) as Read)).value
  if (ref.plugin === 'plan-steps' && ref.key === 'tasks') return (await ($.state.get({ plugin: 'plan-steps', key: 'tasks' } as never) as Read)).value
  return undefined
}

// The agent side's reach (responder, ask, tools, live wake): Host plus commands, files, the model and the session.
function agentHostOf($: EngineInterface): AgentHost {
  return {
    ...hostOf($),
    run: runnerOf((argv, init) => $.process.run(argv, init)),
    realPath: realPathOf(abs => $.fs.stat(abs, { resolve: true })),
    readFile: path => $.fs.read(path),
    root: () => $.session.root(),
    readState: (plugin, key) => readState($, { plugin, key }),
    mcpCall: (server, tool, args) => $.mcp.call(server, tool, args),
    complete: request => $.model.complete(request),
    sleep: ms => $.clock.sleep(ms),
    sendSelf: async text => (await $.session.send({ to: { sessionId: await $.session.id() }, text })).isDelivered,
    note: async text => { await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } }) },
    toast: text => $.ui.toast(text),
    isConnected: () => isConnected(),
  }
}

async function registerTools($: EngineInterface): Promise<void> {
  for (const spec of TOOL_SPECS) {
    await $.tool.register(spec).catch(() => $.ui.log(`transceiver: tool ${spec.name} could not be registered`))
  }
}

// With the MODZ hub on, the opened pane takes its one panel, so the hub and every other pane step aside
// (MODZ kit/stage.ts). A failed note of that is only logged: the pane is open either way.
async function reportShown($: EngineInterface): Promise<void> {
  try {
    if ((await $.state.get({ plugin: 'modz', key: 'isOn' })).value !== true) return
    await $.state.set({ plugin: 'transceiver', key: 'shown' }, shownOf(HUB_PANE, await $.clock.now()))
  } catch {
    $.ui.log('transceiver: could not tell the hub the pane is shown', { to: 'debug' })
  }
}

// Asked for by the person only (the command, the MODZ hub row); a chat pane stays open beside the transcript.
async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE_ID, title: 'Transceiver', focus: true })
  setPaneShown(true)
  if (opened.isPlaced) await reportShown($)
  await refreshPane()
}

// One pane listener per module: a second session.start without a reload replaces it instead of stacking.
let stopPaneTick: (() => void) | null = null

function onSession(on: On): void {
  on('session.start', async ($, e, next) => {
    // The interface language first, before anything is drawn or registered with a description.
    setLang(await $.env.get('MODZ_LANG').catch(() => undefined))
    // A refused registration must not keep the rooms from polling.
    await $.command.register({ name: 'transceiver', description: description(), immediate: true })
      .catch(() => $.ui.log('transceiver: /transceiver could not be registered'))
    persistConnection(is => { void $.state.set(CONNECTION_STATE, is).catch(() => undefined) })
    await restoreConnection(() => $.state.get(CONNECTION_STATE))
    const agents = agentHostOf($)
    // The pane listens first, so a failing agent-side listener never keeps it from redrawing.
    bindPane({ host: agents, ui: uiOf($) })
    setRepoSource(() => repoHere(agents))
    stopPaneTick?.()
    stopPaneTick = onTick(onPaneTick)
    wireAgents(agents)
    await registerTools($)
    await startLoop(agents)
    await refreshPane()
    return next(e)
  })
  // A session with permissions bypassed may write without a "Bağlan" card (spike R1). An SDK host (an IDE, the
  // desktop app) leaves the mode out of SessionStart, so the first prompt's mode counts too.
  on('classic.SessionStart', async ($, e, next) => {
    if (isBypassMode(e.permission_mode)) setConnected(true)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (isBypassMode(e.permission_mode)) setConnected(true)
    return next(e)
  }).catch(($, e, next) => next(e))
}

// The way back to the MODZ hub: this mod's own `home` value, which the hub hears. A press never throws.
function goHome($: EngineInterface): void {
  void $.clock.now()
    .then(at => $.state.set({ plugin: 'transceiver', key: 'home' }, { at }))
    .catch(() => $.ui.log('transceiver: could not go back to the hub', { to: 'debug' }))
}

function onPane(on: On): void {
  on('ui.render', { component: 'Pane', requestId: 'transceiver' }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const model = (await $.state.get(PANE_STATE)).value ?? EMPTY_PANE
    const columns = e.props.bodyColumns || e.viewport?.columns || DEFAULT_COLUMNS
    const isHubOn = (await $.state.get({ plugin: 'modz', key: 'isOn' })).value === true
    const onHome = isHubOn ? () => goHome($) : undefined
    return pinned(e, drawPane(ui, { surface: e.surface, columns, isLight: await isLightOf($), model, on: paneHandlers, onHome }))
  })
  // A press on the MODZ hub's Transceiver row: the pane opens (or an open one comes forward) asking for the keyboard.
  on('state.set', { plugin: 'modz', key: 'open' }, async ($, e, next) => {
    const done = await next(e)
    if (isOpenFor(e.value, HUB_PANE)) await openPane($)
    return done
  }).catch(($, e, next) => next(e))
  // Another pane took the hub's one panel: this one steps aside rather than wait as a tab.
  on('state.set', { plugin: 'modz', key: 'stage' }, async ($, e, next) => {
    const done = await next(e)
    if (isOffStage(e.value, HUB_PANE)) await $.ui.close({ id: PANE_ID })
    return done
  }).catch(($, e, next) => next(e))
  // Closed by the person: no read marks from here on; toasts and the status line take over.
  on('ui.close', { id: 'transceiver' }, async ($, e, next) => {
    setPaneShown(false)
    void refreshPane()
    return next(e)
  }).catch(($, e, next) => next(e))
}

function onTools(on: On): void {
  // The agent tools: the model calls them as mcp__transceiver__send, inbox and ask. The ask tool waits inside this
  // hook's own budget.
  on('tool.call', { tool: ['mcp__transceiver__send', 'mcp__transceiver__inbox', 'mcp__transceiver__ask'] }, async ($, e, next) => {
    const name = String(e.tool).slice('mcp__transceiver__'.length)
    const input = e as unknown as Record<string, unknown>
    return runTool({ host: agentHostOf($), budgetLeft: () => next.budget.remainingMs }, { name, input })
  }).catch(() => ({ deny: agentWords().toolFailed }))
  // Live wake never interrupts a running turn of the main conversation.
  on('turn.start', async ($, e, next) => { setTurnRunning(true); return next(e) })
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) setTurnRunning(false)
    return next(e)
  })
}

// The command's name is written as a literal (it is COMMAND in limits.ts): the engine reads a literal name to know
// this hook answers only its own command.
function onCommand(on: On): void {
  on('command.run', { command: 'transceiver' }, async ($, e) => {
    const cmd = parseCommand(e.args)
    if (cmd.verb === 'ayarlar') patchSession({ view: 'settings' })
    const text = await runCommand({ host: hostOf($), openPane: () => openPane($), cmd })
    await refreshPane()
    return text === null ? {} : { text }
  }).catch(() => ({ text: agentWords().commandFailed }))
}

export const register: Register = on => {
  onSession(on)
  onPane(on)
  onTools(on)
  onCommand(on)
}
