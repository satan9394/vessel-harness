export const VERSION = '0.10.0';

export const MAX_STEPS_PER_TURN = 64;

export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Compaction pressure threshold ratio (ARCHITECTURE §2.3) */
export const COMPACTION_THRESHOLD_RATIO = 0.8;

/** Tail records kept verbatim after compaction (retainRatio 0.16) */
export const COMPACTION_RETAIN_RATIO = 0.16;

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MiB read cap (ARCHITECTURE §4.5)

export const MAX_PARALLEL_TOOL_CALLS = 10;

export const MAX_OVERFLOW_RETRIES = 1;
