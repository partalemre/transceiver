import type { ModelCompleteRequest, ModelCompleteResult } from 'claude-code'
import type { AgentHost, CallResult } from '../hooks/host'
import type { Run } from '../hooks/run'
import { fakeHost, type FakeHost } from './fake-host'

// An in-memory AgentHost: FakeHost plus scripted commands, files, model replies and the session's own rows.
export type FakeAgent = FakeHost & AgentHost & {
  isOn: boolean; isDelivered: boolean
  sent: string[]; notes: string[]; toasts: string[]; asked: ModelCompleteRequest[]; files: Record<string, string>
  reply: (request: ModelCompleteRequest) => ModelCompleteResult
}

const USAGE = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
export const answered = (text: string): ModelCompleteResult => ({ isAnswered: true, text, usage: USAGE })

// `git remote get-url origin` names the repo; everything else succeeds quietly unless `run` says otherwise.
export const gitIn = (repo: string, more: Run = async () => ({ exitCode: 0, stdout: '', stderr: '' })): Run =>
  async (argv, init) => (argv.includes('get-url') ? { exitCode: 0, stdout: `git@github.com:${repo}.git\n`, stderr: '' } : more(argv, init))

export function fakeAgent(answer: (input: Record<string, unknown>) => Promise<CallResult>, run: Run = gitIn('partalemre/eliti')): FakeAgent {
  const base = fakeHost(answer)
  const agent: FakeAgent = Object.assign(base, {
    isOn: true, isDelivered: false, sent: [] as string[], notes: [] as string[], toasts: [] as string[],
    asked: [] as ModelCompleteRequest[], files: {} as Record<string, string>,
    reply: () => answered('çünkü'),
    run,
    realPath: async (abs: string) => abs,
    readFile: async (path: string) => agent.files[path] ?? '',
    root: async () => '/w',
    readState: async () => undefined,
    mcpCall: async () => { throw new Error('no github mcp') },
    complete: async (request: ModelCompleteRequest) => { agent.asked.push(request); return agent.reply(request) },
    sleep: (ms: number) => base.advance(ms),
    sendSelf: async (text: string) => { agent.sent.push(text); return agent.isDelivered },
    note: async (text: string) => { agent.notes.push(text) },
    toast: (text: string) => { agent.toasts.push(text) },
    isConnected: () => agent.isOn,
  })
  return agent
}
