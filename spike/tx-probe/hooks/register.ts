import type { EngineInterface, Register } from 'claude-code'

const ROUNDS = 5

type Sample = { ms: number; keys: string[]; hasText: boolean; isError: boolean; deny?: string; head: string; resultType: string; error?: string }

async function timed($: EngineInterface, input: Record<string, unknown>): Promise<Sample> {
  const start = await $.clock.now()
  try {
    const out = (await $.tool.call(input as never)) as Record<string, unknown>
    const ms = (await $.clock.now()) - start
    const text = typeof out.text === 'string' ? out.text : ''
    return {
      ms, keys: Object.keys(out), hasText: text.length > 0, isError: out.isError === true,
      deny: typeof out.deny === 'string' ? out.deny : undefined, head: text.slice(0, 600),
      resultType: JSON.stringify(out.result)?.slice(0, 600) ?? 'undefined',
    }
  } catch (err) {
    return { ms: (await $.clock.now()) - start, keys: [], hasText: false, isError: true, head: '', resultType: '', error: String(err) }
  }
}

async function probe($: EngineInterface): Promise<void> {
  const url = (await $.env.get('TX_PROBE_URL')) ?? ''
  const out = (await $.env.get('TX_PROBE_OUT')) ?? ''
  if (url === '' || out === '') return
  const reads: Sample[] = []
  for (let i = 0; i < ROUNDS; i++) reads.push(await timed($, { tool: 'ArtifactData', action: 'list', url, collection: 'outbox' }))
  const whoami = await timed($, { tool: 'ArtifactData', action: 'list', url, collection: 'data/users/me', query: { limit: 1 } })
  const query = await timed($, { tool: 'ArtifactData', action: 'query', url, collection: 'outbox/u_OILIt9wuDiBBxrdcLpQjLA/msgs', query: { where: [['ts', '>', 0]], order_by: { field: 'ts', direction: 'asc' }, limit: 50 } })
  const profiles = await timed($, { tool: 'ArtifactData', action: 'profiles', url, ids: ['u_OILIt9wuDiBBxrdcLpQjLA'] })
  const shared = await timed($, { tool: 'Artifact', action: 'list', scope: 'shared', limit: 20 })
  const write = await timed($, { tool: 'ArtifactData', action: 'batch', url, writes: [{ op: 'set', collection: 'outbox/u_OILIt9wuDiBBxrdcLpQjLA/claims', doc_id: `probe${await $.clock.now()}`, data: { v: 1, at: 1 } }] })
  const publish = await timed($, { tool: 'Artifact', action: 'list', scope: 'mine', limit: 1 })
  let wake = 'skipped'
  if ((await $.env.get('TX_PROBE_WAKE')) === '1') {
    wake = await $.session.send({ to: { sessionId: await $.session.id() }, text: 'tx-probe: self wake test' }).then(r => JSON.stringify(r), e => `rejected: ${String(e)}`)
  }
  await $.fs.write(out, JSON.stringify({ reads, whoami, query, profiles, shared, write, publish, wake }, null, 2))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await probe($)
    return next(e)
  })
}
