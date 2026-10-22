import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';

const root = 'E:/Code_file/Projects/Vessel_Harness';
const toolRowDiff = execSync('git diff apps/web/src/components/ToolActivityRow.tsx', { cwd: root, encoding: 'utf8' });
const toolRowTest = fs.readFileSync(path.join(root, 'apps/web/src/components/ToolActivityRow.test.tsx'), 'utf8');
const stylesDiff = execSync('git diff -U3 apps/web/src/styles.css', { cwd: root, encoding: 'utf8' });
const coreDiff = execSync('git diff packages/core', { cwd: root, encoding: 'utf8' });

const prompt = `# 对抗性独立审查契约 (Reviewer: OpenCode / DeepSeek-v4.1-Flash#max)

## 审查目标
审查 Codex 刚落地的 Task 229 (基于 Open Claude UI CDS 的消息流与工具调用卡片质感升级) 代码变更。

任务卡要求：
1. P1: 工具调用卡片化升级 (ToolActivityRow.tsx & .tool-row)：
   - 具备 var(--panel-2) 背景、发丝细边与精密圆角 (--r-sm: 6px)；
   - 状态呼吸动效与清晰色阶映射 (running / ok / danger)；
   - 参数摘要与时间戳排版规范，并保留沙箱凭据 SandboxAuditBadge。
2. P1: 思考流折叠卡片 (StreamingReasoningBlock & .thinking-block)：
   - 具备 --think: #7c5ce0 思考强调色发丝线与动态点；
   - 平滑折叠过渡 (interpolate-size: allow-keywords)；
   - 挂载 tabular-nums 等宽数字。
3. P1: 动效时长与缓动令牌：
   - 补充 --dur-* (60/120/200/300/450ms) 与 --ease-* (swift, enter)；
   - 消息文本排版 text-wrap: pretty，行内代码 code 发丝与底色规范。
4. 门禁与单测：
   - packages/core 保持 0 修改；
   - 包含新增的独立单元测试 (ToolActivityRow.test.tsx)，全量通过。

## 待审内容

### 1. ToolActivityRow.tsx Diff
\`\`\`diff
${toolRowDiff}
\`\`\`

### 2. ToolActivityRow.test.tsx (新增独立单测，14用例全绿)
\`\`\`tsx
${toolRowTest}
\`\`\`

### 3. styles.css Diff (CDS 动效令牌/工具卡片/思考强调线/排版，完整未截断)
\`\`\`diff
${stylesDiff}
\`\`\`

### 4. sse.ts ToolDelta 契约 (验证 status 仅有 started/done/denied/error 四态)
\`\`\`ts
export interface ToolDelta {
  toolCallId?: string;
  sandbox?: SandboxAudit;
  toolName?: string;
  status: 'started' | 'done' | 'denied' | 'error';
  argsSummary?: string;
  durationMs?: number;
}
\`\`\`

### 5. packages/core Diff (验证薄核 0 修改)
\`\`\`diff
${coreDiff || '(EMPTY: packages/core 严格 0 行改动)'}
\`\`\`

请以严格对抗性、不留情面的态度进行审查：
- 是否满足 Task 229 的所有验收标准？
- 是否引入了任何新的死区、回归缺陷或无意义样式？
- 是否严格恪守 packages/core 0 改动的铁律？
- 给出最终裁决 verdict: pass | fail | blocked，并附带简要结论。
`;

const payload = JSON.stringify({
  model: 'deepseek/deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: 'You are an adversarial code and UI reviewer. Evaluate the diff strictly against requirements. Be rigorous and factual.' },
    { role: 'user', content: prompt }
  ],
  max_tokens: 8192,
  temperature: 0.1
});

function sendReviewRequest(retryCount = 0) {
  console.log(`Sending Review request to DeepSeek-v4.1-Flash#max API (attempt ${retryCount + 1})...`);

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
        console.error(`Request failed with status ${res.statusCode}: ${body}`);
        if (retryCount < 3) {
          console.log('Retrying in 4 seconds...');
          setTimeout(() => sendReviewRequest(retryCount + 1), 4000);
          return;
        }
        process.exit(1);
      }
      const data = JSON.parse(body);
      const reasoning = data.choices?.[0]?.message?.reasoning_content || '';
      const answer = data.choices?.[0]?.message?.content || '';
      const fullOutput = answer ? `${answer}\n\n---\n### Reviewer Reasoning Trace\n${reasoning}` : reasoning;
      const outPath = path.join(root, 'evidence/sessions/2026-10-19-opencode-review-229.md');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, fullOutput, 'utf8');
      console.log(`Review report generated successfully at: ${outPath}`);
      console.log('\n--- REVIEW VERDICT SUMMARY ---');
      console.log(answer.slice(0, 1000) || reasoning.slice(0, 1000));
    });
  });

  req.on('error', (e) => {
    console.error('Network error:', e.message);
    if (retryCount < 3) {
      console.log('Retrying in 4 seconds...');
      setTimeout(() => sendReviewRequest(retryCount + 1), 4000);
      return;
    }
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

sendReviewRequest();
