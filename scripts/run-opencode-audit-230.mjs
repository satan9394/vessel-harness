import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const root = 'E:/Code_file/Projects/Vessel_Harness';

// Read relevant web UI codebase files
const targetFiles = [
  'apps/web/src/components/Sidebar.tsx',
  'apps/web/src/components/TaskComposer.tsx',
  'apps/web/src/styles.css',
];

let codebaseContent = '';
for (const rel of targetFiles) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) {
    codebaseContent += `\n\n=== FILE: ${rel} ===\n` + fs.readFileSync(p, 'utf8').slice(0, 16000);
  }
}

const prompt = `# 任务：基于 Claude Design System (CDS) 的侧边栏会话管理与任务输入器质感升级审计 (Task 230)
你作为 OpenCode 架构与设计审查专家（搭载 DeepSeek-v4.1-Flash 模型），对 Vessel Harness Web UI 的侧边栏（Sidebar）与任务输入器（TaskComposer）进行深度审查，并对标 Caho1/open-claude-ui (CDS) 第 3.1、3.2、3.4 节规范，制定具体的代码改造方案供 Codex 实施。

## 目标组件与样式现状
${codebaseContent}

## 审查与对标维度：
1. **侧边栏与会话管理 (Sidebar.tsx & .sidebar / .topic-*)**：
   - 现存问题：
     - \`.topic-group\` 使用生硬的 \`1px solid var(--row-line)\` 分割线，形成线框牢笼（Border Prison）；
     - 缺少真日常期分组（Today / Yesterday / Previous 7 Days / Older），当前 \`periods\` 展开逻辑将日期分段破坏；
     - 会话操作菜单（重命名、归档）使用原生 \`<details><summary>···</summary>\`，布局突兀，且未对齐 CDS 悬停浮现微动效；
     - 搜索框与归档过滤复选框排版松散，缺少发丝圆角搜索胶囊设计。
   - 对标 CDS：如何改造成无生硬横线、悬停微浮现操作动作、高亮指示轨（active rail）、精密圆角（--r-sm: 6px）的沉浸式会话树？
2. **任务输入器质感重塑 (TaskComposer.tsx & .task-composer)**：
   - 现存问题：
     - \`.task-composer\` 现为生硬的 grid 布局，表单内多处原生 \`<label>\` 与突兀原生 \`<select>\` 下拉框；
     - 输入区域缺少 CDS 的容器同心圆角（--r-composer: 20px）与三态柔和投影（normal / hover / focus-within）；
     - 底部操作栏（模型、权限、高级设置）应聚合为微型胶囊栏（Pills Bar），并与发送按钮进行光学对齐。
3. **视觉减负与 CDS 动效物理学**：
   - 全面清理过时/非标 CSS 变量（如 \`--panel2\`、\`--row-line\`），统一收敛至 CDS Surface 阶梯（\`--panel\`、\`--panel-2\`、\`--ring\`、\`--ring-hairline\`）；
   - 为侧边栏条目与输入框按压添加 \`var(--dur-fast)\` 与 \`scale(0.98)\` 微回弹。

请输出详尽、具体、具备可直接落地代码建议的审查报告，格式清晰，包含具体函数与 CSS 选择器的重构代码草案。
`;

console.log('Sending Task 230 Audit request to DeepSeek-v4.1-Flash API...');

const payload = JSON.stringify({
  model: 'deepseek/deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: 'You are an expert UI/UX design engineer specializing in Claude Design System (CDS) and React/CSS architecture.' },
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
      const outPath = path.join(root, 'evidence/sessions/2026-10-19-opencode-audit-230.md');
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
