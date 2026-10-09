import type { EngineInterface, McpToolResult } from 'claude-code'

import { COLLAB_PAGE } from './limits'
import { isRepo } from './protocol'
import type { Run } from './run'

export type CollabCheck = (opts: { repo: string; login: string }) => Promise<boolean>
export type McpHost = { mcp: Pick<EngineInterface['mcp'], 'call'> }

// Anchored: only github.com itself, over ssh or https (credentials before the host allowed).
const REMOTE = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/\s]+@)?github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/
// GitHub's own rule: letters, digits and single inner hyphens, at most 39.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const GITHUB_MCP = 'github'

export const isLogin = (x: string): boolean => LOGIN.test(x)

export function repoOfRemote(url: string): string | null {
  const repo = REMOTE.exec(url.trim())?.[1] ?? null
  return repo !== null && isRepo(repo) ? repo : null
}

export async function sessionRepo(run: Run, cwd: string): Promise<string | null> {
  const out = await run(['git', '-C', cwd, 'remote', 'get-url', 'origin'])
  return out.exitCode === 0 ? repoOfRemote(out.stdout) : null
}

export async function ownLogin(run: Run): Promise<string | null> {
  const out = await run(['gh', 'api', 'user', '--jq', '.login'])
  const login = out.stdout.trim()
  return out.exitCode === 0 && isLogin(login) ? login : null
}

// `gh api` exits 0 only on a 2xx: 204 is a collaborator, 404 (or no network, no auth) is not.
export function ghCheck(run: Run): CollabCheck {
  return async ({ repo, login }) => {
    if (!isRepo(repo) || !isLogin(login)) return false
    const out = await run(['gh', 'api', `repos/${repo}/collaborators/${login}`, '--silent'])
    return out.exitCode === 0
  }
}

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// Measured shape: one text block of JSON `{ items: [{ login, id, role_name }], nextPage, ... }`.
function loginsIn(result: McpToolResult): string[] {
  const docs = [result.structuredContent, ...result.content.map(b => (typeof b.text === 'string' ? parseJson(b.text) : undefined))]
  const rows = docs.flatMap(doc => (Array.isArray(doc) ? doc : isObj(doc) && Array.isArray(doc.items) ? doc.items : []))
  return rows.flatMap(row => (isObj(row) && typeof row.login === 'string' ? [row.login.toLowerCase()] : []))
}

// The MCP list can say yes; a miss (the list is paged), an error or no server leaves it to gh.
export function mcpCheck($: McpHost, fallback: CollabCheck): CollabCheck {
  return async opts => {
    if (!isRepo(opts.repo) || !isLogin(opts.login)) return false
    const [owner, repo] = opts.repo.split('/')
    const result = await $.mcp.call(GITHUB_MCP, 'list_repository_collaborators', { owner, repo, perPage: COLLAB_PAGE })
      .catch(() => null)
    const isListed = result !== null && !result.isError && loginsIn(result).includes(opts.login.toLowerCase())
    return isListed || fallback(opts)
  }
}
