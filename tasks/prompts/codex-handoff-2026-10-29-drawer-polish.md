# Codex 单：团队抽屉展开的第二轮打磨（2026-10-29）

现状：**HEAD 以 `git log -1` 为准**（写单时 `3f5e9b9`，本单自身随其后的文档提交入库），**工作树干净**；全量门禁最近一次 **17 步 exit 0**（根 335 文件 / 3,713 passed + 8 skipped，web 61 / 535，离线 conformance 25/25 $0）。**不要重跑全量门禁**。

这一单只有一件（卡 365），内含两处小改动，都是上一轮卡 364 验收时记下的非阻塞偏离。**先读 `tasks/365-team-drawer-copy-and-toggle-polish.md` 再动手**，验收标准以卡里的 A1–A6 为准，本单只补操作细节。

纪律：主线程执行、禁止子代理；**不 commit / 不 push**、不新建卡、不改任何卡的首行状态与既有行（只在卡 365 末尾追加）；不调其它 Agent CLI；证据只落新目录 `evidence/sessions/2026-10-30-drawer-polish/`，浏览器下载一律落 `%TEMP%`；端口先探再用（建议 5700–5710，被占就换），收尾必须停服务并报监听数 0。路由 `gpt-6.1-sol` / `medium`，Fast 关，不用 Ultra。

---

## A · 5 条文案搬进 i18n 类型化字典

现状代码（`apps/web/src/components/team/TeamNodeDrawer.tsx` 第 7–10、20–21 行）：

```ts
const outputCopy = {
  zh: { expand: '展开全文', collapse: '收起', loading: '正在加载…', failed: '全文加载失败，请重试。', capped: '输出超过 64 KiB，仅显示前 64 KiB。' },
  en: { expand: 'Expand full output', collapse: 'Collapse', loading: 'Loading…', failed: 'Could not load full output. Please retry.', capped: 'Output exceeds 64 KiB; showing the first 64 KiB.' },
};
// …
const { t, lang } = useI18n();
const copy = outputCopy[lang === 'zh' ? 'zh' : 'en'];
```

要求：

1. 在 `apps/web/src/i18n.ts` 里新增 5 个键（建议沿用现有 `ui*` 命名，例如 `uiTeamOutputExpand` / `uiTeamOutputCollapse` / `uiTeamOutputLoading` / `uiTeamOutputFailed` / `uiTeamOutputCapped`，落在团队/抽屉相关键区），`zh` 与 `en` **各写一份**，值**逐字照抄**上面 10 条字符串（中文含全角句号与 `…`，英文大小写照抄）。**不要改任何既有键的取值**。
2. 抽屉改用 `t('…')` 取文案，删掉 `outputCopy` 与 `lang` 三元；`useI18n()` 只留 `t`。
3. `i18n.test.ts` 会断言 zh/en 键集一致且值非空——跑它，并确认新键两侧都能取到值。

判据 A1/A2：`grep -R "outputCopy" apps/web/src` 无命中；新串只在 `i18n.ts` 出现；中文串与上面逐字一致（在测试或报告里能看到原文断言，不接受「已迁移」的口头结论）。

## B · 展开/收起控件不再被正文挤走

现状：`TeamNodeDetails` 里按钮排在 `<pre>` 之后，570 字展开已把它推出首屏，长输出更甚。

要求：

1. 控件在**收起态与展开态位置一致**，且不位于长正文之后。建议做成输出块上方的一条控制行（`<div>` + 按钮），`<pre>` 紧随其后；`aria-expanded`、`disabled={loading}`、`aria-label` 语义保持不变。
2. **不要**给 `<pre>` 加 `max-height` + `overflow: auto`（抽屉本身在页面滚动流里，会出双滚动条）。若你实测认为必须走内层滚动，先在报告里写清为什么，再改。
3. 展开/收起后焦点不得丢失（同一元素不重建），两侧状态切换后 `document.activeElement` 仍是该按钮。
4. 视觉：按钮与内容间距、字号沿用现有 `.btn`；不要新造一套样式体系。若确需 CSS，只加 `.team-node-drawer` 作用域内的规则。

判据 A4：可见 IAB（1440×900，深色）两张——570 字样本 + 一条 ≥4000 字样本，展开后「收起」按钮的 `getBoundingClientRect().top/bottom` 与 `innerHeight` 一并给出，证明没被推出视口；收起后长度回到 301。Console 必须为空。

---

## 自验（都要贴命令与结果）

```
node node_modules/vitest/vitest.mjs run --root apps/web
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
```

- 组件测试要**扩**不要**换**：卡 364 的 5 项断言（298/300 无控件、570 往返与缓存、失败保留摘要、超限提示）必须原样通过；新增一条语言切换用例（`en` 下按钮文案为英文、`zh` 下为中文，展开长度不变）。
- `apps/web/dist` 被 gitignore。要在 IAB 里看当前源码，可以跑 `npm run -w @vessel/web build`（脚本已带 `--emptyOutDir false`）后服务 dist，**并在报告里写清你服务的是哪份构建**；上一轮的坑是仓库 dist 过期导致「复现旧 bug」，别重演。
- 已知 flake：`apps/local-server` 与 `apps/cli` 合在一次 vitest 调用时偶发 `teamStageApi` 断言失败（真正成因已由卡 363 修掉）。本单不涉及这两个包，不用跑它们；若你顺手跑了并遇到，单跑一次再判。

## 不做

- 全量门禁、`packages/**`、`apps/local-server/**`、`apps/cli/**`。
- 卡 364 的只读端点与 `TeamRuntime.getStage()` 的 300 字截断（一行都不要动）。
- 其它 UI 顺手改（队列、画布、会话头部都不在本单）。
- 新增第二份字典、i18n 框架迁移（不引入 i18next）。

## 交付

- 新目录 `evidence/sessions/2026-10-30-drawer-polish/`：`report.md`（每项 通过 / 不通过（附现象）/ 无法验证（附原因））、截图、`json` 实测、收尾进程记录、被拒或失败命令原文。
- 只追加到 `tasks/365-team-drawer-copy-and-toggle-polish.md` 末尾；不改首行状态、不改 `tasks/README.md`（协调者收口时改）。
- 报告末段给：改动文件清单（与卡 365 的 Blast Radius 逐条对照）、`--root apps/web` 文件数 / 测试数、`tsc` 退出码、端口与进程收尾结论。

## 停止条件

A、B 互不依赖：一项连续两次失败就停下写清实测值，另一项继续。任何改动超出卡 365 的 Blast Radius 时先停手写理由，不要自行扩围。要动端点或运行时截断，视为越界，直接报 blocked。
