import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mockSmokeScript } from './mockSmoke.js';

describe('mockSmoke — 唯一冒烟脚本（CLI/TUI 共用）', () => {
  it('三条：Read README → 失败友好提示 → 成功回显开头（措辞以 CLI 为准）', () => {
    const s = mockSmokeScript();
    expect(s).toHaveLength(3);
    // 第三条 = CLI 的规范措辞
    expect(s[2]!.response.text ?? '').toContain('已通过 Read 工具读取工作区文件。内容开头：');
    // 第二条 = 读取失败的友好提示（不是原始 TOOL_FAILURE）
    expect(s[1]!.response.text ?? '').toContain('未能读取工作区 README.md');
    // 旧 TUI 措辞不得再出现（那正是两面分叉点）
    expect(JSON.stringify(s)).not.toContain('（mock）读取结果');
    // 第一条仍是"发一次 Read {cwd}/README.md"
    expect(s[0]!.response.toolCalls?.[0]).toMatchObject({ name: 'Read' });
  });

  it('静态守卫：两面都从叶子 import，且不再内联脚本（改回内联即红）', () => {
    const cli = fs.readFileSync(fileURLToPath(new URL('./cli.ts', import.meta.url)), 'utf8');
    const chat = fs.readFileSync(fileURLToPath(new URL('./tui/chat.ts', import.meta.url)), 'utf8');
    expect(cli).toContain('mockSmokeScript(');
    expect(chat).toContain('mockSmokeScript(');
    expect(cli).toMatch(/from\s*'\.\/mockSmoke\.js'/);
    expect(chat).toMatch(/from\s*'\.\.\/mockSmoke\.js'/);
    // 内联脚本的唯一标志（第一条 when 正则）不得再出现在两个消费面
    const inlineMarker = /when:\s*\/阅读\|read\|总结\|summary\/i/;
    expect(cli).not.toMatch(inlineMarker);
    expect(chat).not.toMatch(inlineMarker);
  });
});
