import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const root = 'E:/Code_file/Projects/Vessel_Harness';

// Read relevant CDS manual sections
const cdsManualPath = path.join(root, 'evidence/reference-cds/Claude-Design-System.full.md');
const cdsContent = fs.existsSync(cdsManualPath) ? fs.readFileSync(cdsManualPath, 'utf8').slice(0, 35000) : '';

// Read current web codebase structure
const currentFiles = [
  'apps/web/src/styles.css',
  'apps/web/src/components/layout/layout.css',
  'apps/web/src/components/ConversationView.tsx',
  'apps/web/src/components/TaskComposer.tsx',
  'apps/web/src/App.tsx',
];

let codebaseExcerpt = '';
for (const rel of currentFiles) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) {
    codebaseExcerpt += `\n\n=== CURRENT FILE: ${rel} ===\n` + fs.readFileSync(p, 'utf8').slice(0, 5000);
  }
}

const prompt = `# 调研任务：基于 Open Claude UI (CDS) 的 Vessel Web UI 深度优化方案
你当前担任 OpenCode 架构与设计审查专家（搭载 DeepSeek-v4.1-Flash 模型）。
用户指令：“下一步方向是执行UI优化，参考的GitHub项目是https://github.com/Caho1/open-claude-ui”。

以下是该项目的核心逆向设计系统技术手册摘要（Claude Design System，涵盖 Surface 0-3 阶梯、陶土橙 Clay #d97757、发丝细边 Hairline、精密圆角拓扑、Zero-JS 滚动消隐遮罩、IME 中文输入法守卫、字重逆补偿等）：

${cdsContent}

---

以下是 Vessel Harness 现有前端落地代码：

${codebaseExcerpt}

---

## 你的调研任务与产出要求：
请撰写一份详尽专业、高可落地性的《基于 Open Claude UI (CDS) 的 Vessel Web UI 深度优化方案与整改清单》（Markdown 格式，落盘至 evidence/sessions/2026-10-19-open-claude-ui-study.md）。
报告必须包含以下章节：

一、Open Claude UI (CDS) 核心设计精髓拆解与对标价值
（详细解构其 Surface 0-3 色彩阶梯、陶土橙色彩哲学、0.5px 高分屏发丝细边、精密圆角矩阵、IME 守卫、CSS 滚动消隐遮罩等）

二、Vessel Web UI 当前落地与 CDS 规范的差距走查
（精确对比：色彩令牌体系、Composer 外框与输入体验、聊天流上下滚动边界、按键与微交互动效）

三、系统性整改方案与落地细则（面向后续 Codex 编码落地）：
1. 令牌层升级：引入或映射 CDS Surface 0-3 阶梯与 Clay 语义色，实现视网膜发丝细边与深色模式字重逆补偿；
2. 输入引擎升级：给 TaskComposer 增加 IME 拼音输入法合成守卫（避免中文输入回车误提交），优化自适应圆角（20px 外框）与操作栏布局；
3. 聊天流与滚动消隐遮罩升级：引入原生 CSS \`mask-image\` 渐隐遮罩，使消息上下滚动进出时呈现平滑柔和的渐隐消失，而非生硬截断；
4. 交互微动效与精密尺寸：对齐 70ms/120ms 几何咬合曲线，按钮与胶囊的物理微回弹。

四、拆解为任务卡 228 的确定性验收断言与实施步骤清单（供 Codex 在独立沙箱中编写代码）。
`;

console.log('Dispatching OpenCode (DeepSeek-v4.1-Flash) for Open Claude UI study...');

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
    const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content;
    const outPath = path.join(root, 'evidence/sessions/2026-10-19-open-claude-ui-study.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, 'utf8');
    console.log(`Study report generated successfully at: ${outPath}`);
    console.log('Report length:', content.length, 'characters.');
  });
});

req.on('error', (e) => {
  console.error('Network error:', e.message);
  process.exit(1);
});

req.write(payload);
req.end();
