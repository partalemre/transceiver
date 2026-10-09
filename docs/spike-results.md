# Spike results (T0, 2026-10-09)

Probe: `spike/tx-probe`, run headless with `claude -p --permission-mode default --plugin-dir spike/tx-probe`. The probe runs from `session.start`. Its target was the spike artifact https://claude.ai/artifact/WY6LgKgyskkYWeg16kuUrb, owned by Emre.

| Risk | Result | Decision |
| --- | --- | --- |
| R1 reads | `ArtifactData` list/query/get, `Artifact list` and `profiles` all run from a mod without any permission prompt. | Polling and discovery need no setup. |
| R1 writes | Every write returns `{ deny }`: "Claude wants to write to this artifact's database … approving covers database writes to any artifact for the rest of this session". `--allowedTools ArtifactData` does not lift it. | There is no settings rule. One approval per session, raised by a user action. T7 drops the allow-rule setup. T8 adds a "Bağlan" card: the first write of a session happens when the user presses a pane button, and the call passes `consent`. The responder and agent tools do not write until the session is connected; until then they return `bağlantı bekleniyor`. A session in `bypassPermissions` is connected from the start. |
| R1 shape | The result is `{ result, text }`. `result.db_read.docs[].data` is **blanked** (`{}`). `result.db_read.me_id` holds the caller uid. `text` holds the full docs between the `BEGIN/END ARTIFACT DB` markers. | T3 parses `text` as planned. `whoami` may read `result.db_read.me_id` first and fall back to the text note. |
| R1 latency | 5 list reads: 577, 595, 698, 769, 847 ms. Median **698 ms**. | Keep `POLL_OPEN_MS = 1000`. |
| R2 guest write | Not run yet. It needs Alperen's account. | Must run before T16. If it fails, stop and re-plan T6. |
| R3 discovery | `Artifact list scope:'shared'` works, and `result.artifacts[]` is structured `{ title, url, rel }`. The text says "Artifacts shared from another organization are not listed". | Read `result.artifacts` instead of parsing text. `/transceiver katıl <url>` is required for cross-organization friends, so T7 implements it. |
| R4 self wake | Under `-p`, `$.session.send` resolves `{ isDelivered: false, reason: 'no live session…' }`. That is inconclusive for an interactive session. | T14 `wake` tries `session.send`. If `isDelivered` is false, it falls back to `session.append` plus a toast. |
| Names | `profiles` returned no name for the owner's own id, because the page declares `user: {}` without the profile scope. | Room pages declare `user: { scopes: ['profile'] }` (T6). The pane falls back to `Biri`. |
| Error texts (measured) | Conflict: `db write failed (version_mismatch): the document is no longer at version 99 … it is now at version 1; nothing was written`. Create over an existing doc: `db write failed (version_mismatch): … already exists and this write carried no if_version`. Missing or no access: `db write failed (invalid_argument): no such artifact, collection, or document (or no access …)`. | `errorKind`: `(version_mismatch)` → conflict. |
