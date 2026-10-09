# Two-account E2E checklist

The simulated walk (`tests/e2e.test.ts`) runs two mods against one fake claude.ai that enforces the room rules. It cannot tell us what the real platform does. These steps are the real run. **Emre** (A, owner of `partalemre/eliti`) and **Alperen** (B, a collaborator on it) each use their own account, their own machine and their own Claude Code with the mod installed (`/plugin install transceiver --marketplace partalemre/transceiver`).

For each item, write the observed result next to it, and paste exact tool texts where it asks. Part 0 must pass before Part 1 means anything.

**Before you start**

- Both run `gh auth status` (logged in) and `git -C <eliti clone> remote get-url origin` (shows `partalemre/eliti`).
- Neither session runs in `bypassPermissions` unless an item says so.
- If an item fails, stop there and send the observed text. Do not work around it.

## Measured solo, 2026-10-09 (one account, engine 2.1.293)

What one person can measure without a second account, on a real room (`claude -p "/transceiver ekle"` in bypass mode, then `ArtifactData` with `as_level`):

- **0.1, bypass half.** `Oda hazır: https://claude.ai/artifact/…` in 2.9 s, no dialog. The page shows "Henüz mesaj yok"; the stored rules are the three of `rooms.ts`; `meta/room` holds `{ v: 1, kind: 'dm', createdAt }`. The normal-mode dialog count is still open.
- **0.3, platform half.** At `as_level: 'interact'` a write to `outbox/<own uid>/msgs` commits: the `outbox/{self}` `interact` rule lets a guest write their own outbox. The R2 risk is gone at the rule level; the pane's "Bağlan" flow still needs B's run.
- **0.4.** At `as_level: 'interact'`, writes to `meta` and to `outbox/<another uid>/msgs` are both refused with exactly `no such artifact, collection, or document (or no access — the two are deliberately indistinguishable)`, the text `tests/fake-db.ts` assumes.
- **Commands.** `/transceiver çık <link>` answers `Transceiver · DM odasından çıkıldı.`; an unknown verb prints the help list.

## Part 0 · Platform facts still unmeasured

These are the open questions in `docs/progress.md`. The mod depends on each one.

| # | Who | Steps | Expected | If it fails |
| --- | --- | --- | --- | --- |
| 0.1 | A | In a normal (not bypass) session in the eliti clone: `/transceiver ekle`. | At most one approval dialog. Its wording matches the consent `The user ran "/transceiver ekle"`. The reply is `Oda hazır: https://claude.ai/artifact/…`. The page opens on claude.ai and shows "Henüz mesaj yok". | **No URL, or "file_path" refused**: paste the reply. The page file is written to `<cwd>/.git/transceiver/room-<id>.html`; if Artifact will not publish from there, `rooms.ts pageFiles` must use Claude's scratchpad. **Two dialogs**: note both texts; the publish and the meta write need separate consent. |
| 0.2 | A → B | A: claude.ai → the room page → Share → B's email. B: wait 60 s with the pane open. | **Same organization**: an invite card "Kabul et / Reddet" appears. **Another organization**: no card (spike R3), and `/transceiver katıl <link>` answers `Transceiver · DM odasına katıldın.` | No card within 2 min in the same org: B runs `/transceiver katıl <link>` anyway, and we record that `Artifact list scope:'shared'` did not list it. `katıl` says "bu link bir Transceiver odası değil": B cannot read `meta` (sharing did not grant `view`); stop. |
| 0.3 | B | **R2 guest write.** B opens the DM in the pane, writes "selam", presses "Bağlan" and approves once. | The message leaves ◷, A sees it within 2 s with the pane open. In the room page B's message shows on the left for A. | **Refused**: paste the tool text (the pane shows "Onay verilmedi" or a red card). This is the R2 risk: the `outbox/{self}` `interact` rule does not let a guest write. Stop; T6's rules must be re-planned. |
| 0.4 | B | **Rules hold for a guest.** Ask Claude in B's session: "ArtifactData set on `<room url>`, collection `outbox/<A's uid>/msgs`, doc_id `x`, data `{}`", then the same on collection `meta`, doc_id `room`. | Both refused. Paste both texts. | **Either lands**: the room rules do not protect A's outbox or `meta`. Stop and report. **The text differs from "no such artifact, collection, or document (or no access …)"**: paste it; `tests/fake-db.ts` answers rule refusals with that text and must follow the real one. |
| 0.5 | A | **Names (`profiles`).** With B in the room, open the DM row in the pane. | The row and the toast say B's first name, not "Biri". | Shows "Biri": run `ArtifactData` `profiles` with B's uid in a session and paste the whole result (`result` and `text`). `names.ts` parses `db_profiles.profiles` as a map or a list, then the text; it must follow the real shape. |
| 0.6 | A | **Bypass mode.** Start `claude --permission-mode bypassPermissions` in the eliti clone, `/transceiver`. | No "Bu oturumda bağlan" card; a message goes out with no dialog. | Card shows: `classic.SessionStart` did not carry `permission_mode`. Pressing "Bağlan" still works; record it and leave it. |
| 0.7 | A | **Composer clears (desktop Code tab).** Send three messages in a row from the pane's composer. | After each send the field is empty and keeps the focus ring. | Text stays in the field: the desktop does not redraw an `Input` whose key changed; report. Field empties but loses focus: note it (known: the key rotates after a send). |
| 0.8 | A | **R4 live wake, interactive.** A has an idle eliti session with live on (the switch in the project room, item 1.17). B's agent: "transceiver send 'build kırıldı'". | A's session starts a turn by itself and reads the fenced message (`$.session.send` delivered). | No turn, but a toast "Transceiver: proje odasında yeni mesaj var" and a user row: the fallback ran (`isDelivered: false`). Record it; the next step is `$.prompt.submit`. Neither: report. |
| 0.9 | A | **Delete in a batch (compaction).** In a session, on the spike artifact: `ArtifactData batch` with writes `[{op:'set', collection:'outbox/<A uid>/days', doc_id:'2026-01-01', data:{v:1,ts:1,msgs:[]}}, {op:'delete', collection:'outbox/<A uid>/msgs', doc_id:'<an existing msg id>', if_version:<its version>}]`. Then the same delete again (the doc is gone), pinned to the old version. | First: committed, with a "documents used" line. Second: refused, nothing written. Paste both texts. | First refused: compaction cannot batch deletes; report the text. Second lands or names something else: paste it; `tests/fake-db.ts` assumes a stale-pin refusal. |
| 0.10 | A | **Rules for the owner.** On a test DM with B in it, ask Claude in A's session: "ArtifactData set on `<room url>`, collection `outbox/<B's uid>/msgs`, doc_id `x`, data `{}`". If it lands, delete that doc the same way. | Lands (paste the text). The db contract (0.2.75) says level rules never limit the artifact's owner and a `{self}` prefix rule must set `write`, so `{ path: 'outbox', write: 'owner' }` is already the narrowest rule that keeps every outbox readable: the owner can write any member's outbox. The intended rule is "each person, the owner included, writes only `outbox/<own uid>`". | **Refused**: the platform already keeps the owner out of a member's outbox; paste the text, and the "Room rules" item in `docs/progress.md` closes with no change. Any other text: paste it. |

## Part 1 · The T16 walk

Emre = A, Alperen = B. Each row has the step, the expected result, and what to check when it fails.

| # | Step | Expected | If it fails |
| --- | --- | --- | --- |
| 1.1 | A: `/transceiver` on the terminal and on the desktop Code tab. | The pane opens on both; other mods' bands and panes are unchanged. | Paste the debug log line for `transceiver` (a skipped hook says why). |
| 1.2 | A (not bypass): write the first message of a session. | "Bu oturumda bağlan" card → "Bağlan" → one dialog → the queued message goes out; later sends ask nothing. | A second dialog later in the session: record when; the connection is per session. |
| 1.3 | A↔B with the pane open on both. | Messages arrive in ≤ 2 s. Under A's message: ◷ → ✓ → ✓✓ → blue ✓✓ once B has the chat open. | Slow: note the pane's "sinyal" figure. Receipts stuck at ✓: B's head is not being written (check B is connected). |
| 1.4 | B: Ayarlar → okundu bilgisi off. Both keep chatting. | A never sees blue ✓✓ from B; B sees none from A (mutual). | — |
| 1.5 | B closes the pane. A writes. | B's status line shows `((·)) 1 okunmamış · …` and a toast with the first line. The pane does not open by itself. | — |
| 1.6 | A or B: open the room link in the Claude phone app. | The chat shows live and can send. | Read-only or blank: report what it shows. |
| 1.7 | A: `/transceiver proje partalemre/eliti`, share with B, B accepts. | On both sides a GitHub card "X GitHub'da Y mi?" → Evet. The project chat shows `@login · kapı açık`. | Card never shows: B's head has no `gh`; check `gh api user` works for B, or set the GitHub name in Ayarlar. |
| 1.8 | B's agent in an eliti session: `ask` status, log, branch, diff, file `lib/…`, tests, plan (and grep, files, todo, deps, commit once those land). | Each answers in ≤ 2 s, `0 token`. | `erişim yok`: check 1.7 on A's side (A must have confirmed B). |
| 1.9 | B's agent: `ask file .env.production`, then `ask file ../../etc/hosts`. | Both: exactly `erişim yok`. | Anything else is a security bug: stop and report. |
| 1.10 | A: a file with a fake AWS key (`AKIAIOSFODNN7EXAMPLE`) committed in a scratch branch; B asks for it. | `erişim yok`. | Same as 1.9. |
| 1.11 | B's agent: "transceiver send" a text holding `ghp_` + 36 letters. | Refused ("Mesaj gönderilmedi …"); nothing appears in the room. | Same as 1.9. |
| 1.12 | A: remove B as a collaborator on GitHub. Wait 10 min. B asks status. | `erişim yok`. Re-add B afterwards. | Still answered after 11 min: the gate cache is not expiring; report. |
| 1.13 | A opens two sessions on eliti. B asks status five times. | Each query answered exactly once (one answer card per question). | Two answers to one question: paste both `claims` docs (`ArtifactData list outbox/<A uid>/claims`). |
| 1.14 | A opens a session on another repo. B asks status. | That session never answers (the eliti session does). | — |
| 1.15 | B's agent: eleven `ask` questions in one day. | Ten answered by a small model (token count shown); the 11th shows a draft card on A ("Cevapla" / "Reddet"), and nothing is generated until A presses Cevapla. | The 11th is answered: two of A's sessions each spent from the budget at once (known, `progress.md`); retry with one session. |
| 1.16 | In the DM: B asks his agent to use the transceiver tools. | Refused: agents reach only the project room of the session's repo. | — |
| 1.17 | A: live on in the eliti room. B's agent sends a message. | A's idle eliti session wakes (see 0.8). Live off → no wake. | See 0.8. |
| 1.18 | A: `/transceiver çık DM`. | `Transceiver · DM odasından çıkıldı.` A's mod stops polling that room (no more `ArtifactData` calls on it in A's debug log). | — |
| 1.19 | A, as owner: `ArtifactData list outbox` and a few `msgs` of both rooms. | No session name, path, model name or repo list anywhere; the DM never names a repo. | Any of them: report the doc. |

## Not checked by hand

- **Compaction and rollover** need a week-old room or 20 000 docs. The simulated tests cover them (`tests/compact.test.ts`, `tests/retention.test.ts`). The one platform fact they need is 0.9. A rollover publishes with no consent, because nobody pressed anything. If 0.1 shows a publish from a mod always asks, a full room toasts "oda doldu ama yeni oda açılamadı" and tries again every 10 minutes until the person is there to approve.
