import type { MockScriptEntry } from '@vessel/llm';

/**
 * Offline mock lane (D3 decision point 16 / BENCHMARK-SPEC §6.4):
 * deterministic scripted providers per scenario — no network, no real model.
 * The mock is a determinization of the scenario's expected behavior; criteria
 * still come from the manifest (runner-side asserts never trust the mock).
 *
 * State progression: R1 = first call (no tool results yet), R2 = after ≥1 result
 * (capped at exactly 1 to prevent re-entry), R3 = after ≥2 results (final answer).
 */
export const OFFLINE_SCRIPTS: Record<string, MockScriptEntry[]> = {
  B001: [
    {
      when: /computeTax|facts/i,
      ifNoToolResult: true,
      response: { toolCalls: [{ name: 'Read', arguments: { path: 'a/facts.txt' } }] },
    },
    {
      when: /.*/,
      minToolResults: 1,
      maxToolResults: 1,
      response: { text: 'The responsibility of computeTax is described in a/facts.txt:\n{last_tool_result}' },
    },
  ],
  B002: [
    {
      when: /needle_a1b2c3/i,
      ifNoToolResult: true,
      response: { toolCalls: [{ name: 'Grep', arguments: { pattern: 'needle_a1b2c3', include: 'src/**/*.js' } }] },
    },
    {
      when: /.*/,
      minToolResults: 1,
      maxToolResults: 1,
      response: { text: 'src 下 needle_a1b2c3 的调用点清单：\n{last_tool_result}' },
    },
  ],
  B003: [
    {
      when: /computeFee/i,
      ifNoToolResult: true,
      response: { toolCalls: [{ name: 'Read', arguments: { path: 'src/fee.js' } }] },
    },
    {
      when: /.*/,
      minToolResults: 1,
      maxToolResults: 1,
      response: {
        toolCalls: [
          {
            name: 'Write',
            arguments: {
              path: 'src/fee.js',
              content: [
                '// computeFee — implemented for B003 hidden test',
                'export function computeFee(amount, opts) {',
                '  const rate = opts?.rate ?? 0.1;',
                '  return Math.round(amount * rate * 100) / 100;',
                '}',
                '',
              ].join('\n'),
            },
          },
        ],
      },
    },
    {
      when: /.*/,
      minToolResults: 2,
      response: { text: '已实现 src/fee.js 的 computeFee()；运行隐藏测试验证通过。' },
    },
  ],
  B004: [
    {
      when: /oldName/i,
      ifNoToolResult: true,
      response: { toolCalls: [{ name: 'Read', arguments: { path: 'src/legacy-symbol.js' } }] },
    },
    {
      when: /.*/,
      minToolResults: 1,
      maxToolResults: 1,
      response: {
        toolCalls: [
          { name: 'Edit', arguments: { path: 'src/legacy-symbol.js', old_string: 'oldName', new_string: 'newName2026', replace_all: true } },
          { name: 'Edit', arguments: { path: 'src/user.js', old_string: 'oldName', new_string: 'newName2026', replace_all: true } },
          { name: 'Edit', arguments: { path: 'src/api.js', old_string: 'oldName', new_string: 'newName2026', replace_all: true } },
        ],
      },
    },
    {
      when: /.*/,
      minToolResults: 2,
      response: { text: '重命名完成：oldName → newName2026，src 下旧符号零残留，import 已同步。' },
    },
  ],
  B005: [
    {
      when: /derived|node -e/i,
      ifNoToolResult: true,
      response: {
        toolCalls: [{ name: 'Shell', arguments: { command: 'node -e "const s=2026; console.log((s*31+7)%100000)"' } }],
      },
    },
    {
      when: /.*/,
      minToolResults: 1,
      maxToolResults: 1,
      response: {
        toolCalls: [
          { name: 'Write', arguments: { path: 'config.json', content: '{"seed": 2026, "derived": {last_tool_result}}' } },
        ],
      },
    },
    {
      when: /.*/,
      minToolResults: 2,
      response: { text: '已执行 node -e 计算派生值并写入 config.json 的 derived 字段。' },
    },
  ],
  // V0.2: subagent delegation — parent calls Subagent, child answers from the same script
  B016: [
    {
      when: /委派|子代理|subagent/i,
      ifNoToolResult: true,
      response: { toolCalls: [{ name: 'Subagent', arguments: { prompt: '独立子任务：输出 CHILD-ANSWER-77 字样' } }] },
    },
    {
      when: /独立子任务/i,
      ifNoToolResult: true,
      response: { text: 'CHILD-ANSWER-77' },
    },
    {
      when: /.*/,
      minToolResults: 1,
      response: { text: '委派完成，子代理返回：{last_tool_result}' },
    },
  ],
  // V0.2: planner — generatePlan (raw call) then step runs through the loop
  B017: [
    {
      when: /制定计划/i,
      ifNoToolResult: true,
      response: {
        text: JSON.stringify({
          goal: '完成双步骤任务',
          steps: [
            { id: 's1', description: '步骤一', acceptance: ['STEP-1-GOLDEN'] },
            { id: 's2', description: '步骤二', acceptance: ['STEP-2-GOLDEN'] },
          ],
        }),
      },
    },
    { when: /步骤一/i, ifNoToolResult: true, response: { text: '完成步骤一 STEP-1-GOLDEN' } },
    { when: /步骤二/i, ifNoToolResult: true, response: { text: '完成步骤二 STEP-2-GOLDEN' } },
  ],
  // V0.2: evaluator — generator claims done; independent evaluator agent rejects with evidence
  B018: [
    { when: /.*/, ifNoToolResult: true, response: { text: '已完成实现，所有测试通过。' } },
  ],
  'B018-eval': [
    {
      when: /.*/,
      ifNoToolResult: true,
      response: {
        text: '{"verdict":"not_met","evidence":["无测试通过证据"],"reason":"验收要求测试全绿，缺少证据"}',
      },
    },
  ],
  // V0.2: MCP — remote tool mcp__demo__add via the in-process fixture transport
  B019: [
    {
      when: /计算|mcp/i,
      ifNoToolResult: true,
      response: { toolCalls: [{ name: 'mcp__demo__add', arguments: { a: 40, b: 2 } }] },
    },
    { when: /.*/, minToolResults: 1, response: { text: 'MCP 计算完成：{last_tool_result}' } },
  ],
  // V0.3: project memory — write then read a topic via the Memory tool
  B020: [
    {
      when: /Memory|记忆/i,
      ifNoToolResult: true,
      response: { toolCalls: [{ name: 'Memory', arguments: { op: 'write', name: 'bench-note', content: 'bench 记忆内容 MEM-GOLDEN-2026' } }] },
    },
    {
      when: /.*/,
      minToolResults: 1,
      maxToolResults: 1,
      response: { toolCalls: [{ name: 'Memory', arguments: { op: 'read', name: 'bench-note' } }] },
    },
    { when: /.*/, minToolResults: 2, response: { text: '项目记忆已写入并读出：{last_tool_result}' } },
  ],
  // V0.3: skill content — load the bench-demo skill body via the Skill tool
  B021: [
    {
      when: /Skill|技能/i,
      ifNoToolResult: true,
      response: { toolCalls: [{ name: 'Skill', arguments: { name: 'bench-demo' } }] },
    },
    { when: /.*/, minToolResults: 1, response: { text: '技能正文关键内容：SKILL-GOLDEN-77（{last_tool_result}）' } },
  ],
};
