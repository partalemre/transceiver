# Progress

Branch `claude/desktop-modes-transceiver-dev-urqs30` (based on `feat/transceiver-v1`). Checks after each task: `claude plugin validate .` (no errors), `claude plugin test .` (0 fail), `tsc` with the header tsconfig of the bundled `claude-code.d.ts` (kept outside the repo, since `.claude-plugin/types/` is only laid when a session loads the mod). Test counts are for the whole repo at commit time, so they include the parallel T10–T12 work.

| Task | Status | Commit | Tests |
| --- | --- | --- | --- |
| T0 spike | done | `f558f7c`, `8fb6348` | — |
| T1 scaffold | done | `fdb1570` | — |
| T2 protocol + ulid | done | `a6496ca`, `f6b3413` | — |
| T3 dbtext | done | `2c2f2ce`, `2913d5c`, `5063a48` | — |
| T4 relay | done (review fixes) | `f9b12b3`, `4dfcdbc`, `615618e` (kit-pull) | 70 |
| T5 timeline + sync | done | `17a9259` | 98 |
| T6 rooms + room page | done | `c544a9f` | 111 |
| T7 commands + join | done | `8cbb333` | 121 |
| T11 step 4 + gate fix | done | `d5e40df` | 170 |
| T13 budget + responder | done | `542b4fc` | 170 |
| T14 agent tools + live | done | `dc992bc` | 260 |

## T4 review fixes

1. **Head writes merge.** `send`, `markRead` and `writeHead` take only the fields their caller owns (`HeadPatch`: an object or a function of the current head) and the relay merges them over the stored head. A caller may pass `known: { head, version }` (its cached head): the write is pinned to that version and merged over that head, so the hot path has no read, and a stale cache costs one re-read and one retry, merged over the fresh head. Cursors only move forward (`seenUpTo`, `readUpTo` take the max), and `head` never moves back, so a late or retried write never rewinds anything. A head-only write that would change nothing is not sent. Tests: two sessions of the same person interleave `send`, `markRead` and a `gh`/`label` write with stale pins; every field survives.
2. **Delivered, not conflict.** A `(version_mismatch)` whose text names `writes[i] … targets <path>, which already exists` (`alreadyStoredPath` in `dbtext.ts`) for this message's own path is treated as delivered: the relay `get`s the message doc to confirm it, reads the head, and writes the head only when it does not already point at or past the message. A stale pin (`writes[1] … was pinned to version`) stays a conflict and is merged and retried once; the retry never re-sends a batch the server refused for an existing doc.
3. **Measured texts.** `tests/db-texts.ts` holds the verbatim committed, already-exists and stale-pin texts from `docs/spike-results.md`, plus builders; a test checks the builders reproduce the verbatim texts word for word, and `tests/fake-db.ts` answers every set/batch/get/list in those formats (`isReplyLost` simulates a write that landed but whose reply was lost). `parseWriteVersion` is tested on the verbatim committed batch.
4. **Small functions.** `relayOf` is now a table of one-line delegates over module-level functions (`whoami`, `heads`, `since`, `send`, `settleDelivered`, `writeMerged`, `attempt`, `readOwnHead`, `claim`), each under 40 lines, ≤ 3 params.

Deviations from the plan (Task 4 interface):

- `send`/`writeHead` take `patch` + `known` instead of `nextHead(prev)` + `version`, and `send` derives its own patch (advance `head`/`headTs`). The plan's "with a known version, `nextHead` receives `emptyHead()`" was the source of review item 1.
- `send`, `markRead`, `writeHead` resolve `HeadState` (`{ head, version }`) instead of a bare version, so the caller's cache is the merged head the server now holds.
- `markRead(opts)` added (the file map lists it; the plan's code had no such method).
- Also fixed pre-existing `tsc` errors: `parseHead`/`parseMeta` widened `v` to `number`, and three test index reads under `noUncheckedIndexedAccess`.
- `bin/kit-pull` resolves MODZ from `$MODZ`, else the repo's sibling `MODZ` folder, instead of a hard-coded Mac path.

## T5 timeline + sync

`hooks/timeline.ts` is the plan's code. `hooks/sync.ts` follows the plan's shape (`initialSync`, `enqueue`, `tick`, `nextDelay`) on the T4 relay API:

- The cached own head and version ride along as `known` on every `send` and `markRead`, and the merged `HeadState` the relay returns replaces the cache. The plan's `nextHead: prev => prev.head === '' ? head : …` trick is gone, since the relay merges.
- `acknowledge` calls `relay.markRead` with `seenUpTo` = newest pulled id, and `readUpTo` only while the room is open and receipts are on. It also catches up `readUpTo` to `seenUpTo` when the person opens a room whose messages were pulled while it was closed (the plan only marked read what was fresh in the same tick).
- `TickOpts.now` (optional) stamps `readTs`; without it the newest read message's `ts` stands in.
- Progress is kept on failure: messages sent before a failing step leave `pending`, and a failed pull keeps what the flush did. The plan returned the original state, so a delivered message would be re-sent (now harmless thanks to T4 item 2, but wasteful).
- `flush` stops at the first refusal, so messages land in order.
- When a `since` page comes back short, the peer's cursor moves to its `headTs`, so a doc that fails the guards (no readable `ts`) is not fetched on every tick.
- `KEEP_ENTRIES` (500) and `POLL_BACKOFF` (2) moved from `sync.ts` into `limits.ts`.

Tests: the plan's timeline and sync tests, plus a lost reply settled on the next tick, in-order flush, read catch-up on opening, `gh` kept across acks and sends, and the unreadable-doc cursor.

## T6 rooms + room page + loop

**Engine rule found while wiring (affects every later task):** the engine refuses to load a hooks module that passes `$` into a function imported from another file (`$ is followed only into a function declared in this same file, never across an import`), and `$.env.get` must take a literal name. The plan passes `$` everywhere (`createRoom({ $ })`, `startLoop($)`, `callerOf($)`, `joinRoom($, …)`). So:

- New `hooks/host.ts` (not in the file map): a `Host` port (`tool`, `storeGet`, `storeSet`, `now`, `after`, `every`, `home`, `writeFile`, `log`). `register.tsx` builds it from `$` in `hostOf($)` (the MODZ reflect-mod `io($)` pattern) and is the only file that holds `$`. `rooms.ts`, `room-loop.ts` and `relay.callerOf(host, consent?)` take the port. Later tasks (pane, notify, tools, responder) need the same: either their `$` work lives in `register.tsx`, or the port grows (e.g. `openPane`, `toast`, `status`).
- The test kit's `$` has only event nouns (`$.tool.call`, `$.session.start`, `$.command.run`, …), no `clock`/`store`, so unit tests use an in-memory `tests/fake-host.ts` (manual clock with `advance`). One test drives the real wiring: `$.session.start` with `mock.store`/`mock.clock`/`mock.env` and a `tool.call` hook answering from the fake db.

Plan deviations:

- `createRoom({ host, kind, repo?, consent? })`: `consent` rides on the publish and on the meta write (the session's first writes; T7 passes the command the person typed).
- Room capabilities add `{ path: 'meta', read: 'view', write: 'owner' }`: without it the default lets any `interact` guest overwrite `meta/room` (turning a DM into a project room).
- The publish URL is read from `result.url` first, then the text.
- `invitedFrom` keeps a listed URL only if it parses as a claude.ai artifact link (a `url` field is untrusted input).
- `recordOf({ url, meta, now, status })` is shared by discovery and joining (T7).
- Room page: subscribes to the newest `KEEP_ENTRIES` messages per author (`orderBy ts desc`; the plan's `asc` limit kept the oldest 500), handles a viewer with no `user.id()`, stamps `ts = max(now, headTs + 1)` so a phone with a slow clock still moves the head forward, and moves the head with `update({ head, headTs })` (a merge) when it exists, so it never drops the mod's cursors or `gh`. The input's `maxlength` comes from `PAGE_MAX_CHARS`.
- `room-loop.ts`: a failing step (e.g. `whoami` offline) is logged as `transceiver: <title>: <ErrorName>` and retried with backoff (the plan's loop stopped for good on the first throw and logged `String(err)`, which can carry tool text). `stopRoom` really stops a step already in flight from rescheduling. Messages queued during a tick are carried onto its result (`enqueueMessage({ host, room, message })`, for T8). The store is written only when the sync fingerprint changes, not every poll.
- New constants: `SHARED_LIST_LIMIT`, `PAGE_MAX_CHARS`.

## T7 commands + join

`/transceiver` with `ekle`, `proje <sahip/repo>`, `katıl <link>`, `çık <oda adı | link>`, `kur`, `ayarlar` (verbs fold Turkish letters, so `katil`/`cik` work too). As the spike decided there is no allow-rule setup: `kur`, `ayarlar` and no args open the pane, where T8's "Bağlan" card raises the session's first write.

Plan deviations:

- `register.tsx` holds the wiring (`on('command.run')`, `$.command.register`, `$.ui.open`), not `commands.ts`'s `wireCommands(on)`, for the `$` rule found in T6. `commands.ts` exports the pure `parseCommand` and `runCommand({ host, openPane, cmd })`. The command name is a literal `'transceiver'` in `register.tsx` (it equals `COMMAND`): with the imported constant `claude plugin validate` reads the matcher as `command=?` and lists the hook as a gate; with the literal it reads "answers its own command". The `command.run` hook has a `.catch` that answers a short Turkish line instead of nothing.
- One `session.start` hook does both registration and the loop (the engine refuses two unmatched hooks on one event); a refused registration is caught and logged so polling still starts.
- `ekle`/`proje` pass `The user ran "/transceiver …"` as `consent` on the publish and the meta write. A refused publish is reported (`Oda açılamadı: …`), not thrown.
- `joinRoom(host, text)` returns the plan's Turkish lines; joining only reads (meta), so it needs no consent; the room is saved `active` and polled at once. `joinUrlOf` accepts exactly one claude.ai artifact link and nothing else.
- `çık` requires a name or link, matches only rooms not already left, and refuses an ambiguous name (two DMs share the title `Transceiver · DM`) instead of leaving the first match; the plan's `endsWith('')` would have left the first room on a bare `çık`.

## Open questions

- Publishing the room page from `~/.claude/transceiver/rooms/<id>.html`: the spike measured `ArtifactData`, `Artifact list` and profiles, not `Artifact publish` from a mod. The page file is outside the session's working directory; whether `publish` accepts it (or asks) is unmeasured. If it refuses, write the page under the session's scratchpad or cwd instead.
- R2 (guest write from another account) is still unmeasured, as the spike notes; T6's room rules depend on it.
- The other agent's modules (T10–T12) and the later tasks (T8–T14) must follow the same `$` rule: only `register.tsx` may hold `$`; pass ports (`Host`, or narrower ones like `McpHost` in `github.ts`) into other files.

## T11 leftovers, T13 budget + responder, T14 agent tools + live

**Gate (T11 fix).** Owner, repo and login compare case-insensitively (`sameName` in `gate.ts`), in the gate, the responder's repo check, `projectRoomFor` and live mode. New gate condition: `GateInput.headGh`, the login the peer's head announces *now*, must equal the confirmed login, so a head that later claims another login (a real collaborator's) does not inherit the confirmation. The cache key is the lower-cased `repo#login`.

**Own login on the head (T11 step 4).** `identity.ts` is a tick listener (not inline in `room-loop.step`): in an `active` room, once the session is connected and the tick's writes were not refused, it writes `{ gh }` with `relay.writeHead` (merged, pinned to the cached head) when `ownHead.gh` differs, and hands the new head to the loop with `adoptOwnHead`. The login is `settings.gh` when set and valid, else `gh api user` (a miss is cached for `LOGIN_RETRY_MS`).

**Ports.** `AgentHost = Host & { run, realPath, readFile, root, readState, mcpCall, complete, sleep, sendSelf, note, toast, isConnected }` in `host.ts`, bound by `agentHostOf($)` in `register.tsx`. `isConnected` reads `connection.ts` (the pane's "Bağlan"). `run.ts`'s `runnerOf`/`realPathOf` now take the engine's call as a function (`runnerOf((argv, init) => $.process.run(argv, init))`), since a `$` passed into an imported function is refused. Other mods' state (`tests`, `plan` queries) is read through literal refs in `register.tsx` (`readState`). `mcpCheck` gets `{ mcp: { call: host.mcpCall } }`.

**Responder (`responder.ts`, wired by `responder-wire.ts`).** Order: own/unreadable/non-query → skipped; not connected → skipped *without* marking the query seen (it is answered once connected); then marked seen (a replayed qid is decided once per session); other repo → skipped, never claimed; stale (> `QUERY_TTL_MS`) or far-future (> `QUERY_FUTURE_SKEW_MS`) `ts` → skipped; > 60 queries/min per room → skipped; claim (create-only `outbox/{self}/claims/{qid}`; refused or throwing → skipped); gate (throwing = closed) → exactly `erişim yok`; typed → `answerTyped`; `ask` → question empty or > `ASK_MAX_QUESTION_CHARS` (2000) → denial before budget or model; budget spent → draft; else Haiku. The asker is always the outbox the message was read from, never a field of the message. Every reply passes `hasSecret` on the whole body before the split. Deviations from the plan:

- Candidates are every peer query still in the room's window (`state.entries`), not only the tick's fresh ones, so a query that arrived before connecting is answered after; `seen` (per room, pruned to the window) keeps it to one try per session, and claims keep it to one answer anywhere.
- Answer parts are structured: `Answer` gained optional `part`/`parts` (1-based, ≤ `MAX_ANSWER_PARTS`, both or neither; `protocol.ts` guards them), `answer.body` is the part alone and `text` is `i/n\n` + part for display. The plan parsed the `i/n` prefix out of the text, which a single-part body starting with `3/4\n` would fool. A refusal is always one part with `body === 'erişim yok'`.
- After the tick listeners run, a room whose listener queued a message is scheduled at 0 ms instead of the poll delay (`room-loop.ts`), so an answer leaves at once; a write that is refused leaves the pending count unchanged, so this never spins.
- `onTick` returns an unsubscribe (as do `onDrafts` and every `wire*`); `wireAgents` (`agents.ts`) unwires the previous set on a second `session.start`.

**Ask (`ask.ts`).** `askModel(port, { root, question, nonce })`: `haiku`, effort `low`, `maxTokens` 800, `timeoutMs` 20000; tokens are input + output + both cache counts. Repo facts (status, last 5 subjects, ≤ 200 tracked paths) list only paths `checkRelPath` would serve, so `.env`/key files are never even named. `fence(text, nonce)`: a 16-character random nonce per call on both markers, and any run of `<<<`/`>>>` inside the text is bent to `‹‹‹`/`›››` first, so a peer's text cannot close or open a fence.

**Budget + drafts.** `budget.ts`: pure `takeBudget`, `localDay` from local `Date` fields, `spendAsk(host, roomId)` in the store (`tx.budget`; a refusal writes nothing). `drafts.ts`: `tx.drafts`, one per qid; `settleDraft(host, { qid, isApproved })` (connected only; approve → model answer outside the limit, refuse → the denial; a draft of a left room is dropped). The pane reads them through `state.ts`'s `setDraftSource`/`setDraftSettler`, bound in `agents.ts`, and redraws on `onDrafts`.

**Tools (`tools.ts`).** `TOOL_SPECS` registered in `session.start` (`isDeferred: true`); one `tool.call` hook on the three literal names, with a `.catch` deny (validate lists it as a gating hook with `.catch`). Each tool reaches only `projectRoomFor(rooms, repoHere())`: an active project room of the session's repo (git `origin`, re-read once a minute). Input is checked before the connection, then `bağlantı bekleniyor` until connected; `inbox` only reads and works before connecting. `send` refuses empty, > 16 KB or secret-bearing text. `ask` validates `type`, `path` (file), `question` (ask, ≤ 2000 chars), scans path and question, round-trips the message through `parseMessage`, then waits. **Deviation:** the wait is bounded by the hook's own 10 s budget (`next.budget.remainingMs`, `$.clock.sleep` counts against it, `$` calls do not) as well as `ASK_WAIT_MS`: each step reads the peers' outboxes directly (`heads` + `since`, free of the budget) and sleeps 1 s, stopping with `ASK_WAIT_MARGIN_MS` left, then returns `pending:<qid>`. In practice that is ~8 s of sleeps plus read time, not 20 s. `collectAnswer` joins one author's parts by `part`, never mixes authors and ignores answers from the asker's own outbox. Every peer text handed to the model (inbox, ask result, live wake) is fenced.

**Live (`live.ts`).** A tick listener: only a project room with `isLive` (re-read from the store), of the session's repo, with fresh `agent`/`human`/`answer` messages from a peer, not while a main-loop turn runs (`turn.start`/`turn.complete` without `agentId`), at most once per `LIVE_COOLDOWN_MS` (30 s) per room; text cut to `LIVE_MAX_CHARS` and fenced. `wake` tries `$.session.send({ to: { sessionId } })`, and when not delivered appends a user row (`$.session.append`) plus a toast (spike R4).

Tests: `budget`, `ask`, `responder` (unit, adversarial: spoofed author, replay, other repo, unconnected, closed and throwing gate, secret in typed and ask answers, 10 001-char question, parts), `responder-wire` (real loop + fake db: claim doc, one answer, pre-claimed, changed head login, connect later), `drafts`, `identity`, `tools` (fake db end-to-end ask, fences), `tools-engine` (through the engine's `tool.call`), `live`, gate and protocol additions.

Open questions (agents):

- Live wake under an interactive session is still unmeasured (R4); `$.prompt.submit` ("starts a turn once the session is idle, so background work can wake a quiet session") may be the better primitive than a self-`session.send` if the measured send is not delivered there either.
- The ask budget lives in `$.store`; two sessions of the same person answering different asks at the same instant could each read 9 and both spend (11 in a day). Claims keep each question to one answer; only the count can overshoot by the number of concurrent sessions.
- The real `list_repository_collaborators` and `gh api …/collaborators/<login>` answers for a mixed-case owner are unmeasured; the gate lower-cases its comparisons and passes the query's spelling to GitHub, which is case-insensitive.
- Peers' confirmed logins (`RoomRecord.peers`) are written by the pane (T8); the gate trusts only `isGhConfirmed` + the current head's login.

