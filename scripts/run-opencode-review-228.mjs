import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';

const root = 'E:/Code_file/Projects/Vessel_Harness';
const composerDiff = execSync('git diff apps/web/src/components/TaskComposer.tsx', { cwd: root, encoding: 'utf8' });
const composerTest = fs.readFileSync(path.join(root, 'apps/web/src/components/TaskComposer.test.tsx'), 'utf8');
const conversationDiff = execSync('git diff apps/web/src/components/ConversationView.tsx', { cwd: root, encoding: 'utf8' });
const layoutDiff = execSync('git diff apps/web/src/components/layout/layout.css', { cwd: root, encoding: 'utf8' });
const stylesDiff = execSync('git diff -U3 apps/web/src/styles.css', { cwd: root, encoding: 'utf8' });
const indexHtml = fs.readFileSync(path.join(root, 'apps/web/index.html'), 'utf8');

// We also verify packages/core git diff
const coreDiff = execSync('git diff packages/core', { cwd: root, encoding: 'utf8' });

const prompt = `# 对抗性独立审查契约 (Reviewer: OpenCode / DeepSeek-v4.1-Flash#max)

## 审查目标
审查 Codex 刚落地的 Task 228 (基于 Open Claude UI CDS 的 Web UI 深度优化) 代码变更。

任务卡要求：
1. P0: 落地 IME 中文/日文输入法合成守卫 (TaskComposer.tsx)，保证拼音输入候选词选词时不误触提交，并具备独立单元测试。
2. P0/P1: 视网膜高分屏发丝细边补偿 (--ring-hairline: 0.5px @2x/@3x)，补齐 4/6/8/10/20px 精密圆角矩阵，优化 3 层立体焦点环。
3. P1: 原生滚动消隐遮罩 (.scroll-fade-mask)，为聊天流 (ConversationView.tsx) 和检视器 (layout.css) 增加 mask-image 渐隐，消除生硬截断。
4. P1: 70ms-120ms 触觉按压反馈微交互。
5. 门禁契约：packages/core 零改动，41 个 Web 单测全部通过。

## 待审内容

### 1. TaskComposer.tsx Diff (IME 输入守卫)
\`\`\`diff
${composerDiff}
\`\`\`

### 2. TaskComposer.test.tsx (新增独立单测，6用例全绿)
\`\`\`tsx
${composerTest}
\`\`\`

### 3. ConversationView.tsx Diff (应用 .scroll-fade-mask 到消息流)
\`\`\`diff
${conversationDiff}
\`\`\`

### 4. layout.css Diff (应用 mask-image 到 .inspector-content + hairline + precision radii)
\`\`\`diff
${layoutDiff}
\`\`\`

### 5. index.html 验证 (验证 .tokens 类挂载)
\`\`\`html
${indexHtml}
\`\`\`

### 6. styles.css Diff (CDS 细边/圆角矩阵/焦点环/微交互)
\`\`\`diff
${stylesDiff.slice(0, 15000)}
\`\`\`

### 7. packages/core Diff (验证零侵入)
\`\`\`diff
${coreDiff || '(EMPTY: packages/core 保持 0 修改)'}
\`\`\`

请以严格对抗性、不留情面的态度进行审查：
- 是否满足 Task 228 的所有验收标准（IME守卫+测试、视网膜细边、圆角矩阵、聊天流与检视器双消隐遮罩、微交互）？
- 是否引入了任何新的死区、回归缺陷或无意义样式？
- 是否严格恪守 packages/core 0 改动的铁律？
- 给出最终裁决 verdict: pass | fail | blocked，并附带简要结论。
`;

console.log('Sending Review request to DeepSeek-v4.1-Flash#max API...');

const payload = JSON.stringify({
  model: 'deepseek/deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: 'You are an adversarial code and UI reviewer. Evaluate the diff strictly against requirements. Be rigorous and factual.' },
    { role: 'user', content: prompt }
  ],
  max_tokens: 8192,
  temperature: 0.1
});

const req = https.request('https://api.commandcode.ai/provider/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer user_2gihhXuqKLjAbWa9eRE9GyEEWzMeMXJNbMUHZvKEvUNAfK4YDMX58vfkT129WY3QaQH7UMpf1bvbQqyMDxhZCmdG'
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
    const fullOutput = answer ? `${answer}\n\n---\n### Reviewer Reasoning Trace\n${reasoning}` : reasoning;
    const outPath = path.join(root, 'evidence/sessions/2026-10-19-opencode-review-228.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, fullOutput, 'utf8');
    console.log(`Review report generated successfully at: ${outPath}`);
    console.log('\n--- REVIEW VERDICT SUMMARY ---');
    console.log(answer.slice(0, 1000) || reasoning.slice(0, 1000));
  });
});

req.on('error', (e) => {
  console.error('Network error:', e.message);
  process.exit(1);
});

req.write(payload);
req.end();
