import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';

const root = 'E:/Code_file/Projects/Vessel_Harness';

// Get diff for web components touched in Task 232
const diff = execSync('git diff apps/web/src/App.tsx apps/web/src/components/providers/ModelChips.tsx apps/web/src/components/providers/ProviderSettingsModal.tsx apps/web/src/components/providers/ProviderHub.tsx apps/web/src/i18n.ts apps/web/src/styles.css', { cwd: root, encoding: 'utf8' });

const filesSummary = [
  'apps/web/src/components/providers/ProviderHub.tsx',
  'apps/web/src/components/providers/ModelChips.tsx',
].map(rel => {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? `=== ${rel} ===\n` + fs.readFileSync(p, 'utf8') : '';
}).filter(Boolean).join('\n\n');

const prompt = `# 对抗性独立审查：Task 232 模型供应商全屏独立中枢与高级模型筛选器
你作为独立对抗性评审人（OpenCode 架构师，搭载 DeepSeek-v4.1-Flash#max 顶格思考模型），对 Codex 交付的 Task 232 代码进行严苛、不留情面的审查。

## 任务目标契约 (DoD)
1. **痛点一解决：全屏独立工作台 (ProviderHub.tsx & App.tsx)**：
   - 是否彻底消除了在 Settings 区域只有\"模型设置\"四个字加按钮的尴尬设计？
   - 是否在 Settings 区域直接平铺展开了完整的模型供应商管理中枢大厅？
   - 是否优雅保留了在 TaskComposer 等处触发快捷 Modal 弹窗的能力与兼容性？
2. **痛点二解决：高级模型筛选器 (ModelChips.tsx)**：
   - 是否提供了实时搜索框、全部/已选/未选分段过滤、全选/全不选/反选批量操作？
   - 是否提供了选中数量统计徽章（已选 X / 共 Y 个模型）？
   - 是否提供了海量模型（如 Lark / OpenRouter）下的滚动羽化遮罩与自适应排版？
   - 回车手动添加模型、星标设为默认、a11y 键盘访问是否完好？
3. **痛点三解决：飞书 Lark 预设补齐**：
   - 是否在 presets.data.ts 与 presetsData.ts 中以严密 parity 加入了 Lark 预设？
   - 预设展台总数是否达到 CC-Switch 级别？
4. **代码契约、向后兼容性与红线**：
   - packages/core 必须严格 0 修改；
   - ProviderSettingsModal.tsx 既有 exports 与 DOM ID 是否完全向下兼容；
   - 审查 CSS 设计是否符合 CDS / impeccable / make-interfaces-feel-better 视觉规范。

## 新增核心组件源码：
${filesSummary}

## 核心修改 DIFF：
\`\`\`diff
${diff.slice(0, 30000)}
\`\`\`

请从交互体验、代码健壮性、a11y 可访问性、视觉契约达成度与潜在边界展开顶格对抗审查，并给出最终验收裁决（VERIFIED PASS / REJECT）。
`;

console.log('Sending Task 232 Review request to DeepSeek-v4.1-Flash API...');

const payload = JSON.stringify({
  model: 'deepseek/deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: 'You are an adversarial lead reviewer evaluating UI code quality, full-screen hub transitions, advanced model chips, and architectural contract compliance.' },
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
    timeout: 60000
  }, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning_content || data;
        const outPath = path.join(root, 'evidence/sessions/2026-10-19-opencode-review-232.md');
        fs.writeFileSync(outPath, content, 'utf8');
        console.log(`OpenCode Review written to: ${outPath}`);
        console.log('\n--- Review Verdict ---');
        console.log(content.slice(0, 1500) + '...');
      } catch (e) {
        console.error('Failed to parse response:', e, data);
      }
    });
  });

  req.on('error', (e) => {
    console.error('Request error:', e);
    if (retryCount < 3) {
      console.log(`Retrying (${retryCount + 1}/3)...`);
      setTimeout(() => sendRequest(retryCount + 1), 2000);
    }
  });

  req.write(payload);
  req.end();
}

sendRequest();
