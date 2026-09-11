import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';

/**
 * 全局测试隔离兜底（AGENTS.md 硬性约束 8）。
 *
 * 背景：凡是构造**默认** store 的用例都可能写状态根。`VESSEL_SESSION_ROOT` 是 G-10
 * 新增的会话登记根（`SessionRegistry`），若用例没有显式注入，就会写真实
 * `~/.vessel/sessions.json` —— 实测已经发生过（真实文件里躺着测试会话）。
 *
 * 这里统一指向一次性临时目录，作为**兜底**；需要自定义根的用例仍可自行覆盖
 * （显式 `opts.vesselHome` 优先级最高，其次是本 env）。
 */
let sessionRoot: string | undefined;
let savedSessionRoot: string | undefined;

beforeAll(() => {
  savedSessionRoot = process.env.VESSEL_SESSION_ROOT;
  sessionRoot = mkdtempSync(path.join(tmpdir(), 'vessel-test-sessions-'));
  process.env.VESSEL_SESSION_ROOT = sessionRoot;
});

afterAll(() => {
  if (savedSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
  else process.env.VESSEL_SESSION_ROOT = savedSessionRoot;
  if (sessionRoot) rmSync(sessionRoot, { recursive: true, force: true });
});
