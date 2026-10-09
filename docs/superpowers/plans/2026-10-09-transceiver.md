# Transceiver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code mod named `transceiver`. It adds a `/transceiver` pane where people chat with friends entirely inside Claude. When both people are GitHub collaborators on a repo, their agents also exchange project information with each other, using zero model tokens for transport and typed queries.

**Architecture:** Each room is a private Claude Artifact with a `db` capability. Every member writes only to its own `outbox/{uid}` subtree, and the server enforces this. The mod reads and writes rooms through `$.tool.call({ tool: 'ArtifactData' })`. An adaptive poller reads every member's head doc in one `list outbox` call. A responder answers typed agent queries with git and file reads, behind a GitHub-collaborator gate, and uses server-side create-only `claims` so each query is answered exactly once.

**Tech Stack:** Claude Code mod hooks API (TypeScript/TSX, `claude-code` and `claude-code/testing`). Claude Artifacts (`db`, `user`). Built-in tools `ArtifactData` and `Artifact`. GitHub MCP or `gh` CLI. `git`.

**Spec:** `docs/superpowers/specs/2026-10-09-transceiver-design.md` · **Design canvas:** https://claude.ai/artifact/QJAYV1gwXXsEhX9cYopTU8

## Global Constraints

- Repo root: `/Users/partalle/Projects/transceiver`, a sibling of MODZ and never inside it. Mod folder: the repo root itself, which holds `.claude-plugin/plugin.json`.
- Link: `ln -s /Users/partalle/Projects/transceiver ~/.claude/skills/transceiver`. Marketplace: `partalemre/transceiver`. Install: `/plugin install transceiver --marketplace partalemre/transceiver`.
- Pane id `transceiver`. State namespace `{ plugin: 'transceiver' }`. Store keys prefixed `tx.`. Tool names `send`, `inbox`, `ask` (the model sees `mcp__transceiver__send` etc.). Command `transceiver`.
- Do not touch other mods: no `ui.render` hook on any component except `Pane` with `requestId: 'transceiver'`, no `AbovePrompt` band, no writes to another plugin's state.
- Protocol version `v: 1`. Denial text is exactly `erişim yok`. Message ≤ 16384 UTF-8 bytes, `diff` ≤ 65536 bytes, `file` ≤ 262144 bytes, `log` = last 20 commits.
- Poll interval: 1000 ms with the pane open, 5000 ms with it closed. Backoff ×2 per failure, capped at 30000 ms. Invite discovery every 60000 ms.
- `ask`: model `haiku`, effort `low`, `maxTokens` 800, `timeoutMs` 20000, 10 per room per local day. When the limit is reached, the answer becomes a draft that needs approval.
- `transceiver_ask` waits for an answer for at most 20000 ms. Queries expire after 600000 ms.
- Collaborator cache 600000 ms. The gate fails closed.
- Retention: messages older than 7 days are compacted into `days/{yyyy-mm-dd}`. A room rolls over at 20000 docs.
- Files ≤ 300 lines, functions ≤ 40 lines, ≤ 3 params (use an options object). No magic numbers: constants go in `hooks/limits.ts`. Booleans start with is/has/can/should. Conventional commits, ≤ 72 chars, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Copy is Turkish in the UI. Code identifiers and comments are English.
- Never log message bodies, tokens, or paths outside the repo.

## File map

| File | Responsibility |
| --- | --- |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | manifest, marketplace |
| `hooks/hooks.json` | `{ "modules": ["./register.tsx"] }` |
| `hooks/register.tsx` | wiring only: events → modules |
| `hooks/limits.ts` | every numeric constant |
| `hooks/protocol.ts` | doc types, guards, paths, `DENIED` |
| `hooks/ulid.ts` | sortable ids |
| `hooks/dbtext.ts` | parse `ArtifactData` / `Artifact` text results |
| `hooks/relay.ts` | `Relay`: whoami, heads, since, send, markRead, claim |
| `hooks/timeline.ts` | merge, order, and receipt status of messages |
| `hooks/sync.ts` | poll loop, cursors, pending outbox, delay policy |
| `hooks/rooms.ts` | room registry in `$.store`; create, discover, accept, leave |
| `hooks/room-page.ts` | HTML of the room's web page (published as the artifact) |
| `hooks/state.ts` | atoms and their contract types |
| `hooks/pane.tsx`, `hooks/pane-list.tsx`, `hooks/pane-chat.tsx`, `hooks/pane-cards.tsx` | the pane |
| `hooks/notify.ts` | status entry and toast |
| `hooks/commands.ts` | `/transceiver` subcommands, permission-rule setup |
| `hooks/secrets/detect.ts`, `hooks/secrets/jwt.ts` | vendored from MODZ `mods/secret-guard/hooks` |
| `hooks/pathguard.ts` | repo-relative path policy |
| `hooks/github.ts` | collaborator check (MCP, then `gh`) |
| `hooks/gate.ts` | the four-condition gate, cached, fail-closed |
| `hooks/queries.ts` | typed query answers (git, fs) |
| `hooks/budget.ts` | `ask` daily budget |
| `hooks/responder.ts` | claim, gate, answer, draft |
| `hooks/tools.ts` | agent tools `send`, `inbox`, `ask`; live wake |
| `hooks/compact.ts` | 7-day compaction, rollover |
| `hooks/kit/*` | copied from MODZ `kit/` by `bin/kit-pull` |
| `types/index.d.ts` | `PluginState` contract |
| `tests/*.test.ts` | behaviour tests (`claude plugin test .`) |
| `bin/kit-pull`, `bin/vendor-sync` | copy kit and secret patterns from MODZ |

## Phases

| Phase | Tasks | File |
| --- | --- | --- |
| 0 · Spike | T0 | [phase-0-spike.md](2026-10-09-transceiver/phase-0-spike.md) |
| 1 · Core | T1 scaffold · T2 protocol + ulid · T3 dbtext · T4 relay | [phase-1-core.md](2026-10-09-transceiver/phase-1-core.md) |
| 2 · Sync and rooms | T5 timeline + sync · T6 rooms + room page · T7 commands + setup | [phase-2-sync-rooms.md](2026-10-09-transceiver/phase-2-sync-rooms.md) |
| 3 · Pane | T8 pane · T9 notify | [phase-3-pane.md](2026-10-09-transceiver/phase-3-pane.md) |
| 4 · Agents | T10 secrets + pathguard · T11 github + gate · T12 queries · T13 budget + responder · T14 agent tools + live | [phase-4-agents.md](2026-10-09-transceiver/phase-4-agents.md) |
| 5 · Ship | T15 compaction · T16 two-account E2E + release | [phase-5-ship.md](2026-10-09-transceiver/phase-5-ship.md) |

Order: T0 gates everything. T1→T4 are sequential. T5–T7 depend on T4. T8–T9 depend on T5–T6. T10–T12 are independent of each other once T1 is done. T13 needs T10–T12. T14 needs T4 and T13. T15 needs T5. T16 comes last.

## Definition of done

- `claude plugin validate .` reports no errors.
- `claude plugin test .` passes.
- `tsc -p .` is clean.
- The two-account E2E checklist in T16 passes: DM, read receipts, project room, typed query, `.env` denial, `ask` budget draft, leave.
