import type { HandoffRecord } from './Handoff.js';

/**
 * engine/handoff — §12 yaml 对齐的 handoff 文本投影（handoff.md artifact）。
 *
 * 与 ReviewHandoffStore.renderHandoffMarkdown 同职责（生成时的只读快照）：字段名与
 * docs/Vessel_后续开发方向与产品化路线_v1.0.md §12 的 yaml 字段逐一对应
 * （goal/completed/current_state/changed_files/tests/decisions/blockers/next_actions/
 * evidence），新 Agent / 外部工具可直接复制阅读；结构化数据本体在 meta.json（JSON）。
 */

/** 列表渲染：空 → 占位说明（保证 §12 九字段结构永远齐）；统一 4 空格缩进。 */
function listBlock(items: readonly string[], empty: string): string {
  const base = items.length > 0 ? items.map((s) => `- ${s}`).join('\n') : empty;
  return base
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

/** 渲染 §12 yaml 对齐的 handoff 文本。 */
export function renderHandoffText(record: HandoffRecord): string {
  const out: string[] = [];
  out.push('# Context Reset Handoff');
  out.push('');
  out.push(`> handoff-id: \`${record.id}\``);
  out.push(`> createdAt: ${record.createdAt}`);
  out.push(`> updatedAt: ${record.updatedAt}`);
  if (record.taskId) out.push(`> task-id: ${record.taskId}`);
  if (record.projectRoot) out.push(`> project-root: ${record.projectRoot}`);
  if (record.continuationOf) out.push(`> continuation-of: ${record.continuationOf}`);
  out.push('');
  out.push('handoff:');
  out.push(`  goal: ${record.goal}`);
  out.push('  completed:');
  out.push(listBlock(record.completed, '（无）'));
  out.push('  current_state: |');
  out.push(
    (record.current_state ? record.current_state.split('\n').join('\n    ') : '（无）'),
  );
  out.push('  changed_files:');
  out.push(listBlock(record.changed_files, '（无）'));
  out.push('  tests:');
  out.push(listBlock(record.tests, '（无）'));
  out.push('  decisions:');
  out.push(listBlock(record.decisions, '（无）'));
  out.push('  blockers:');
  out.push(listBlock(record.blockers, '（无）'));
  out.push('  next_actions:');
  out.push(listBlock(record.next_actions, '（无）'));
  out.push('  evidence:');
  out.push(listBlock(record.evidence, '（无）'));
  out.push('');
  return out.join('\n');
}
