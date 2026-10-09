import { DEPS_ITEM_CHARS, DEPS_MAX_PER_GROUP, MAX_DIFF_BYTES } from './limits'
import { cargoDeps, gemDeps, goDeps, npmDeps, pubspecDeps, pyprojectDeps, requirementsDeps, type Dep, type Group } from './queries-manifests'
import { servedText, shareable, type Out, type QueryCtx } from './queries-core'

const NO_MANIFEST = 'bağımlılık dosyası yok'
const UNKNOWN = '?'
// Names as registries spell them (npm scopes, Go module paths); versions as specs (`^1.2`, `>=3,<4`, `workspace:*`).
// Anything else, a URL or a path with credentials in it included, is left out or shown as `?`.
const NAME = /^[A-Za-z0-9@][A-Za-z0-9@._/+-]*$/
const VERSION = /^[A-Za-z0-9 .,*^~<>=!+_:-]*$/

// Only manifests at the root, each read exactly as the `file` query would serve it.
const MANIFESTS: ReadonlyArray<readonly [string, (text: string) => Group[]]> = [
  ['package.json', npmDeps], ['pyproject.toml', pyprojectDeps], ['requirements.txt', requirementsDeps],
  ['go.mod', goDeps], ['Cargo.toml', cargoDeps], ['Gemfile', gemDeps], ['pubspec.yaml', pubspecDeps],
]

function depLine(dep: Dep): string | null {
  if (!NAME.test(dep.name) || [...dep.name].length > DEPS_ITEM_CHARS) return null
  const version = dep.version.trim()
  const isShown = VERSION.test(version) && [...version].length <= DEPS_ITEM_CHARS
  const shown = isShown ? version : UNKNOWN
  return shown === '' ? `  ${dep.name}` : `  ${dep.name} ${shown}`
}

export function groupLines(file: string, group: Group): string[] {
  const lines = group.deps.flatMap(dep => {
    const line = depLine(dep)
    return line === null ? [] : [line]
  })
  if (lines.length === 0) return []
  const shown = lines.slice(0, DEPS_MAX_PER_GROUP)
  const more = lines.length - shown.length
  return [`${file} · ${group.title} (${lines.length})`, ...shown, ...(more > 0 ? [`  … ${more} daha`] : [])]
}

async function deps(ctx: QueryCtx): Promise<Out> {
  const lines: string[] = []
  for (const [file, parse] of MANIFESTS) {
    const text = await servedText(ctx, file)
    if (text !== null) for (const group of parse(text)) lines.push(...groupLines(file, group))
  }
  return lines.length === 0 ? { ok: true, body: NO_MANIFEST } : shareable(lines.join('\n'), MAX_DIFF_BYTES)
}

export const DEPS_HANDLERS = { deps: (ctx: QueryCtx) => deps(ctx) }
