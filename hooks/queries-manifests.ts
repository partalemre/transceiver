// Dependency manifests read as plain text: no code runs, nothing is fetched, nothing but names and version
// specs leaves. Each parser is line-based and linear; anything it does not recognise is skipped.
export type Dep = { name: string; version: string }
export type Group = { title: string; deps: Dep[] }
type Obj = Record<string, unknown>

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const SECTION = /^\s*\[([^\]]+)\]\s*(#.*)?$/
const TOML_DEP = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{(.*)\})/
const TOML_VERSION = /\bversion\s*=\s*"([^"]*)"/
const QUOTED = /"([^"]*)"|'([^']*)'/g
// A name, its extras, then nothing or a version spec (`>=2`, `==1.0`, `~=3`, `(>=1)`) or a direct `@ url` reference.
const PEP508 = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*((?:[<>=!~@(][^;]*)?)\s*(?:;.*)?$/
const GEM = /^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/
const GO_LINE = /^(\S+)\s+(\S+)/

function grouped(groups: Map<string, Dep[]>): Group[] {
  return [...groups.entries()].filter(([, deps]) => deps.length > 0).map(([title, deps]) => ({ title, deps }))
}

function add(groups: Map<string, Dep[]>, title: string, dep: Dep): void {
  const list = groups.get(title) ?? []
  list.push(dep)
  groups.set(title, list)
}

export function npmDeps(text: string): Group[] {
  let json: unknown
  try { json = JSON.parse(text) } catch { return [] }
  if (!isObj(json)) return []
  return ['dependencies', 'devDependencies'].flatMap(title => {
    const table = json[title]
    if (!isObj(table)) return []
    const deps = Object.entries(table).flatMap(([name, v]) => (typeof v === 'string' ? [{ name, version: v }] : []))
    return deps.length === 0 ? [] : [{ title, deps }]
  })
}

const pep508 = (spec: string): Dep | null => {
  const m = PEP508.exec(spec)
  return m === null || m[1] === undefined ? null : { name: m[1], version: (m[2] ?? '').trim() }
}

export function requirementsDeps(text: string): Group[] {
  const deps = text.split('\n').flatMap(raw => {
    const line = raw.replace(/(^|\s)#.*$/, '').trim()
    if (line === '' || line.startsWith('-')) return []
    const dep = pep508(line)
    return dep === null ? [] : [dep]
  })
  return deps.length === 0 ? [] : [{ title: 'requirements', deps }]
}

function tomlLine(line: string): Dep | null {
  const m = TOML_DEP.exec(line)
  if (m === null || m[1] === undefined) return null
  const version = m[2] ?? m[3] ?? TOML_VERSION.exec(m[4] ?? '')?.[1] ?? ''
  return { name: m[1], version }
}

// A TOML file's dependency tables: `name = "1.0"`, `name = { version = "1.0" }`, and `[deps.name]` subtables.
function tomlDeps(text: string, groupOf: (section: string) => string | null): Group[] {
  const groups = new Map<string, Dep[]>()
  let group: string | null = null
  let sub: Dep | null = null
  for (const line of text.split('\n')) {
    const section = SECTION.exec(line)?.[1]?.trim()
    if (section !== undefined) {
      group = groupOf(section)
      const parent = section.lastIndexOf('.')
      const parentGroup = parent < 0 ? null : groupOf(section.slice(0, parent))
      sub = parentGroup === null ? null : { name: section.slice(parent + 1), version: '' }
      if (sub !== null && parentGroup !== null) add(groups, parentGroup, sub)
      continue
    }
    if (sub !== null) sub.version = TOML_VERSION.exec(line)?.[1] ?? sub.version
    const dep = group === null ? null : tomlLine(line)
    if (dep !== null && group !== null) add(groups, group, dep)
  }
  return grouped(groups)
}

const CARGO = new Set(['dependencies', 'dev-dependencies', 'build-dependencies'])
export const cargoDeps = (text: string): Group[] => tomlDeps(text, s => (CARGO.has(s) ? s : null))

const POETRY = /^tool\.poetry\.(dependencies|dev-dependencies|group\.[A-Za-z0-9_-]+\.dependencies)$/
const poetryGroup = (section: string): string | null => (POETRY.test(section) ? section : null)

// PEP 621 `[project] dependencies = [...]` (one line or many), then Poetry's tables.
export function pyprojectDeps(text: string): Group[] {
  const deps: Dep[] = []
  let section = ''
  let isInList = false
  for (const line of text.split('\n')) {
    section = SECTION.exec(line)?.[1]?.trim() ?? section
    const isStart = section === 'project' && /^\s*dependencies\s*=\s*\[/.test(line)
    if (!isStart && !isInList) continue
    const body = isStart ? line.slice(line.indexOf('[') + 1) : line
    for (const m of body.matchAll(QUOTED)) {
      const dep = pep508(m[1] ?? m[2] ?? '')
      if (dep !== null) deps.push(dep)
    }
    isInList = !body.replace(QUOTED, '').includes(']')
  }
  return [...(deps.length === 0 ? [] : [{ title: 'project.dependencies', deps }]), ...tomlDeps(text, poetryGroup)]
}

// A one-line `require mod v1.2.3`, without the keyword; any other line outside a block has none.
const requireSpec = (line: string): string => (/^require\s+/.test(line) ? line.replace(/^require\s+/, '') : '')

export function goDeps(text: string): Group[] {
  const deps: Dep[] = []
  let isInBlock = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (/^require\s*\($/.test(line)) { isInBlock = true; continue }
    if (isInBlock && line === ')') { isInBlock = false; continue }
    const spec = isInBlock ? line : requireSpec(line)
    const m = GO_LINE.exec(spec)
    if (m?.[1] !== undefined && m[2] !== undefined) deps.push({ name: m[1], version: m[2] })
  }
  return deps.length === 0 ? [] : [{ title: 'require', deps }]
}

export function gemDeps(text: string): Group[] {
  const deps = text.split('\n').flatMap(line => {
    const m = GEM.exec(line)
    return m?.[1] === undefined ? [] : [{ name: m[1], version: m[2] ?? '' }]
  })
  return deps.length === 0 ? [] : [{ title: 'gems', deps }]
}

const PUB_TOP = /^(dependencies|dev_dependencies):\s*(#.*)?$/
const PUB_DEP = /^(\s+)([A-Za-z0-9_]+):\s*(.*)$/

// pubspec.yaml: the keys one level under `dependencies:` and `dev_dependencies:`; a nested source (sdk, git,
// path) has no version.
export function pubspecDeps(text: string): Group[] {
  const groups = new Map<string, Dep[]>()
  let group: string | null = null
  let indent = ''
  for (const line of text.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue
    if (/^\S/.test(line)) { group = PUB_TOP.exec(line)?.[1] ?? null; indent = ''; continue }
    const m = group === null ? null : PUB_DEP.exec(line)
    if (m === null || m[1] === undefined || m[2] === undefined || group === null) continue
    if (indent === '') indent = m[1]
    if (m[1] !== indent) continue
    const version = (m[3] ?? '').replace(/\s#.*$/, '').trim().replace(/^["']|["']$/g, '')
    add(groups, group, { name: m[2], version })
  }
  return grouped(groups)
}
