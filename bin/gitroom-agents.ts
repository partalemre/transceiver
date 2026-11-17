// The agent side of a repo room, live: two processes, each one person's mod with its own store and mailbox folder,
// on one real private GitHub repo. No model: the tools are called the way the engine calls them.
//   bun bin/gitroom-agents.ts answer <owner/repo> <checkout>   stays up, answers questions, greets once
//   bun bin/gitroom-agents.ts ask    <owner/repo> <checkout>   opens the room, asks for status, sends, reads its inbox
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wireAgents } from '../hooks/agents'
import { isConnected } from '../hooks/connection'
import { isGitUrl } from '../hooks/gitbox'
import { gitDb } from '../hooks/gitdb'
import { gitIoOf, openRepoRoom } from '../hooks/gitroom'
import type { AgentHost } from '../hooks/host'
import { startLoop, syncOf } from '../hooks/room-loop'
import { runTool } from '../hooks/tools'

const [role, repo, checkout] = process.argv.slice(2) as [string, string, string]
const STEP_MS = 500
const UP_MS = 150_000
const store = new Map<string, unknown>()
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms))

const run: AgentHost['run'] = (argv, init) => new Promise(done => {
  const child = spawn(argv[0] as string, argv.slice(1), { cwd: init?.cwd ?? checkout, env: { ...process.env, ...init?.env } })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', d => { stdout += String(d) })
  child.stderr.on('data', d => { stderr += String(d) })
  child.on('close', code => done({ exitCode: code ?? 1, stdout, stderr }))
  child.stdin.end(init?.stdin ?? '')
})

const host: AgentHost = {
  tool: async input => (isGitUrl(input.url) ? gitDb(gitIoOf(host), input) : { isError: true, text: 'no artifacts here' }),
  storeGet: async key => store.get(key),
  storeSet: async (key, value) => { store.set(key, value) },
  now: async () => Date.now(),
  after: (ms, fn) => { const t = setTimeout(fn, ms); return { cancel: () => clearTimeout(t) } },
  every: (ms, fn) => { const t = setInterval(fn, ms); return { cancel: () => clearInterval(t) } },
  home: async () => process.env.HOME,
  writeFile: async () => undefined,
  log: text => console.log(`  [log] ${text}`),
  say: () => undefined,
  ding: async () => undefined,
  sessionId: async () => `check-${role}`,
  deviceName: async () => `check-${role}`,
  cwd: async () => checkout,
  isDir: async () => false,
  remove: async () => undefined,
  isConnected: () => isConnected(),
  dataDir: async () => dataDir,
  run,
  realPath: async abs => { try { return realpathSync(abs) } catch { return null } },
  readFile: async path => readFileSync(path, 'utf8'),
  root: async () => checkout,
  readState: async () => undefined,
  mcpCall: async () => { throw new Error('no mcp') },
  complete: async () => { throw new Error('no model') },
  sleep,
  sendSelf: async () => false,
  note: async () => undefined,
  toast: text => console.log(`  [toast] ${text}`),
}
const dataDir = mkdtempSync(join(tmpdir(), `tx-agent-${role}-`))
const tool = async (name: string, input: Record<string, unknown>) => {
  const start = Date.now()
  const out = await runTool({ host, budgetLeft: () => 60_000 }, { name, input })
  console.log(`${role}: ${name} (${((Date.now() - start) / 1000).toFixed(1)}s) → ${JSON.stringify(out).slice(0, 400)}`)
  return out
}

wireAgents(host)
await startLoop(host)
const room = await openRepoRoom(repo)
const hasMate = () => Object.keys(syncOf(room.id)?.peers ?? {}).length > 0
const start = Date.now()
while (!hasMate() && Date.now() - start < UP_MS) await sleep(STEP_MS)
console.log(`${role}: teammate ${hasMate() ? 'found' : 'never came'} (${((Date.now() - start) / 1000).toFixed(1)}s)`)
if (role === 'answer') {
  await tool('send', { text: 'karşı tarafın yapay zekâsı: hazırım, testler geçiyor' })
  await sleep(UP_MS)
} else {
  const asked = await tool('ask', { type: 'status' })
  await tool('send', { text: 'soran tarafın yapay zekâsı: durumu aldım' })
  await sleep(8_000)
  await tool('inbox', {})
  const isAnswered = 'result' in asked && typeof asked.result === 'string' && !asked.result.includes('pending')
  console.log(isAnswered ? 'OK: the question was answered in one call' : 'LATE: the answer did not come within the call')
}
process.exit(0)
