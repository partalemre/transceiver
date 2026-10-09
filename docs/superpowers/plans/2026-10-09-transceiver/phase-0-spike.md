# Phase 0 · Spike

This phase closes the spec's four open risks before any product code is written. Everything here is throwaway, except `docs/spike-results.md`, which records what the spike found.

### Task 0: Probe tool calls, guest access, discovery, self-wake

**Files:**
- Create: `spike/tx-probe/.claude-plugin/plugin.json`
- Create: `spike/tx-probe/hooks/hooks.json`
- Create: `spike/tx-probe/hooks/register.ts`
- Create: `docs/spike-results.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/spike-results.md`, which answers R1–R4 below. T3 (`dbtext.ts`) and T14 (`tools.ts`, live mode) read it.

- [ ] **Step 1: Write the probe mod**

`spike/tx-probe/.claude-plugin/plugin.json`:
```json
{ "name": "tx-probe", "version": "0.0.1", "description": "Transceiver spike: measures ArtifactData calls from a mod" }
```

`spike/tx-probe/hooks/hooks.json`:
```json
{ "modules": ["./register.ts"] }
```

`spike/tx-probe/hooks/register.ts`:
```ts
import type { EngineInterface, Register } from 'claude-code'

const ROUNDS = 5
const REPORT = '/Users/partalle/Projects/transceiver/docs/spike-results.json'

type Sample = { ms: number; keys: string[]; hasText: boolean; isError: boolean; deny?: string; head: string }

async function timed($: EngineInterface, input: Record<string, unknown>): Promise<Sample> {
  const start = await $.clock.now()
  const out = (await $.tool.call(input as never)) as Record<string, unknown>
  const ms = (await $.clock.now()) - start
  const text = typeof out.text === 'string' ? out.text : ''
  return {
    ms, keys: Object.keys(out), hasText: text.length > 0, isError: out.isError === true,
    deny: typeof out.deny === 'string' ? out.deny : undefined, head: text.slice(0, 400),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tx-probe', description: 'Transceiver spike', argumentHint: '<artifact url>' })
    return next(e)
  })

  on('command.run', { command: 'tx-probe' }, async ($, e) => {
    const url = e.args.trim()
    const reads: Sample[] = []
    for (let i = 0; i < ROUNDS; i++) reads.push(await timed($, { tool: 'ArtifactData', action: 'list', url, collection: 'outbox' }))
    const write = await timed($, {
      tool: 'ArtifactData', action: 'set', url, collection: 'data/users/me', doc_id: 'probe', data: { at: await $.clock.now() },
    })
    const shared = await timed($, { tool: 'Artifact', action: 'list', scope: 'shared', limit: 50 })
    const sessionId = await $.session.id()
    const wake = await $.session.send({ to: { sessionId }, text: 'tx-probe: self wake test' }).then(
      r => JSON.stringify(r), err => `rejected: ${String(err)}`,
    )
    await $.fs.write(REPORT, JSON.stringify({ reads, write, shared, wake }, null, 2))
    return { text: `tx-probe: ${REPORT} yazıldı` }
  })
}
```

- [ ] **Step 2: Run the probe as the owner**

Run, in a terminal:
```bash
claude --plugin-dir /Users/partalle/Projects/transceiver/spike/tx-probe
```
Then type `/tx-probe https://claude.ai/artifact/WY6LgKgyskkYWeg16kuUrb` in that session.
Expected: `docs/spike-results.json` exists. Note every permission dialog that appears, and for which tool.

- [ ] **Step 3: Run the guest test (needs a second account)**

1. In claude.ai, open the spike artifact → Share → invite the second account (Alperen) with the ability to use the page.
2. The second account runs the same probe from its own Claude Code, with the same URL.
3. Expected: the `write` sample has `isError: false`. The `shared` sample's `head` lists the spike artifact.

- [ ] **Step 4: Record the answers and decide**

Write `docs/spike-results.md`, with one line per risk plus the measured median `ms` of the 5 reads. Then apply this decision table:

| Risk | Result | Decision (exact change) |
| --- | --- | --- |
| R1 permission | No dialog | Nothing to change. Delete the permission card from T7 Step 3. |
| R1 permission | Dialog per call | T7 keeps `/transceiver kur`, which adds `"ArtifactData"` and `"Artifact"` to `permissions.allow` in `~/.claude/settings.json` after the user's yes. |
| R1 result shape | `text` holds the `BEGIN ARTIFACT DB` block | Use T3 as written. |
| R1 result shape | `result` is structured JSON | In T3, `parseDocs` reads `result.documents` first and falls back to the text block. Add one test with the observed object. |
| R1 latency | median ≤ 700 ms | Keep a 1000 ms poll. |
| R1 latency | median > 700 ms | Set `POLL_OPEN_MS` in `limits.ts` to `median + 300`. |
| R2 guest write | Works | Nothing to change. |
| R2 guest write | Refused | Stop. Report to the user. Fallback: rooms owned by each side, with each user reading the other's room (two artifacts per DM). Re-plan T6. |
| R3 discovery | Shared list shows it | Use T6 `discoverInvites` as written. |
| R3 discovery | Not shown | T6 adds `/transceiver katıl <url>`, and `discoverInvites` becomes a no-op. |
| R4 self wake | Resolves and a turn starts | T14 live mode uses `$.session.send` to the session id. |
| R4 self wake | Rejected or no turn | T14 live mode uses `$.session.append` of a user-role row plus a toast. The turn starts at the next prompt. Document this in the README. |

- [ ] **Step 5: Commit**

```bash
cd /Users/partalle/Projects/transceiver
git add spike docs/spike-results.md
git commit -m "chore(spike): measure artifact db calls from a mod" -m "Closes the four open risks in the spec before product code." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
`docs/spike-results.json` holds raw samples. Add it only after checking that it contains no message bodies (it should hold only `outbox` heads and the probe doc).
