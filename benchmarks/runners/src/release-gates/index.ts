/**
 * task 084 — Release Gates module (8 道发布门禁 + release-report).
 *
 * Gate framework (injectable judges + executors), sequential runner, and the
 * release-report.json/.md aggregation. Reuses conventions established by
 * 076 (RunResult contract), 082 (real-model lane / pending mode), and 083
 * (report shape / schemaVersion 1 + markdown reports dir convention).
 */
export * from './types.js';
export * from './gates.js';
export * from './runner.js';