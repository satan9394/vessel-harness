import type { MockScriptEntry } from '@vessel/llm';

/**
 * 离线 mock 的**冒烟脚本**（唯一实现，CLI 与 TUI 共用）。
 *
 * 此前 `cli.ts`（`run` 的默认 provider）与 `tui/chat.ts`（`buildHarness` 的 mock 分支）**各写一份**
 * 近乎相同的脚本，注释自称"逐字一致"，但第三条文案已客观分叉：
 *   - CLI：`已通过 Read 工具读取工作区文件。内容开头：\n{last_tool_result}`
 *   - TUI：`（mock）读取结果：\n{last_tool_result}`
 * 于是**同一个 prompt 在两个面得到不同输出**（且 TUI 文案自带 `（mock）`，还会与统一标记
 * `（mock 离线冒烟）` 叠加）。本模块收敛为一份，取 CLI 措辞为准。
 *
 * 与 `{cwd}` 占位符：脚本**不含** cwd 参数 —— `{cwd}` 由 `MockProvider` 的 `vars.cwd` 替换，
 * 调用方各自传自己的 cwd（`run` 用 workspace，TUI 用 sessionWorkspace）。
 *
 * 语义：① 问"阅读/总结"⇒ 发一次 `Read {cwd}/README.md`；② 读取失败（TOOL_FAILURE/DENIED/…）
 * ⇒ 给友好提示而非原始错误；③ 读取成功 ⇒ 回显结果开头。
 */
export function mockSmokeScript(): MockScriptEntry[] {
  return [
    {
      when: /阅读|read|总结|summary/i,
      ifNoToolResult: true,
      response: { toolCalls: [{ name: 'Read', arguments: { path: '{cwd}/README.md' } }] },
    },
    {
      when: /.*/,
      minToolResults: 1,
      whenToolResult: /^\[(TOOL_FAILURE|DENIED|INVALID_ARGS|TIMEOUT|SANDBOX_DENIAL)\]/,
      response: {
        text: '（mock）未能读取工作区 README.md——文件可能不存在或被拒。请确认工作区包含 README.md；要获得真实回答请配置模型：vessel setup。',
      },
    },
    {
      when: /.*/,
      minToolResults: 1,
      response: { text: '已通过 Read 工具读取工作区文件。内容开头：\n{last_tool_result}' },
    },
  ];
}
