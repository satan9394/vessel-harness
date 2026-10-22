import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const root = 'E:/Code_file/Projects/Vessel_Harness';

// Read relevant codebase files
const targetFiles = [
  'packages/application/src/providers/presets.data.ts',
  'apps/web/src/components/providers/ProviderSettingsModal.tsx',
  'apps/web/src/components/TaskComposer.tsx',
  'apps/web/src/api.ts',
];

let codebaseContent = '';
for (const rel of targetFiles) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) {
    codebaseContent += `\n\n=== FILE: ${rel} ===\n` + fs.readFileSync(p, 'utf8').slice(0, 16000);
  }
}

const prompt = `# 任务：基于 CC-Switch 理念的模型供应商中枢与快捷切换器深度审计与方案设计 (Task 231)
你作为 OpenCode 架构与设计审查专家（搭载 DeepSeek-v4.1-Flash 模型），针对用户指出的致命痛点：“模型供应商模块做的太差了，不是说参考CC Switch的吗？但是感觉可用性非常非常的糟糕啊。以及体验感感觉东一点西一点。其一，没有市面上那些Agent那么容易直接使用，看起来比较麻烦”，对 Vessel Web UI 的供应商管理与模型切换架构进行全盘审计与重塑设计，供 Codex 在独立沙箱中实施。

## 目标组件与预设库现状：
${codebaseContent}

## 核心重构与对标维度：
1. **预设库全量释放与分类卡片展台 (Presets Hub & Cards)**：
   - 现状：前端 \`ProviderSettingsModal.tsx\` 硬编码了只有 4 个条目的简陋下拉框，而后端 \`packages/application/src/providers/presets.data.ts\` 早已内置了 55+ 款权威预设（包含了国内直连、国际官方、聚合平台、本地运行器）；
   - 对标 CC-Switch：如何设计前端分类展示（国内直连、国际官方、聚合平台、本地运行器），以可视化的卡片网格（带搜索过滤、Logo/图标、推荐模型徽章）呈现？
   - 极简配置流程：用户点击某个预设卡片，系统自动预填 Base URL、协议、推荐模型，**用户只需粘贴 API Key** 即可一键启用。

2. **模型流线型标签胶囊（Chips/Tags）与一键探测**：
   - 现状：当前模型列表是一个普通的逗号分隔文本输入框，用户必须手动敲字符；
   - 对标：废除文本输入框，改造为可视化模型胶囊列表（Chips）。点击「拉取模型」调用 \`POST /api/providers/pull-models\` 后，将探测到的模型以标签胶囊展示，点击即可勾选/取消勾选，并支持设置默认模型。

3. **终结割裂：“东一点西一点”的就地快捷切换器 (Quick Switcher Popover)**：
   - 现状：用户配完供应商后，不知道怎么在主界面选；主界面 \`TaskComposer\` 是一个死板的长下拉框，切换模型需要到处翻找；
   - 对标 CC-Switch：在 \`TaskComposer\` 和主界面提供统一的「当前激活模型胶囊」（显示供应商名称、当前模型、在线状态与延迟）；
   - 点击就地弹出微型切换浮层（Quick Switch Popover），列出所有已配置的供应商及其可用模型，鼠标点击**一键秒切、全局热生效**。

4. **无配置新手开箱引导 (Zero-Config Guide)**：
   - 当系统没有任何可用模型时，主工作台不再是一句冰冷的“模型离线”，而是展现精美的「快捷接入向导」卡片（推荐 DeepSeek、Claude、OpenRouter 等一键接入卡片）。

请输出详尽、具体、具备可直接落地代码建议的审查设计报告，包含：
1. 预设数据在 Web 端的桥接与分类组织方案；
2. 新版 \`ProviderSettingsModal.tsx\`（卡片展台 + 极简配置表单 + 标签式模型选择器）的具体重构代码方案；
3. 新增 \`ModelQuickSwitcher.tsx\` 与 \`TaskComposer.tsx\` 胶囊切换联动代码方案；
4. 样式设计与 CSS 选择器规范（对齐 CDS 精密圆角与发丝边框）。
`;

console.log('Sending Task 231 Audit request to DeepSeek-v4.1-Flash API...');

const payload = JSON.stringify({
  model: 'deepseek/deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: 'You are an expert fullstack architect and UI/UX design lead specializing in Agent provider ecosystems, CC-Switch mechanisms, and React architecture.' },
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
      const outPath = path.join(root, 'evidence/sessions/2026-10-19-opencode-audit-231.md');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, fullOutput, 'utf8');
      console.log(`Audit report generated successfully at: ${outPath}`);
      console.log('\n--- AUDIT SUMMARY ---');
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
