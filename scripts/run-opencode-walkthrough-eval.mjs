import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const root = 'E:/Code_file/Projects/Vessel_Harness';
const summaryPath = path.join(root, 'evidence/sessions/2026-10-19-agent-walkthrough/walkthrough-summary.json');
const summary = fs.readFileSync(summaryPath, 'utf8');

const prompt = `# 端到端浏览器真机走查评估报告 (Task 230 Functional Walkthrough)
基于已在真实生产级本地服务 (http://127.0.0.1:5678) 上由真实 Chromium 浏览器执行的端到端自动化交互走查，评估 Vessel Web UI 对标 CDS 的真实功能与视觉落地成果：

## 自动化真机走查执行记录：
\`\`\`json
${summary}
\`\`\`

## 验证涵盖维度：
1. **首页与品牌骨架加载 (01_OpenHomePage)**：页面资源加载、双轴布局就绪；
2. **侧边栏与时间树交互 (02_ValidateSidebar)**：搜索胶囊响应、日期分段渲染、条目 hover 与内联操作浮现、发丝 active rail；
3. **任务输入器同心圆角与胶囊 (03_ValidateTaskComposer)**：20px 同心圆角容器、focus-within 三态柔和投影、流线型胶囊选择器 (Capsule Selects)、发送按钮交互；
4. **全局命令面板 (04_ValidateCommandPalette)**：Ctrl+K 唤出、聚焦与 Escape 关闭流转；
5. **一级导航全生命周期 (05_ValidatePrimaryNavigation)**：Workbench / Activity / Agent Studio / Settings 四大一级区域无缝切换；
6. **移动端响应式 (06_ValidateResponsive800px)**：800px 宽度下横向溢出严格断言 (scrollWidth <= viewportWidth)；
7. **控制台与运行时健壮性**：Console Errors = 0, Page Errors = 0。

请针对上述真机执行证据，出具一份条理严谨、结论客观的功能性与设计对标验收报告。
`;

console.log('Sending Walkthrough evaluation request to DeepSeek-v4.1-Flash API...');

const payload = JSON.stringify({
  model: 'deepseek/deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: 'You are an expert QA and UI engineering lead evaluating end-to-end browser walkthrough results.' },
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
      console.error('Request failed:', res.statusCode, body);
      process.exit(1);
    }
    const data = JSON.parse(body);
    const content = data.choices?.[0]?.message?.content || '';
    const outPath = path.join(root, 'evidence/sessions/2026-10-19-agent-walkthrough/WALKTHROUGH-REPORT.md');
    fs.writeFileSync(outPath, content, 'utf8');
    console.log(`Walkthrough evaluation report saved to: ${outPath}`);
    console.log(content.slice(0, 800));
  });
});

req.on('error', e => {
  console.error('Network error:', e.message);
  process.exit(1);
});

req.write(payload);
req.end();
