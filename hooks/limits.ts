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
export const COMPACT_AFTER_MS = 7 * 24 * 60 * 60 * 1_000
export const ROLLOVER_DOCS = 20_000

export const PANE_ID = 'transceiver'
export const COMMAND = 'transceiver'
export const TITLE_PREFIX = 'Transceiver · '
