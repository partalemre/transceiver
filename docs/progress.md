# Progress

Branch `claude/desktop-modes-transceiver-dev-urqs30` (based on `feat/transceiver-v1`). Checks after each task: `claude plugin validate .` (no errors), `claude plugin test .` (0 fail), `tsc` with the header tsconfig of the bundled `claude-code.d.ts` (kept outside the repo, since `.claude-plugin/types/` is only laid when a session loads the mod). Test counts are for the whole repo at commit time, so they include the parallel T10–T12 work.

| Task | Status | Commit | Tests |
| --- | --- | --- | --- |
| T0 spike | done | `f558f7c`, `8fb6348` | — |
| T1 scaffold | done | `fdb1570` | — |
| T2 protocol + ulid | done | `a6496ca`, `f6b3413` | — |
| T3 dbtext | done | `2c2f2ce`, `2913d5c`, `5063a48` | — |
| T4 relay | done (review fixes) | `f9b12b3`, then the review-fix commit | 70 |

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
