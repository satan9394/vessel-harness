# 任务卡 377: Web UI 极简化重构 · 第三轮（F8–F11 收口）

- Status: 已验收（2026-11-24 20:35；四条判据全过，待用户决定是否入库）
- PDW task: none（宿主是 Multica，不走 PDW run）
- 前情：`.pdw/ui-restyle-20261123/HANDOFF.md`（不入库，`.pdw/` 已忽略）；ACRU-18 第二、三轮由 `atelier-impl` / `atelier-review` 完成，工作树停在 `styles.css` = `66da42605362466b989614ea671c103cca2bdcbb`。

## 1. Goal

把 2026-11-23 交接文档 §4 列的四条目视问题收口。协调者 2026-11-24 复测后重新定性为「两条已复现 + 两条未复现」，本轮只按可测量判据推进，不为复现不了的现象改代码。

- F8 侧栏项目段：`.side-list` 写死 `max-height:170px`，39 行 ×24px = 936px 内容挤在 170px 里（桌面 1440×900，`.side-nav` scrollHeight 2408 / clientHeight 676），项目段与「历史会话」段间距实测 16px 正常。要改成随可用高度自适应的布局，去掉魔法数字。
- F9 会话分组标题重复项目名：`vessel_harness` 在侧栏 innerText 出现 2 次（项目行 + `.side-label` 分组标题），且所有 `.side-label` 都是 `text-transform:uppercase`。
- F10 禁用态主按钮与输入框同灰度：`.composer-send:disabled` = `#efeff1`（`--panel-3`）、`border:0`、字色 `#6b6b73`（`--text-3`），与 composer-chip 的 `#f7f7f8`、surface 的 `#ffffff` 无区分，读起来是「死块」。
- F11 390px 模型胶囊溢出：**未复现**。320/360/375/390/420 五个宽度下 `document.scrollWidth == innerWidth`，pill 右缘始终距 surface 右缘 15px，`.model-switcher-trigger` 的 `scrollWidth == clientWidth`（44 字符文本装得下）。本轮要求 squad 复核，复现不了就写「未复现 + 证据」，不改代码。

## 2. Not Doing

- 不改 `packages/**`、`apps/local-server/**`、`apps/cli/**`。
- 不碰 `.agents/skills/**`（另有会话的未提交改动）、`.pdw/config.json`、`DEV_LOG.md`。
- 不新增依赖，不引 Tailwind/shadcn。
- 不 commit、不 push、不删文件；删除只进回收站。
- 不在 squad 内跑 PDW 的 `run` / `resume`。
- 不为了「让清单全绿」而改验收口径。

## 3. Acceptance

全部在最后一次编辑之后执行：

- A1 `npm run -w @vessel/web typecheck` exit 0。
- A2 `npm run -w @vessel/web test` 0 failed，文件数 ≥61、用例数 ≥543（新增守卫测试则如实记录新基线）。
- A3 `npm run -w @vessel/web build` exit 0。
- A4 F8：`.side-list` 的 `max-height` 不再是硬编码 `170px`；39 行时行高 ≥20px、不出现压扁；项目段与历史会话段间距 ≤24px；`.side-nav` 不再整段溢出滚动（历史列表在自己的容器内滚动）。
- A5 F9：单 workspace 场景下侧栏 innerText 里 `vessel_harness`（不分大小写）出现 **1** 次；分组标题与项目行二选一，`.side-label` 不再统一 `uppercase`。
- A6 F10：空输入时 `.composer-send` 与 surface 有可辨差异（`border-top-width ≥ 1px` 或背景 ≠ `--panel-3`），且文字对比度不低于 3:1。
- A7 F11：320/360/390/420 四宽度 `docScrollWidth == innerWidth`，pill 右缘 ≤ surface 右缘；或明确记录「不可复现」并附四宽度测量值。
- A8 改动只落在 `apps/web/**`（+ 必要的测试同步）；`.agents/skills/**`、`DEV_LOG.md` 的哈希与开跑前一致。

## 4. Blast Radius

`apps/web/src/**`（`styles.css`、`components/Sidebar.tsx`、`components/TaskComposer.tsx` 等）与对应 `*.test.ts(x)`。禁止改构建配置、tsconfig、`package.json` 依赖。

## 5. Expected Evidence

- 三个命令的退出码与用例计数（实测输出，不写「应该通过」）。
- 派单前的探针基线：`.tmp/ui-restyle-20261124/probe-before.json`（协调者实测）。
- 小队自己的 before/after 截图与 computed style 数值；截图与临时文件放任务工作目录，不落进仓库。
- 四条逐条判定，未通过与不可复现都必须写原因与数值。

## 6. Result

**结论**：F8 / F9 / F10 闭环，F11 按「未复现」核销。三命令在最终树上（20:33，`styles.css` = `5251a17f`）由协调者复跑：`typecheck` exit 0、`test` **61 文件 / 546 用例，0 failed**、`build` exit 0（仅既有 chunk >500kB 警告）。改动 10 个文件 `+393 / −127`，全在 `apps/web/**`；`.agents/skills/**`（7 个）与 `DEV_LOG.md` 的 mtime 仍是 11-18 / 11-05，本轮未碰。

判据前后值（探针 `.tmp/ui-restyle-20261124/probe-final2.json`，脚本 `.tmp/ui-probe.py` / `.tmp/ui-widths.py` / `.tmp/ui-compare.py`）：

| 项 | 改前 | 改后 |
|---|---|---|
| F8 | `.side-list` `max-height:170px`，39 行 936px 挤在 170px；`.side-nav` 2408/676 整体滚 | `max-height:none`，列表 248px 自身滚动、行高 24px；`.side-nav` 676/676 |
| F9 | `vessel_harness` 出现 2 次；`.side-label` `text-transform:uppercase` | 出现 1 次；`transform:none`；无会话的空组不再出裸标题 |
| F10 | `#efeff1`、`border:0`、字色 `--text-3` | 同底色 + `border-top:1px`、字色 `--text-2`；文字对比度浅 6.62:1 / 深 7.67:1 |
| F11 | 交接文档记为 390px 溢出 | 320/360/375/390/420 × 浅/深 10 组：`docW == innerW`，胶囊距卡片右缘恒 15px，未复现、未改 |

**未收口但非阻塞（交用户定）**：
1. `GoalModule.tsx:230` 入队按钮从 `btn btn-primary` 降为 `btn`——符合「一屏一个主动作」，但无对应 AC，属顺手改，未回退。
2. `ComposerMeters.tsx:132` 删掉 model / approval 两个静态胶囊，注释称其已在会话头；审批档实际由 `ModelSelector.tsx:72` 的 `.effective-permission` 显示，结论成立，但注释措辞可再准。
3. `ComposerMeters.test.tsx:68` 标题写「四个胶囊」而函数体不渲染胶囊——上一轮 F7 遗留的恒真测试，建议另开一张卡补真断言。
4. 项目段 40% 上限是新写的分配比例（39 个项目时 271px），来源是选型而非数据，换比例需改一处常量。
5. `projectName()` 只取路径末段，本机 39 个 workspace 里 9 个可见组标题有 7 个叫 `ws`——命名口径问题，非本轮引入。

## 7. 第三轮清账（2026-11-25）

对上一条的「未收口但非阻塞」做了一轮只清灰尘、不改视觉的收尾，派单范围限定三条：

- `ComposerMeters.test.tsx:68` 的恒真标题拆成两条真断言：新测试实际 `render(<ComposerCapsules/>)`，断言 `capsule-k` 只剩 `Project` / `Mode`、不含 `Model` / `Approval`、mode 三档仍在；`MetersRow` 那条标题改成它实际测的东西。用例 546 → **547**。
- `ComposerMeters.tsx`：删掉零调用方的 `fallbackPermission`（`git grep` 无引用），注释改为指向真实位置 `ModelSelector.tsx:72` 的 `.effective-permission`。
- `GoalModule.tsx:230` 的按钮降级：**已回退成 `btn btn-primary`**（它现在不在 diff 里，与 HEAD 一致）。理由见下。

验证（2026-11-25 01:40，最终树）：`typecheck` exit 0、`test` 61 文件 / **547 用例全过**、`build` exit 0；`styles.css` 仍是 `5251a17f`；探针与 20:33 那次逐字段比对 **0 处差异**（`probe-cleanup.json` vs `probe-final2.json`），确认视觉零变化。最终入库面：`apps/web/**` **10 个文件 `+405 / −130`** + 本卡。

关于 `GoalModule` 的降级为什么不算「清账」：`GoalModule` 是独立面板，入队是该表单的提交动作，`styles.css` 的 `.goal-module .btn:not(.btn-primary)` 会把它降成文字按钮——这是视觉降级，且没有任何 AC 要求它。归到「未决项」时也只能写成「提出但未获准」，不能当成已接受的改动。

