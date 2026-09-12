import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { resolveEvaluatorTurnOutcome } from './evaluator/EvaluatorAgent.js';
import { mapTurnKindToStopReason, type TurnKind } from './turnStopReason.js';

/**
 * BRIEF「同一件事三处实现、两套口径」—— 唯一实现（`turnStopReason.ts`）的验收。
 *
 * 改前的事实（逐条可核）：
 * - `subagent/SubagentManager.ts:424-435` 与 `evaluator/EvaluatorAgent.ts:138-149` 是**两份逐字
 *   重复的 switch**（同一组 kind → 同一组结果，各自维护）；
 * - `team/TeamRuntime.ts:259` 是**第三套口径**（原样吐 kind ⇒ 越词表）。
 */

/** shared `SubagentResultContract.stopReason` 词表（packages/shared/src/events.ts:242）逐字副本。 */
const VOCABULARY: readonly string[] = ['completed', 'aborted', 'error', 'max_tokens', 'refusal', 'denied'];

const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url));
const IMPL = path.join(SRC_ROOT, 'turnStopReason.ts');

/** 递归列出 `src/**` 下的 .ts 文件（包内自扫；不引入依赖）。 */
function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.isFile() && full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('agents/turnStopReason — kind → stopReason 的唯一实现（BRIEF：三处实现、两套口径）', () => {
  it('① 唯一映射表：四类 kind 一律映到契约词表内的值（不透传 kind、不新造词）', () => {
    const kinds: readonly TurnKind[] = ['success', 'error', 'budget', 'interrupted'];
    expect(kinds.map((k) => mapTurnKindToStopReason(k))).toEqual(['completed', 'error', 'max_tokens', 'aborted']);
    for (const kind of kinds) {
      const mapped = mapTurnKindToStopReason(kind);
      expect(VOCABULARY.includes(mapped)).toBe(true);
      // 旧 TeamRuntime 原样吐 kind 的产物：一个都不许出现
      expect(mapped).not.toBe('budget');
      expect(mapped).not.toBe('interrupted');
    }
  });

  it('② 单一实现（静态）：evaluator/subagent/team 三处 import 同一模块，全包只有一份映射表', () => {
    // 相对被测模块的三处消费点（行号见交付说明；这里是"同一模块导出"的可执行证据）
    const sites: readonly (readonly [string, string])[] = [
      ['evaluator/EvaluatorAgent.ts', 'evaluator'],
      ['subagent/SubagentManager.ts', 'subagent'],
      ['team/TeamRuntime.ts', 'team'],
    ];
    for (const [rel, name] of sites) {
      const src = fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');
      // (a) 从唯一实现处 import（三处都是 `../turnStopReason.js`）
      expect(src, `${name} 必须 import 唯一实现`).toMatch(
        /import\s*\{[^}]*\bmapTurnKindToStopReason\b[^}]*\}\s*from\s*'\.\.\/turnStopReason\.js'/,
      );
      // (b) 本文件不得再自带第二份 kind→stopReason 的分支
      expect(src, `${name} 不得自带第二份 switch`).not.toMatch(/case\s*'max_tokens'/);
      expect(src, `${name} 不得自带第二份 switch`).not.toMatch(/case\s*'aborted'/);
    }
    // (c) 全包扫描：映射表的两个字面量条目只允许出现在唯一实现里
    //     （任何"再抄一份表"的尝试都会让本断言红）
    const offenders = walkTs(SRC_ROOT)
      .filter((file) => file !== IMPL)
      .filter((file) => /(budget|interrupted)\s*:\s*'(max_tokens|aborted)'/.test(fs.readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(SRC_ROOT, file))).toEqual([]);
    // 唯一实现里恰好一条（不是零条、也不是多条）
    const impl = fs.readFileSync(IMPL, 'utf8');
    expect((impl.match(/budget\s*:\s*'max_tokens'/g) ?? []).length).toBe(1);
    expect((impl.match(/interrupted\s*:\s*'aborted'/g) ?? []).length).toBe(1);
  });

  it('②b 三处同口径（evaluator 侧 oracle 对表）：回合裁决的 stopReason 就是本函数的返回值', () => {
    const VALID_MET = '{"verdict":"met","evidence":[],"reason":"r"}';
    for (const kind of ['success', 'error', 'budget', 'interrupted'] as const) {
      const out = resolveEvaluatorTurnOutcome({ kind, finalText: VALID_MET });
      // 旧实现这里是硬编码的 'completed'；本卡把它改成"由 kind 决定"，且口径就是唯一实现
      expect(out.stopReason).toBe(mapTurnKindToStopReason(kind));
    }
  });
});
