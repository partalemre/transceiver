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
| T7 commands + join | done | see git log `feat(commands)` | 121 |

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
