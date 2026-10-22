import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const root = 'E:/Code_file/Projects/Vessel_Harness';

// Read relevant web UI codebase files
const targetFiles = [
  'apps/web/src/components/ToolActivityRow.tsx',
  'apps/web/src/components/widgets/StreamingReasoningBlock.tsx',
  'apps/web/src/components/MessageList.tsx',
  'apps/web/src/styles.css',
];

let codebaseContent = '';
for (const rel of targetFiles) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) {
    codebaseContent += `\n\n=== FILE: ${rel} ===\n` + fs.readFileSync(p, 'utf8').slice(0, 12000);
  }
}

const prompt = `# 任务：基于 Claude Design System (CDS) 的消息流与工具调用卡片审计 (Task 229)
你作为 OpenCode 架构与设计审查专家（搭载 DeepSeek-v4.1-Flash 模型），对 Vessel Harness Web UI 的会话流组件进行深度审查，并对标 Caho1/open-claude-ui (CDS) 第 3.1、3.2、3.5 节标准，制定具体的代码改造方案供 Codex 实施。

## 目标审计组件与样式
${codebaseContent}

## 审查与对标维度：
1. **工具调用卡片化 (ToolActivityRow.tsx & .tool-row)**：
   - 当前 \`.tool-row\` 仅为简单的一行 monospace 文本，缺乏现代 Agent 交互的卡片质感；
   - 对标 CDS 3.5：如何升级为 \`var(--panel-2)\` 底色、发丝细边 \`var(--ring-hairline) solid var(--ring)\`、精密圆角 \`--r-sm: 6px\` 的交互式决策胶囊？
   - 状态呼吸动效：运行中（started）如何添加微呼吸脉冲（amber），完成（done）与错误（denied/error）的视觉对齐；
   - 参数摘要与执行时长的排版规范。
2. **思考流折叠卡片 (StreamingReasoningBlock.tsx & .thinking-block)**：
   - 对标 CDS 3.2：左侧 \`--think: #7c5ce0\` 思考色发丝强调线与动态状态点；
   - 平滑折叠过渡：CSS \`interpolate-size: allow-keywords;\` 配合高度缓动；
   - 时间与代币率的 \`tabular-nums\` 等宽对齐。
3. **消息气泡排版与 Markdown 代码美化 (.msg-body & codeblocks)**：
   - 助手消息正文应用 \`text-wrap: pretty;\` 避免孤字；
   - 行内代码与代码块使用发丝边框与精细圆角。
4. **CDS 动效时长与缓动曲线令牌补齐**：
   - 在 \`.tokens\` 中补充 CDS 5 档时长（--dur-fast 到 --dur-slow）与专业贝塞尔曲线（--ease-swift, --ease-enter）。

请输出详尽、具体、具备可直接落地代码建议的审查报告，格式清晰，指出每处文件的具体重构位置与前后对比。
`;

console.log('Sending Task 229 Audit request to DeepSeek-v4.1-Flash API...');

const payload = JSON.stringify({
  model: 'deepseek/deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: 'You are an expert UI/UX design engineer specializing in Claude Design System (CDS) and React/CSS architecture.' },
    { role: 'user', content: prompt }
  ],
  max_tokens: 8192,
  temperature: 0.1
});

const req = https.request('https://api.commandcode.ai/provider/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.OPENCODE_TOKEN ?? ''}`
  },
  timeout: 180000
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error('Request failed with status:', res.statusCode, body);
      process.exit(1);
    }
    const data = JSON.parse(body);
    const reasoning = data.choices?.[0]?.message?.reasoning_content || '';
    const answer = data.choices?.[0]?.message?.content || '';
    const fullOutput = answer ? `${answer}\n\n---\n### OpenCode Reasoning Trace\n${reasoning}` : reasoning;
    const outPath = path.join(root, 'evidence/sessions/2026-10-19-opencode-audit-229.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, fullOutput, 'utf8');
    console.log(`Audit report generated successfully at: ${outPath}`);
    console.log('\n--- AUDIT SUMMARY ---');
    console.log(answer.slice(0, 1000) || reasoning.slice(0, 1000));
  });
});

req.on('error', (e) => {
  console.error('Network error:', e.message);
  process.exit(1);
});

req.write(payload);
req.end();
