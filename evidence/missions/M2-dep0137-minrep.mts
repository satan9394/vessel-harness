/**
 * M2 DEP0137 最小复现（GC 无关的判定器）。
 *
 * 用途：DEP0137 的“告警”本身依赖 GC 时机（全量/单文件跑得到，`-t '①'` 单跑跑不到），
 * 因此“有没有泄漏”不能只看 stderr。本脚本直接检查 `Session` 的私有 `fd` 字段：
 * 关闭之后是否仍留有未关闭的 FileHandle —— 这是确定性信号。
 *
 * A 组 = 复刻 turnEndWitness.test.ts 用例① 的调用序列（重开含未收尾回合的日志 ⇒
 *        loadExisting 合成收尾 ⇒ 紧接着 close()，中途无 await）。
 * B 组 = 对照：重开后先等一个时间片，再 close()。
 *
 * 运行：npx --no-install tsx .dsh-mission/evidence/M2-dep0137-minrep.mts
 * 只读仓库源码，不写仓库内任何文件（工作目录在 %TEMP% 下）。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Session } from '../../packages/core/src/session/Session.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const fdOf = (s: Session): unknown => (s as unknown as { fd: unknown }).fd;

async function group(label: string, gapMs: number): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-dep0137-probe-'));
  const sessionId = 'probe';
  // 1) 留下一个「已 turn/start、未收尾」的回合（崩惨残留形状）
  const first = await Session.open({ workspaceRoot: dir, sessionId });
  await first.appendSync({ type: 'turn/start', turnId: 't_open', surface: false });
  await first.close();
  console.log(`[${label}] first.fd after close = ${String(fdOf(first))}`);

  // 2) 重开同一份日志 ⇒ loadExisting() 为未收尾回合合成 turn/end
  //    （Session.ts:140-147 的 this.append(...) **没有 await**）
  const reopened = await Session.open({ workspaceRoot: dir, sessionId });
  const fdRightAfterOpen = fdOf(reopened); // 此刻 fire-and-forget 的 fs.promises.open 仍未落地
  if (gapMs > 0) await sleep(gapMs); // B 组：给 fire-and-forget 的 open 一个落地的时间片
  const fdBeforeClose = fdOf(reopened);
  await reopened.close();
  const fdAfterClose = fdOf(reopened);

  // 3) 让 fire-and-forget 的 open/write 彻底跑完，再看这个 Session 手里还剩什么
  await sleep(300);
  const fdSettled = fdOf(reopened);
  const leaked = fdSettled !== null;
  console.log(
    `[${label}] fd right after open=${String(fdRightAfterOpen)} beforeClose=${String(fdBeforeClose)} ` +
      `afterClose=${String(fdAfterClose)} settled=${leaked ? '<open FileHandle>' : 'null'} => ` +
      `${leaked ? 'LEAKED (fd 未关)' : 'no leak'}`,
  );
  const log = fs.readFileSync(path.join(dir, '.harness', 'sessions', sessionId, 'session.jsonl'), 'utf8');
  const kinds = log.trim().split('\n').map((l) => JSON.parse(l).type).join(',');
  console.log(`[${label}] 日志记录（证明合成收尾确实发生了）= ${kinds}`);

  // 收尾：若确实泄漏，显式关掉它，避免把本探针自身的告警混进结论
  const handle = fdSettled as { close: () => Promise<void> } | null;
  if (handle) {
    await handle.close();
    console.log(`[${label}] 已显式关闭泄漏句柄（仅为保持探针输出干净）`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`[meta] node ${process.version} pid=${process.pid}`);
await group('A 复刻用例①（重开后立即 close，无 await）', 0);
await group('B 对照（重开后等一个时间片再 close）', 50);
console.log('[done]');
