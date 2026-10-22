import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const root = 'E:/Code_file/Projects/Vessel_Harness';

const modalSrc = fs.readFileSync(path.join(root, 'apps/web/src/components/providers/ProviderSettingsModal.tsx'), 'utf8');
const chipsSrc = fs.readFileSync(path.join(root, 'apps/web/src/components/providers/ModelChips.tsx'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'apps/web/src/App.tsx'), 'utf8');

const prompt = `# 架构与 UI 深度审计：Task 232 模型供应商全屏独立中枢与高级模型筛选器设计
作为 OpenCode 首席架构师兼高级前端专家，请根据用户提出的核心痛点与需求，对 Vessel Web UI 进行深度重构方案设计。

## 用户核心痛点
1. **痛点一：入口极差、做得很丑陋**：
   用户反映：\"我点过去，那里只有'模型设置'这四个字；点进去才有那个页面。我觉得这个页面可以单独挪出来，这是问题一。\"
   - 目前在 App.tsx 的 Settings 区域，只渲染了一个简单的按钮唤起 Modal 弹窗。
   - 需求：将模型供应商管理抽离为一个完整、专业、大气的独立全屏主视图工作台（如 \`ProviderHub.tsx\`），在 \`area === 'settings'\` 时直接铺开呈现；同时保持全局 Modal 调用的兼容性。
2. **痛点二：海量模型（如 Lark 飞书、OpenRouter 等）无法搜索、缺乏全选/全不选**：
   用户反映：\"Lark模型的搜索功能没有，也没有全选、全部选等功能，很糟糕。不然那么多，我不好选择，这是一个问题。\"
   - 目前的 ModelChips.tsx 仅 37 行，将所有模型一股脑挤在 flex-wrap 容器里，面对几十上百个候选模型时，无法搜索、无法批量操作。
   - 需求：重构为高级模型筛选器组件，提供实时模糊搜索、一键全选/全不选/反选、已选计数徽章（如\"已选 12 / 86\"）以及上下滚动羽化遮罩。
3. **痛点三：权威供应商预设达到 CC-Switch 级别**：
   - 补齐 Lark（飞书/火山方舟）等权威预设。

## 既有组件代码现状：
### 1. ProviderSettingsModal.tsx
\`\`\`tsx
${modalSrc.slice(0, 15000)}
\`\`\`

### 2. ModelChips.tsx
\`\`\`tsx
${chipsSrc}
\`\`\`

### 3. App.tsx (Settings 相关区域)
\`\`\`tsx
${appSrc.slice(6000, 10000)}
\`\`\`

请输出一份详尽、具备完整代码级实现的审计设计方案报告：
1. **ProviderHub 全屏组件架构与 App.tsx 无缝接入方案**（包含独立全屏模式与 Modal 模式的优雅复用）；
2. **高级 ModelChips 组件完整实现**（搜索过滤、全选/全不选/反选、计数徽章、键盘访问、发丝滚动羽化）；
3. **飞书 Lark 预设定义（presets.data.ts & presetsData.ts）**；
4. **CSS 规范与 CDS 视觉令牌（对齐 impeccable / make-interfaces-feel-better 规范）**；
5. **单测策略与向后兼容保障**。
`;

console.log('Sending Task 232 Audit request to DeepSeek-v4.1-Flash API...');

const payload = JSON.stringify({
  model: 'deepseek/deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: 'You are an elite staff frontend architect and design system specialist designing a modern AI provider hub.' },
    { role: 'user', content: prompt }
  ],
  max_tokens: 8192,
  temperature: 0.2
});

function sendRequest(retryCount = 0) {
  const req = https.request('https://api.commandcode.ai/provider/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENCODE_TOKEN ?? ''}`
    },
    timeout: 90000
  }, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning_content || data;
        const outPath = path.join(root, 'evidence/sessions/2026-10-19-opencode-audit-232.md');
        fs.writeFileSync(outPath, content, 'utf8');
        console.log(`OpenCode Audit written to: ${outPath}`);
        console.log('\n--- Audit Summary ---');
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
