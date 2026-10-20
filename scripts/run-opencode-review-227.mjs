import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';

const root = 'E:/Code_file/Projects/Vessel_Harness';
const diff = execSync('git diff apps/web', { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

const prompt = `# 对抗性独立审查契约 (Reviewer: OpenCode / DeepSeek-v4.1-Flash#max)

## 审查目标
审查 Codex 刚落地的 Task 227 代码变更。
任务书目标：
1. 统一检视器断点至 1180px，消除 1024-1180px 检视器掉落到内容下方的死区，窄屏优雅回退为 Drawer Overlay。
2. 桌面侧栏支持折叠/伸缩切换（.sidebar-collapsed 与 .desktop-sidebar-toggle）。
3. 空白工作台 (workbench-home) 增加快捷启动胶囊 (starter-pill)、最近会话卡片网格与工作区运行状态，消除孤岛感。
4. 视觉减负：消灭线框牢笼（Border Prison），采用微妙的表面色阶 (var(--panel-2)) 替代多层边框叠加，增加微交互 active:scale(0.98) 与 focus-visible 焦点环。
5. 门禁与兼容性：packages/core 零改动，40 个 Web 单测全部通过。

## 待审 Diff 内容
\`\`\`diff
${diff.slice(0, 30000)}
\`\`\`

请以严格对抗性、不留情面的态度进行审查：
- 是否满足 Task 227 的所有验收标准？
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
  max_tokens: 4096,
  temperature: 0.1
});

const req = https.request('https://api.commandcode.ai/provider/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer user_2gihhXuqKLjAbWa9eRE9GyEEWzMeMXJNbMUHZvKEvUNAfK4YDMX58vfkT129WY3QaQH7UMpf1bvbQqyMDxhZCmdG'
  },
  timeout: 120000
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error('Request failed with status:', res.statusCode, body);
      process.exit(1);
    }
    const data = JSON.parse(body);
    const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content;
    const outPath = path.join(root, 'evidence/sessions/2026-10-18-opencode-review-227.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, 'utf8');
    console.log(`Review report generated successfully at: ${outPath}`);
    console.log('\n--- REVIEW VERDICT SUMMARY ---');
    console.log(content.slice(0, 1000));
  });
});

req.on('error', (e) => {
  console.error('Network error:', e.message);
  process.exit(1);
});

req.write(payload);
req.end();
