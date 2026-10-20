import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const root = 'E:/Code_file/Projects/Vessel_Harness';

// Read relevant design skills
const skillFiles = [
  '.agents/skills/impeccable/SKILL.md',
  '.agents/skills/emil-design-eng/SKILL.md',
  '.agents/skills/make-interfaces-feel-better/SKILL.md',
  '.agents/skills/minimalist-ui/SKILL.md',
  '.agents/skills/dsh-client-ui-ux/SKILL.md',
];

let skillsContent = '';
for (const rel of skillFiles) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) {
    skillsContent += `\n\n=== SKILL: ${rel} ===\n` + fs.readFileSync(p, 'utf8').slice(0, 4000);
  }
}

// Read relevant web UI codebase files
const webFiles = [
  'apps/web/src/App.tsx',
  'apps/web/src/components/layout/layout.css',
  'apps/web/src/styles.css',
  'apps/web/src/components/layout/Rail.tsx',
  'apps/web/src/components/Sidebar.tsx',
  'apps/web/src/components/ConversationView.tsx',
];

let codebaseContent = '';
for (const rel of webFiles) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) {
    codebaseContent += `\n\n=== FILE: ${rel} ===\n` + fs.readFileSync(p, 'utf8').slice(0, 8000);
  }
}

const prompt = `# 任务：Web UI 结构优化深度走查与 GitHub 设计 Skill 调研
你当前作为 OpenCode 架构与设计审查专家（搭载 DeepSeek-v4.1-Flash 模型），对 Vessel Harness 的 Web UI 实际落地结构进行深度走查与设计规范调研。

用户指出的核心痛点：
“调整页面UI结构，页面的UI结构还是差那么一点点，就可以让那个Open Code的Deepseek模型去GitHub调研相关的那种关于设计这方面的Skill，可用来优化项目。这种杂活的话，就交给Open Code去执行。由于之前也对项目的UI进行了重构设计，但真正落地到项目中时，还是存在很多不合理的问题。”

请仔细研读以下设计技能规范以及当前前端代码实现：

${skillsContent}

${codebaseContent}

## 重点审查维度：
1. **网格列宽比例与视口自适应**：
   - 现有 \`.app\` 的 \`grid-template-columns: 58px 232px minmax(0, 1fr)\` + \`gap: 12px\` 在检视器打开（300px）或窄屏时主工作台严重受挤压。
   - 侧栏（Sidebar）折叠/展开与桌面宽屏下的可伸缩自适应问题。
2. **空白工作台 (workbench-home) 与会话详情的割裂**：
   - 空白状态下只有一个居中的 TaskComposer，四周大片死白/死黑，没有与左侧导航的直观呼应，缺少最近活动/项目指引/模板卡片等现代工作台上下文。
3. **双表面检视器 (DualSurfaceLayout) 的层级与抽屉体验**：
   - 检视器 8 个 Tab 与下方 \`.module-sections\` 的垂直堆叠冲突，造成主聊天流和下部面板层级混淆。
4. **视觉令牌与线框边框冲突（Border Prison）**：
   - 多层嵌套卡片时，是否存在过多重叠的 1px border 与阴影污染。
5. **文字排版、元数据对齐与微交互**：
   - 对话流中的时间戳、标签、操作按钮间距与层次。

请撰写一份详尽专业的《Web UI 结构优化与设计走查报告》（Markdown 格式），必须包含：
一、GitHub 与业界前沿设计规范调研（结合 impeccable/emil-design-eng/make-interfaces-feel-better 提炼出的 5 条设计铁律）
二、当前落地 UI 结构的 5 大关键缺陷与具体代码定位（精确到具体组件与 CSS 类）
三、系统性结构重塑方案（具体的 JSX / CSS 修改建议）
四、交由 Codex 独立编写代码的实施计划与验收检查清单（包含具体待修改文件和预期表现）

请输出完整的 Markdown 报告。`;

console.log('Sending request to DeepSeek-v4.1-Flash API...');

const payload = JSON.stringify({
  model: 'deepseek/deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: 'You are OpenCode UI/UX design expert powered by DeepSeek-v4.1-Flash. Output high-quality, professional, actionable markdown reports.' },
    { role: 'user', content: prompt }
  ],
  max_tokens: 8192,
  temperature: 0.2
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
    const outPath = path.join(root, 'evidence/sessions/2026-10-18-ui-structural-audit.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, 'utf8');
    console.log(`Audit report generated successfully at: ${outPath}`);
    console.log('Report length:', content.length, 'characters.');
  });
});

req.on('error', (e) => {
  console.error('Network error:', e.message);
  process.exit(1);
});

req.write(payload);
req.end();
