import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';

const root = 'E:/Code_file/Projects/Vessel_Harness';

// Get diff for web components touched in Task 231
const diff = execSync('git diff apps/web/src/components/providers/ProviderSettingsModal.tsx apps/web/src/components/TaskComposer.tsx apps/web/src/i18n.ts apps/web/src/styles.css apps/web/src/App.tsx', { cwd: root, encoding: 'utf8' });

const filesSummary = [
  'apps/web/src/components/providers/presetsData.ts',
  'apps/web/src/components/providers/PresetsGallery.tsx',
  'apps/web/src/components/providers/ModelChips.tsx',
  'apps/web/src/components/providers/ModelQuickSwitcher.tsx',
].map(rel => `=== ${rel} ===\n` + fs.readFileSync(path.join(root, rel), 'utf8')).join('\n\n');

const prompt = `# 对抗性独立审查：Task 231 基于 CC-Switch 理念的模型供应商中枢与快捷切换器全量重构
你作为独立对抗性评审人（OpenCode 架构师，搭载 DeepSeek-v4.1-Flash#max 顶格思考模型），对 Codex 交付的 Task 231 代码进行严苛、不留情面的审查。

## 任务目标契约 (DoD)
1. **55+ 权威预设卡片展台 (presetsData.ts & PresetsGallery.tsx)**：
   - 彻底废除原硬编码 4 个选项的简陋设计；
   - 是否覆盖国内直连（DeepSeek / Kimi / 豆包 / Qwen / GLM）、国际官方（Claude / OpenAI / Gemini / Grok）、聚合中转（SiliconFlow / OpenRouter / NewAPI）、本地模型（Ollama 等）等全部分类？
   - 是否具备分类过滤 Tab 与实时搜索？点击预设是否能够一键自动预填 Base URL、线协议与推荐模型，实现只需粘贴 Key 的极简操作？
2. **可视化模型胶囊标签 (ModelChips.tsx)**：
   - 是否彻底废除了逗号分隔的纯文本手敲输入框？
   - 是否支持探测到的模型以流线型胶囊标签展示，并支持点选启用/禁用、标记默认星标（★）、删除与回车自定义？
3. **就地快捷切换器 (ModelQuickSwitcher.tsx)**：
   - 是否在 TaskComposer 及顶层会话中实现了当前模型状态胶囊（显示供应商/模型与在线绿点）？
   - 点击是否弹出极简 Popover，按供应商分组展示模型、支持搜索、上下键键盘导航与一键秒切？
4. **零配置新手引导卡片 (Onboarding)**：
   - 当没有配置任何模型时，是否直观引导用户一键接入常用供应商（DeepSeek / Claude / OpenRouter / 自定义）？
5. **代码契约、向后兼容性与红线**：
   - packages/core 与 packages/runtime 必须严格 0 修改；
   - ProviderSettingsModal.tsx 既有 exports 与 DOM ID 是否完全向下兼容；
   - 审查 CSS 设计是否符合 CDS 视觉规范（同心圆角、发丝边框、磨砂玻璃浮层）。

## 新增核心组件源码：
${filesSummary}

## 核心修改 DIFF：
\`\`\`diff
${diff.slice(0, 30000)}
\`\`\`

请从 CC-Switch 交互还原度、代码健壮性、a11y 可访问性、视觉契约达成度与潜在边界展开顶格对抗审查，并给出最终验收裁决（VERIFIED PASS / REJECT）。
`;

console.log('Sending Task 231 Review request to DeepSeek-v4.1-Flash API...');

const payload = JSON.stringify({
  model: 'deepseek/deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: 'You are an adversarial lead reviewer evaluating UI code quality, CC-Switch style interaction, accessibility, and architectural contract compliance.' },
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
      'Authorization': 'Bearer user_2gihhXuqKLjAbWa9eRE9GyEEWzMeMXJNbMUHZvKEvUNAfK4YDMX58vfkT129WY3QaQH7UMpf1bvbQqyMDxhZCmdG'
    },
    timeout: 60000
  }, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.message?.content || data;
        const outPath = path.join(root, 'evidence/sessions/2026-10-19-opencode-review-231.md');
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
