<p align="center"><sub>TRANSCEIVER · BETA · A MOD FOR CLAUDE CODE, PART OF <a href="https://github.com/partalemre/MODZ">MODZ</a></sub></p>

<h1 align="center">Your team, inside Claude.</h1>

<p align="center">Chat with teammates. Let your agents ask theirs. Zero tokens.</p>

<p align="center"><img src="https://raw.githubusercontent.com/partalemre/MODZ/main/docs/img/team.jpg" width="820" alt="Two Claude Code windows in the same project room: teammates chatting, and one agent's diff question answered by the other machine at zero tokens"></p>

You chat with friends without leaving Claude Code, and on a GitHub repo you share, your agent can ask a teammate's side about the project: `status`, `diff`, `tests`, `log`, a file. The answer is computed on their machine without a model, so it costs no tokens. Everything you write stays in a private claude.ai artifact you own; there is no server of its own.

> **Beta.** Transceiver works end to end (DMs, project rooms, read receipts and agent questions are tested live between two sessions), and it is still being tried across more accounts and setups. If something breaks, [open an issue](https://github.com/partalemre/transceiver/issues).

## Install

```text
/plugin marketplace add partalemre/MODZ
/plugin install transceiver@modz
```

Then type `/transceiver`. The pane opens, and every step is a button there.

- **Requirements.** Claude Code 2.1.295 or later, signed in with a claude.ai account.
- **SDK hosts.** If Claude Code runs inside another app (an IDE, T3 Code, `claude -p`), the claude.ai Artifact tools are off by default. Add `"CLAUDE_CODE_ARTIFACT": "1"` to the `env` block of `~/.claude/settings.json` and start a new session. The desktop app and the terminal do not need this.
- **Language.** The interface is English. Set `MODZ_LANG=tr` for Turkish.

## How it works

A room is made of mailboxes, one per member. Only you write to yours, and the other members read it. This is why the share level you pick (Viewer is enough), or your friend being in another organization, makes no difference.

1. **Open a room.** In the pane, **Add a friend** opens a DM; **Project room** opens a room for a repo you share, prefilled with the session's repo. The pane shows your mailbox link.
2. **Share your mailbox.** Open the link on claude.ai, add your friend by email from the page's **Share** menu, and send them the link. This step is manual because claude.ai has no sharing API.
3. **They join.** In the same organization, an invite card appears in their pane within a minute. From another organization, invites are not listed, so they paste your link into **I have a link** (or type `/transceiver join <link>`). Joining opens their own mailbox.
4. **They share back.** They share their mailbox with you the same way and send you its link; until you have read one of their lines, their chat keeps that link on screen with **Copy link**. Paste it into **I have a link** on your side.
5. **Connect.** The first message of a session asks Claude Code for one approval. A session started with permissions bypassed is connected from the start.
6. **Match GitHub names (project rooms).** Each side writes its GitHub login into its own mailbox, and the chat asks once: "Is Leo @leo on GitHub?". Say yes, and that person's agent may ask about the repo.

Messages arrive in about a second while the pane is open. With it closed, the status line counts unread messages and a notification shows. Under each message: ◷ sending, ✓ written, ✓✓ delivered, blue ✓✓ read. Turning read receipts off turns them off both ways.

## Commands

Every command is also a button in the pane. The Turkish words (`ekle`, `proje`, `katıl`, `çık`, `kur`, `ayarlar`) work too.

| Command | What it does |
| --- | --- |
| `/transceiver` | Opens the pane |
| `/transceiver add` | Opens a DM room for a friend |
| `/transceiver project <owner/repo>` | Opens a shared project room |
| `/transceiver join <link>` | Joins a room by mailbox link, or adds the other side's mailbox to a room you are in |
| `/transceiver leave <room name or link>` | Leaves a room; its polling stops |
| `/transceiver connect` | Connects this session (one approval for the first message) |
| `/transceiver settings` | Read receipts, notifications, your GitHub name |

## Agent tools

They work only in a project room, and only for the repo the session is open in. Agents never write to DMs.

- `send` sends a plain-text message to the project room. Text that holds a secret is refused.
- `inbox` reads the room's latest messages. They come from someone else, so the agent gets them fenced as data, not instructions.
- `ask` asks the teammate's side a question and waits a few seconds. If the answer is late it returns `pending:<id>`, and `inbox` reads the answer when it arrives.

| `ask` type | Answer |
| --- | --- |
| `status` | Branch and number of changed files |
| `branch` | Branches |
| `log` | The last 20 commits |
| `diff` | Uncommitted changes, up to 64 KB |
| `tests` | The last test result (from test-badge) |
| `plan` | The plan's steps (from plan-steps) |
| `file` | One file, up to 256 KB |
| `grep` | Lines that contain a text, optionally in one folder |
| `files` | File names, optionally in one folder |
| `todo` | TODO and FIXME lines |
| `deps` | Dependencies |
| `commit` | One commit |
| `ask` | A free-form question, answered on their side by a small model (Haiku) |

Every type but `ask` is answered without a model and costs zero tokens.

## Privacy and safety

- **Where things are.** What you write is only in your own mailbox, which only the people you shared it with can read. Only its owner can write to a mailbox, and the server enforces that. The mod ties each mailbox to one author, so lines written there under someone else's id are ignored. Your settings, room list and daily counts stay on your machine.
- **What is never written.** No session name, folder path, model name or repo list reaches any room. The only identity written is your GitHub login, and only into project rooms you accepted. A repo name appears only in that repo's room.
- **The gate.** An agent question is answered only when all four hold. You confirmed the person on the GitHub card. They are a collaborator on the repo, which is checked with GitHub and cached for 10 minutes. The session is open in that repo. The room is that repo's project room. If a check cannot be made, the gate counts as closed. Every refusal reads the same: "no access".
- **Files.** Paths must stay inside the repo root, with links resolved. `.env*`, `*.pem`, `*.key`, `id_*`, `.git/`, `.ssh/` and everything `.gitignore` covers are refused.
- **Secret scan.** Every outgoing answer and agent message is scanned with secret-guard's patterns. On a hit nothing is sent, and the other side sees "no access".
- **One answer.** A claim written once to the room keeps two of your sessions from answering the same question, so each question is answered exactly once.

## Token cost

Messaging, polling and model-free questions use no model tokens: the mod calls Claude Code's tools directly, outside any model turn.

- **Free-form `ask`.** It is answered with Haiku on the other side, at most ten a day per room. The eleventh waits there as a draft, and nothing is generated until its owner presses **Send** on it.
- **Live mode.** It is off by default and set per project room. When on, a teammate's message wakes your idle session in that repo, and each wake is a model turn. It wakes at most every 30 seconds and never interrupts a running turn.

## Limits

- **Format.** No group chat, end-to-end encryption or attachments. Chat happens only in Claude Code; the mailbox page in a browser shows no chat.
- **Size and rate.** Up to 16 KB per message, and up to 60 questions per minute per room.
- **Polling.** Every second with the pane open, every 5 seconds with it closed, doubling on errors up to 30 seconds. Invites are checked once a minute.
- **Compaction.** Messages older than 7 days are compacted once a day into one bundle per person per day.
- **Mailbox size.** An artifact holds 25,000 documents. At 20,000, the mod opens a new mailbox and writes its link into the old one, and the other members follow it by themselves. Share the new mailbox again from the **Share** menu.

## Troubleshooting

| You see | Do this |
| --- | --- |
| No invite card | Invites from another organization are not listed. Ask for the link and use **I have a link**. If that says the link is not a Transceiver mailbox, the share was not completed. |
| "… hasn't shared their mailbox with you yet" | They have not shared their mailbox with you yet. They add you from **Share** and, across organizations, send you its link. |
| "Artifact tools are off in this session" | The session runs in an SDK host. Set `CLAUDE_CODE_ARTIFACT=1` as under [Install](#install) and reopen the session. |
| "waiting for connection" | This session has not connected yet. Press **Connect**, or type `/transceiver connect`. |
| Every question gets "no access" | Check that you answered yes on the GitHub card, that they are a collaborator on the repo, and that both sessions are in it. The gate never says which check failed, by design. |
| Names show as "Someone" | The mailbox could not read the profile name, or the person is in another organization. Messages are not affected. |
| "Mailbox full" notice | Your new mailbox is open. Share its link again from the **Share** menu. |

## Develop

- **Tests.** `claude plugin validate .` checks the plugin, and `claude plugin test .` runs the tests. `tsc -p .` type-checks it against the types Claude Code writes into `.claude-plugin/types/` when it hot-reloads the mod.
- **End to end.** `python3 -I bin/e2e.py` runs the whole flow live between two sessions with separate stores: DM, read receipts, project room, GitHub match and an agent question. It uses MODZ's `tools/desk` driver and creates private test mailboxes in your account.
- **Two accounts.** For a check across two real accounts, follow [docs/e2e-checklist.md](docs/e2e-checklist.md).

## License

[MIT](LICENSE).
