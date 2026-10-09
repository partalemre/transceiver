export const PROTOCOL_VERSION = 1
export const MAX_TEXT_BYTES = 16_384
export const MAX_PATH_BYTES = 1_000
export const MAX_DIFF_BYTES = 65_536
export const MAX_FILE_BYTES = 262_144
export const LOG_COUNT = 20
export const SINCE_PAGE = 200
export const HEADS_PAGE = 100

export const POLL_OPEN_MS = 1_000
export const POLL_CLOSED_MS = 5_000
export const POLL_MAX_MS = 30_000
export const DISCOVER_MS = 60_000
export const SHARED_LIST_LIMIT = 100
export const POLL_BACKOFF = 2
export const KEEP_ENTRIES = 500
// A room page message: 4000 characters stay under MAX_TEXT_BYTES even at 4 bytes each.
export const PAGE_MAX_CHARS = 4_000

export const ASK_MODEL = 'haiku'
export const ASK_MAX_TOKENS = 800
export const ASK_TIMEOUT_MS = 20_000
export const ASK_DAILY_LIMIT = 10
export const ASK_WAIT_MS = 20_000
export const ASK_WAIT_STEP_MS = 1_000
export const QUERY_TTL_MS = 600_000
export const QUERY_RATE_PER_MIN = 60

export const COLLAB_CACHE_MS = 600_000
export const RUN_TIMEOUT_MS = 15_000
export const COLLAB_PAGE = 100
export const DAY_MS = 24 * 60 * 60 * 1_000
export const COMPACT_AFTER_MS = 7 * DAY_MS
export const ROLLOVER_DOCS = 20_000

// Retention (T15). A batch holds at most 50 writes: the day doc and 49 deletes.
export const BATCH_MAX_WRITES = 50
export const COMPACT_BATCH_DELETES = BATCH_MAX_WRITES - 1
// Messages compacted per tick: two batches, so one tick never holds the room's poll for long.
export const COMPACT_PAGE = 2 * COMPACT_BATCH_DELETES
// A day doc stays well under the 1 MiB batch body; a busier day goes on in `<day>.2`, `<day>.3`, …
export const DAY_DOC_MAX_BYTES = 512_000
export const MAX_DAY_PARTS = 64
// A failed compaction or rollover is tried again after this long, not on every poll.
export const RETENTION_RETRY_MS = 10 * 60_000
// A peer cursor this close to the compaction age may have missed messages moved into day docs.
export const DAYS_PULL_AFTER_MS = COMPACT_AFTER_MS - DAY_MS
// The newest day docs read for a peer who was away: the pane keeps KEEP_ENTRIES messages at most.
export const DAYS_PAGE = 7
// The compacted days per author the room's web page shows: about a month of history before the last week.
export const PAGE_DAYS = 30

export const PANE_ID = 'transceiver'
export const COMMAND = 'transceiver'
export const TITLE_PREFIX = 'Transceiver · '

// Agents: responder, ask, tools, live wake (T13–T14).
export const ASK_EFFORT = 'low'
export const ASK_MAX_QUESTION_CHARS = 2_000
export const ASK_CONTEXT_FILES = 200
export const ASK_CONTEXT_COMMITS = 5
// The ask tool waits inside a hook's 10 s budget: it stops waiting while this much is left.
export const ASK_WAIT_MARGIN_MS = 1_500
export const ANSWER_PART_HEADROOM = 32
// The largest answer (a 256 KB file) split under the message cap, plus one for character boundaries.
export const MAX_ANSWER_PARTS = Math.ceil(MAX_FILE_BYTES / (MAX_TEXT_BYTES - ANSWER_PART_HEADROOM)) + 1
export const MINUTE_MS = 60_000
export const QUERY_FUTURE_SKEW_MS = 60_000
export const INBOX_LIMIT = 30
export const NONCE_CHARS = 16
export const REPO_CACHE_MS = 60_000
export const LOGIN_RETRY_MS = 600_000
export const LIVE_COOLDOWN_MS = 30_000
export const LIVE_MAX_CHARS = 2_000

// Pane and notifications (T8–T9).
export const PREVIEW_CHARS = 80
export const TOAST_CHARS = 60
export const MAX_NAME_CHARS = 40
// ArtifactData `profiles` takes at most 64 ids per call.
export const PROFILES_PAGE = 64
// The pane's clock moves by the minute: day labels and row times, not a redraw every poll.
export const PANE_CLOCK_MS = 60_000
// Messages of one author closer than this share one avatar.
export const GROUP_MS = 5 * 60_000
// The newest messages the pane draws; older ones stay on the room's web page.
export const TIMELINE_LINES = 60
export const ANSWER_PREVIEW_LINES = 12
// A peer whose head moved (a send or a read mark) this recently shows as here.
export const PRESENCE_MS = 5 * 60_000

// Typed queries: grep, files, todo, deps, commit.
// Each git or file step of a typed query; a step that runs past it is a denial.
export const QUERY_RUN_TIMEOUT_MS = 10_000
export const GREP_MIN_CHARS = 2
export const GREP_MAX_CHARS = 200
export const GREP_MAX_HITS = 50
export const TODO_MAX_HITS = 100
// Each matched line is cut to this many characters (after the whole output was scanned).
export const HIT_LINE_CHARS = 200
// A grep or todo reads at most this many matched files whole, to check `file` would serve each one.
export const HIT_FILES_CHECKED = 100
export const FILES_MAX = 500
export const DEPS_MAX_PER_GROUP = 100
export const DEPS_ITEM_CHARS = 100
export const COMMIT_BODY_CHARS = 2_000
export const COMMIT_MAX_FILES = 100
export const COMMIT_SUBJECT_CHARS = 200

// Drafts past the ask limit kept per room: a flood of asks cannot grow the store.
export const MAX_DRAFTS_PER_ROOM = 20
// A shared artifact titled like a room but with no room meta is read again only after this long.
export const NOT_ROOM_RETRY_MS = 10 * 60_000
