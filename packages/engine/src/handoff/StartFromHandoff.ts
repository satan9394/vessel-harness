import * as crypto from 'node:crypto';
import { Session } from '@vessel/core';
import type { SessionRecord } from '@vessel/shared';
import type { HandoffRecord } from './Handoff.js';

/**
 * engine/handoff/StartFromHandoff — 从 handoff 启动新 Session/Agent 续跑（task 067）。
 *
 * §12 语义：新 Agent / 新 Session 从 Handoff 启动。本模块提供两条复用既有机制的路径：
 *
 * 1. 会话侧（本次实现的核心 seam）—— `seedSessionFromHandoff`：把 handoff 固化为一条
 *    B01 `user/message`（source='handoff'）注入新 Session 的起始上下文（复用
 *    core/session 的 append-only JSONL 真源；可回放、可压缩）。注入内容 =
 *    goal/completed/next_actions（起始上下文）+ blockers/decisions（透传）；
 *    current_state/changed_files/tests/evidence 全文内联（可查：handoff id 同时写入，
 *    完整记录持久在 HandoffStore，按 id 可查）。
 *
 * 2. 运行链侧 —— `handoffToTaskSeed`：handoff → 061-064 运行链的 LoopTask 形状
 *    （goal/acceptance 透传），上层把该 seed 交给 LoopEngine.selectTask 即可续跑
 *    （复用 061-064 select → generate → evaluate → persist 运行链，goalSeam 同款）。
 *
 * 与 Compaction 分工：compact 保留同一 session 继续对话；reset 生成 handoff 后由
 * 新 Session 从 handoff 重启（旧 session 归档，不无限压缩）。
 */

/** seed 结果：已追加的记录 + handoff id（供上层回读 store）。 */
export interface HandoffSeedResult {
  /** 追加进新 Session 的记录（起始上下文 user/message）。 */
  records: SessionRecord[];
  handoffId: string;
}

/**
 * 构造起始上下文文本（纯函数）：§12 九字段全量内联 —— goal/completed/next_actions
 * 注入起始上下文，blockers/decisions 透传，current_state/changed_files/tests/evidence
 * 一并给出（新 Agent 无需额外查找即可续跑；handoff id 便于按需回读持久记录）。
 */
export function handoffStartContext(handoff: HandoffRecord): string {
  const list = (items: readonly string[], fallback: string): string =>
    items.length > 0 ? items.map((s) => `- ${s}`).join('\n') : fallback;
  return [
    '<handoff-resume>',
    `handoff-id: ${handoff.id}`,
    `goal: ${handoff.goal}`,
    '',
    'completed:',
    list(handoff.completed, '（无）'),
    '',
    'current_state:',
    handoff.current_state || '（无）',
    '',
    'changed_files:',
    list(handoff.changed_files, '（无）'),
    '',
    'tests:',
    list(handoff.tests, '（无）'),
    '',
    'decisions:',
    list(handoff.decisions, '（无）'),
    '',
    'blockers:',
    list(handoff.blockers, '（无）'),
    '',
    'next_actions:',
    list(handoff.next_actions, '（无）'),
    '',
    'evidence:',
    list(handoff.evidence, '（无）'),
    '',
    '从以上结构化交接状态继续任务（current_state/changed_files/tests/evidence 亦可经 handoff-id 回读持久记录）。',
    '</handoff-resume>',
  ].join('\n');
}

/**
 * handoff → 061-064 运行链的 LoopTask 形状（id 沿用任务 id；goal/acceptance 透传）。
 * 上层 selectTask 返回该 seed 即可让 LoopEngine 从 handoff 续跑同一任务。
 */
export function handoffToTaskSeed(handoff: HandoffRecord): { id: string; goal: string; acceptance: string[] } {
  return {
    id: handoff.taskId ?? handoff.id,
    goal: handoff.goal,
    acceptance: [...(handoff.acceptance ?? [])],
  };
}

/**
 * 从 handoff 启动新 Session：向新会话追加起始上下文（B01 user/message, source='handoff'）。
 * 复用 core Session（append-only JSONL 真源 + 单写者租约）；session 由调用方创建
 * （Session.open / SessionController.create —— 061-064 既有创建机制），本函数只做 seed。
 * 返回追加的记录；调用方可随后用 handoffToTaskSeed 接 LoopEngine 运行链。
 */
export async function seedSessionFromHandoff(session: Session, handoff: HandoffRecord): Promise<HandoffSeedResult> {
  const record = await session.appendSync({
    type: 'user/message',
    msgId: `m_handoff_${crypto.randomBytes(4).toString('hex')}`,
    role: 'user',
    content: handoffStartContext(handoff),
    source: 'handoff',
    surface: true,
  });
  return { records: [record], handoffId: handoff.id };
}
