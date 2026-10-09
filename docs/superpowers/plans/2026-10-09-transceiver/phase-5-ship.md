# Phase 5 · Ship

### Task 15: Compaction and rollover

**Files:**
- Create: `hooks/compact.ts`
- Modify: `hooks/relay.ts` (add `older`, `day`, `compactDay`, `usage`), `hooks/dbtext.ts` (add `parseDocsUsed`), `hooks/room-loop.ts` (run compaction daily, check rollover)
- Test: `tests/compact.test.ts`

**Interfaces:**
- Consumes: `Relay`, `parseDocs` (T3/T4). `COMPACT_AFTER_MS`, `ROLLOVER_DOCS` (T1). `createRoom`, `saveRooms`, `loadRooms` (T6). `enqueue`, `putSync`, `syncOf` (T5/T6).
- Produces:
  - `parseDocsUsed(text): number | null` (dbtext)
  - On the relay:
    ```ts
    older(uid: string, beforeTs: number): Promise<Array<{ message: Message; version: number }>>
    day(uid: string, day: string): Promise<{ msgs: Message[]; version: number } | null>
    compactDay(opts: { uid: string; day: string; msgs: Message[]; dayVersion?: number; deletes: Array<{ id: string; version: number }> }): Promise<void>
    usage(): number | null
    ```
  - `groupByDay(items: Array<{ message: Message; version: number }>): Map<string, Array<{ message: Message; version: number }>>` (pure, UTC day)
  - `deleteBatches<T>(items: T[]): T[][]` (pure, ≤ 49 per batch, leaving room for the day doc in a 50-write batch)
  - `compactRoom(opts: { relay: Relay; uid: string; now: number }): Promise<number>`, which returns the number of messages moved

- [ ] **Step 1: Failing tests**

`tests/compact.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { deleteBatches, groupByDay } from '../hooks/compact'
import { parseDocsUsed } from '../hooks/dbtext'

const item = (id: string, ts: number) => ({ message: { v: 1 as const, id, ts, kind: 'human' as const, text: id }, version: 1 })

test('messages group by UTC day', () => {
  const day1 = Date.UTC(2026, 9, 1, 23, 0)
  const day2 = Date.UTC(2026, 9, 2, 1, 0)
  const groups = groupByDay([item('A', day1), item('B', day2), item('C', day1 + 1)])
  expect([...groups.keys()]).toEqual(['2026-10-01', '2026-10-02'])
  expect(groups.get('2026-10-01')?.length).toBe(2)
})

test('deletes split so each batch fits beside the day doc', () => {
  const batches = deleteBatches(Array.from({ length: 120 }, (_, i) => i))
  expect(batches.map(b => b.length)).toEqual([49, 49, 22])
})

test('docs used is read from any write result', () => {
  expect(parseDocsUsed('5 of 25000 documents used in this artifact\'s database.')).toBe(5)
  expect(parseDocsUsed('nothing')).toBe(null)
})
```

- [ ] **Step 2: Implement**

In `hooks/dbtext.ts`, add:
```ts
const USED = /(\d+) of \d+ documents used/

export const parseDocsUsed = (text: string): number | null => {
  const hit = USED.exec(text)
  return hit === null ? null : Number(hit[1])
}
```

In `hooks/relay.ts`:
- In `run()`, before returning `text`, record the usage: `const used = parseDocsUsed(text); if (used !== null) lastUsed = used`. Here `let lastUsed: number | null = null` is declared inside `relayOf`, so pass it to `run` through a small setter: `run(call, input, used => { lastUsed = used })`.
- Add these to the returned object:
```ts
    async older(uid, beforeTs) {
      const query = { where: [['ts', '<', beforeTs]], order_by: { field: 'ts', direction: 'asc' }, limit: SINCE_PAGE }
      const docs = parseDocs(await exec({ action: 'query', collection: paths.msgs(uid), query }))
      return docs.flatMap(d => {
        const message = parseMessage(d.id, d.data)
        return isUnreadable(message) ? [] : [{ message, version: d.version }]
      })
    },
    async day(uid, day) {
      try {
        const doc = parseDocs(await exec({ action: 'get', collection: paths.days(uid), doc_id: day }))[0]
        const msgs = Array.isArray(doc?.data.msgs) ? (doc.data.msgs as unknown[]) : []
        return doc === undefined ? null : { msgs: msgs.map(m => parseMessage(String((m as { id?: string }).id ?? ''), m)).filter((m): m is Message => !isUnreadable(m)), version: doc.version }
      } catch (err) {
        if (err instanceof RelayError && err.kind === 'missing') return null
        throw err
      }
    },
    async compactDay({ uid, day, msgs, dayVersion, deletes }) {
      const dayWrite = { op: 'set', collection: paths.days(uid), doc_id: day, data: { v: 1, msgs }, ...(dayVersion === undefined ? {} : { if_version: dayVersion }) }
      const dels = deletes.map(d => ({ op: 'delete', collection: paths.msgs(uid), doc_id: d.id, if_version: d.version }))
      await exec({ action: 'batch', writes: [dayWrite, ...dels] })
    },
    usage: () => lastUsed,
```
Add `isUnreadable` to the protocol import.

`hooks/compact.ts`:
```ts
import { COMPACT_AFTER_MS } from './limits'
import type { Message } from './protocol'
import type { Relay } from './relay'

const BATCH_DELETES = 49
type Item = { message: Message; version: number }

export const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10)

export function groupByDay(items: Item[]): Map<string, Item[]> {
  const groups = new Map<string, Item[]>()
  for (const item of items) {
    const key = dayOf(item.message.ts)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return groups
}

export function deleteBatches<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += BATCH_DELETES) out.push(items.slice(i, i + BATCH_DELETES))
  return out
}

// Only the author's own messages: each person compacts their own outbox, which is all the rules let them write.
export async function compactRoom(opts: { relay: Relay; uid: string; now: number }): Promise<number> {
  const old = await opts.relay.older(opts.uid, opts.now - COMPACT_AFTER_MS)
  let moved = 0
  for (const [day, items] of groupByDay(old)) {
    for (const batch of deleteBatches(items)) {
      const existing = await opts.relay.day(opts.uid, day)
      const msgs = [...(existing?.msgs ?? []), ...batch.map(b => b.message)]
      await opts.relay.compactDay({ uid: opts.uid, day, msgs, dayVersion: existing?.version, deletes: batch.map(b => ({ id: b.message.id, version: b.version })) })
      moved += batch.length
    }
  }
  return moved
}
```

In `hooks/room-loop.ts`, after a successful `step`:
- Once per day per room (store key `tx.compacted.<roomId>` = day), call `compactRoom({ relay, uid: state.selfUid, now })`. Errors are logged with the room title only.
- If `relay.usage() !== null && relay.usage()! >= ROLLOVER_DOCS && room.isOwner`, call `createRoom({ $, kind: room.kind, repo: room.repo })`. Then enqueue a `system` message into the old room with text `Oda doldu, yeni oda: <url>`, mark the old room `status: 'left'`, save, and toast `Transceiver: oda doldu; yeni odayı Paylaş ile tekrar davet et.`

- [ ] **Step 3: Test and commit**

Run: `claude plugin test . && tsc -p .`
Expected: PASS.
```bash
git add hooks/compact.ts hooks/relay.ts hooks/dbtext.ts hooks/room-loop.ts tests/compact.test.ts
git commit -m "feat(retention): compact week-old messages into day docs, roll over full rooms" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Two-account E2E, README, release

**Files:**
- Modify: `README.md`, `.claude-plugin/plugin.json` (version stays `0.1.0`)
- Create: `docs/e2e.md` (filled-in checklist)

**Interfaces:**
- Consumes: everything.
- Produces: a tagged `v0.1.0` and a marketplace that installs.

- [ ] **Step 1: Full checks**

Run: `claude plugin validate . && claude plugin test . && tsc -p .`
Expected: no errors, all tests pass.

- [ ] **Step 2: Two-account checklist** (Emre = A, Alperen = B; each in their own Claude Code with the mod installed)

Copy this into `docs/e2e.md` and tick each item with the observed result:
```markdown
- [ ] A: `/transceiver` opens the pane on terminal and on the desktop Code tab; other mods' bands and panes unchanged
- [ ] A (not in bypass mode): first send shows the "Bu oturumda bağlan" card → Bağlan → one approval dialog → queued message goes out; later sends in the session ask nothing
- [ ] B (other organization): invite not listed → `/transceiver katıl <link>` joins
- [ ] A: `/transceiver ekle` → room artifact published, link shown; A shares it with B by email
- [ ] B: invite card appears within 60 s → Kabul et
- [ ] A↔B: messages arrive in ≤ 2 s with the pane open; ✓ → ✓✓ → blue ✓✓
- [ ] B: turn read receipts off → A never sees blue ✓✓ from B, B sees none from A
- [ ] Pane closed: status shows `((·)) n`, toast shows the first line
- [ ] Phone: the room link in the Claude app shows the chat live and can send
- [ ] A: `/transceiver proje partalemre/eliti` → shared with B; GitHub confirm card on both sides → Evet
- [ ] B's agent (in an eliti session): `ask` status/log/diff/file lib/... → answers in ≤ 2 s, `0 token`
- [ ] B's agent: `ask file .env.production` → `erişim yok`; `ask file ../../etc/hosts` → `erişim yok`
- [ ] Remove B as collaborator on GitHub → within 10 min every query → `erişim yok`
- [ ] Two A sessions open on eliti → each query answered exactly once
- [ ] A session on another repo → never answers eliti queries
- [ ] 11th `ask` in a day → draft card on A, nothing generated until Cevapla
- [ ] DM: agent tools refuse (`deny`) — agents cannot write into a DM
- [ ] Live on → B's agent message wakes A's idle eliti session; live off → no wake
- [ ] `/transceiver çık DM` → polling stops for that room
- [ ] No session name, path, model or repo list appears in any room's db (`ArtifactData list outbox` and a few `msgs` read as owner)
```

- [ ] **Step 3: README**

Replace `README.md` with: what it does (3 lines). Install (`/plugin install transceiver --marketplace partalemre/transceiver`, then `/transceiver`). Explain the one approval per session for sending and `katıl <link>` for friends in another organization. Commands (the HELP text from `commands.ts`). Agent tools (`send`, `inbox`, `ask` and the query types). Privacy (what is stored where, what is never stored, the gate, `erişim yok`). Costs (transport and typed queries 0 tokens, `ask` Haiku ≤ 10/day/room, live mode wakes cost tokens). Limits (polling, 25,000 docs, compaction). Copy the privacy and costs wording from the spec.

- [ ] **Step 4: Commit, then publish (ask first)**

```bash
git add README.md docs/e2e.md
git commit -m "docs: add readme and two-account e2e results" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag v0.1.0
```
Before creating `partalemre/transceiver` on GitHub and pushing, ask the user in chat. This is outward-facing. Once they say yes:
```bash
gh repo create partalemre/transceiver --private --source . --push
git push origin v0.1.0
```
Repo visibility is the user's call. A private repo means Alperen needs read access before `/plugin install` works for him.
