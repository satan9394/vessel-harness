# Codex 执行指令：基于内置浏览器的全维对齐实测与审查

## 任务目标
请作为独立首席 QA 与系统架构审查官，根据 GPT 提供的整改规范文档以及本项目最新的实测契约，调用你**内置的浏览器操控能力**，对当前本地 Vessel 系统进行无死角的端到端交互测试、UI 视觉审查与状态真实性复验。

## 必读参考文档
1. 本实测执行指南：`docs/VESSEL_BROWSER_ALIGNMENT_AND_TESTING_SPEC.md`
2. 架构整改规范事实源：`docs/VESSEL_Architecture_Review_and_Execution_2026-10-20.md`
3. UI/UX 整改规范事实源：`docs/VESSEL_UI_UX_Review_and_Execution_2026-10-20.md`

## 执行流程
1. **启动测试环境**：
   在后台启动本地服务：`npx tsx apps/cli/src/cli.ts serve --port 5678`，确认 `http://127.0.0.1:5678` 返回 200。
2. **操控内置浏览器执行实测**：
   使用内置浏览器访问 `http://127.0.0.1:5678`，按顺序执行 `docs/VESSEL_BROWSER_ALIGNMENT_AND_TESTING_SPEC.md` 中的 6 个核心测试用例：
   - 用例 1：Edge-to-Edge 全屏通栏工业美学、实体按键手感与深浅主题切换无发灰实测；
   - 用例 2：输入框中文 IME 拼音选词回车不误触提交实测；
   - 用例 3：新建会话与物理删除实测（验证真实 Windows 回收站与防幽灵会话复活）；
   - 用例 4：Activity 待办中心真实状态投影与错误会话呈现；
   - 用例 5：Provider Hub 凭据免输直测安全强绑定；
   - 用例 6：Agent Studio 与 Inspector 标签认知负荷与优化审查。
3. **输出终审报告**：
   将全部测试用例的通过状态（PASS/FAIL）、浏览器交互截屏存证、与 GPT 文档的达成度评分，以及后续 UI 精简优化建议，写入：
   `evidence/sessions/2026-10-21-codex-browser-verification-report.md`。
