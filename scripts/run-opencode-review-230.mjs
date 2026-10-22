import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';

const root = 'E:/Code_file/Projects/Vessel_Harness';

// Get diff for web components
const diff = execSync('git diff apps/web/src/components/Sidebar.tsx apps/web/src/components/TaskComposer.tsx apps/web/src/i18n.ts apps/web/src/styles.css apps/web/src/components/dashboard.css', { cwd: root, encoding: 'utf8' });
const testDiff = fs.readFileSync(path.join(root, 'apps/web/src/components/Sidebar.test.tsx'), 'utf8');

const prompt = `# 对抗性独立审查：Task 230 Web UI 侧边栏与输入器质感升级
你作为独立对抗性评审人（OpenCode 架构师，搭载 DeepSeek-v4.1-Flash#max 顶格思考模型），对 Codex 交付的 Task 230 代码进行严苛、不留情面的审查。

## 任务目标契约 (DoD)
1. **侧边栏 (Sidebar.tsx & CSS)**：
   - 是否彻底打破 Border Prison（移除生硬的下边框）？
   - 是否实现了真实按日期分段（Today / Yesterday / Previous 7 Days / Earlier）且在 UI 渲染上层级分明？
   - 是否实现了内联悬停浮现的操作按钮（重命名/归档）与完善的键盘访问？
   - 是否实现了激活会话的 active rail 发丝高亮指示条？
2. **任务输入器 (TaskComposer.tsx & CSS)**：
   - 是否具备同心圆角（--r-composer: 20px）与三态柔和投影？
   - 是否将原突兀的原生 select 升级为胶囊选择器？
   - 是否完整保留了 IME 中文拼音守卫（isComposingRef, nativeEvent.isComposing, keyCode === 229）及既有表单提交逻辑？
3. **样式与变量收敛**：
   - 是否清理了历史残留的 --panel2，规范到 --panel-2 / --ring？
4. **单测完备性**：
   - 检查新增的 Sidebar.test.tsx，是否覆盖了日期分段、边界条件、过滤与连续性？

## 提交的代码 DIFF：
\`\`\`diff
${diff}
\`\`\`

## 新增的单测 (Sidebar.test.tsx)：
\`\`\`tsx
${testDiff}
\`\`\`

请从代码健壮性、视觉契约达成度、无障碍（a11y）、性能与潜在副作用展开顶格审查，并给出最终验收裁决（VERIFIED PASS / REJECT）。
`;

console.log('Sending Task 230 Review request to DeepSeek-v4.1-Flash API...');

const payload = JSON.stringify({
  model: 'deepseek/deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: 'You are an adversarial lead reviewer evaluating UI code quality, CSS architecture, accessibility, and contract compliance.' },
    { role: 'user', content: prompt }
  ],
  max_tokens: 8192,
  temperature: 0.1
});

function sendRequest(retryCount = 0) {
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
        if (res.statusCode === 503 && retryCount < 3) {
          console.warn(`Got 503 from API, retrying in 4s... (attempt ${retryCount + 1})`);
          setTimeout(() => sendRequest(retryCount + 1), 4000);
          return;
        }
        console.error('Request failed with status:', res.statusCode, body);
        process.exit(1);
      }
      const data = JSON.parse(body);
      const reasoning = data.choices?.[0]?.message?.reasoning_content || '';
      const answer = data.choices?.[0]?.message?.content || '';
      const fullOutput = answer ? `${answer}\n\n---\n### OpenCode Reasoning Trace\n${reasoning}` : reasoning;
      const outPath = path.join(root, 'evidence/sessions/2026-10-19-opencode-review-230.md');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, fullOutput, 'utf8');
      console.log(`Review report generated successfully at: ${outPath}`);
      console.log('\n--- REVIEW SUMMARY ---');
      console.log(answer.slice(0, 1000) || reasoning.slice(0, 1000));
    });
  });

  req.on('error', (e) => {
    if (retryCount < 3) {
      console.warn(`Network error ${e.message}, retrying in 4s...`);
      setTimeout(() => sendRequest(retryCount + 1), 4000);
      return;
    }
    console.error('Network error:', e.message);
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

sendRequest();
