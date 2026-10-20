# 独立只读复核记录（辅助模式）

- 复核时间：2026-10-16
- 模式：**宿主子 Agent 辅助模式**（host read-only sub-agent）。**不是**跨 CLI 自动接力 —— PDW 1.3.1 的 CLI 运行器
  （`pdw.mjs run`）本次**未执行**（不做真实模型调用）。此结论**不得**被用于宣称「PDW 自动接力已通过」。
- 复核者上下文：全新、只读；仅见任务陈述与仓库文件，未参与本次改动。
- 复核者立场：对抗性，要求逐条证伪。
- 范围：本次迁移的改动面（Skill 本体、`pdw.ps1`、`AGENTS.md`、`.gitignore`、`.pdw/config.json`、`evidence/pdw-migration-1.3.1/`、
  `tasks/224-*.md`、`tasks/README.md`、`HANDOFF.md`），以及 MIGRATION.md 的每一条验证声明。

## 1. 逐条判定（复核者原始结论）

| 声明 | 判定 |
|---|---|
| C1 安装树与包清单 7 文件哈希一致 | **HOLDS**（复核者自行重算 SHA-256，逐一相等；ZIP sha256 = 清单值，`tar -tf` 条目数一致） |
| C2 frontmatter 恰为 name+description、正文版本 1.3.1-local、链接可解析 | **HOLDS** |
| C3 `pdw-entry` 只出现一次、其余内容未改 | **HOLDS**（`git diff -- AGENTS.md` 为 +6/−0）；但复核者指出 MIGRATION.md 原「并入尾部英文块」的表述与快照矛盾 → 见 D3 |
| C4 `.gitignore` 唯一改动是 `.pdw/`、旧规则未破坏 | **HOLDS** |
| C5 旧 Skill 备份完整、其 `MANIFEST.sha256` 26/26 通过 | **HOLDS** |
| C6 未触碰产品源码 | **HOLDS**（`packages/` 0 改动；`apps/web` 的未提交改动属任务卡 223，与本次无关） |
| C7 迁移时无活动协调者/Worker | **HOLDS**（存档状态全 completed、`workers.active:0`、无锁）；复核者备注：无法回溯证明历史瞬时无锁 |
| C8 MIGRATION.md 的验证结果与原始日志一致 | **HOLDS** |
| C9 MIGRATION.md 诚实披露未验证项 | **HOLDS** |
| C10 5 项失败根因（`.pdw/` 被 gitignore → 指纹恒空） | **HOLDS**（复核者用控制组实验独立复现） |

## 2. 复核发现的缺陷与处置

| 编号 | 严重度 | 缺陷 | 处置 |
|---|---|---|---|
| D1 | high | 卡 224 与 `tasks/README.md` 引用了 `evidence/pdw-migration-1.3.1/REVIEW.md`，但该文件当时**不存在** —— 属于「引用不存在的证据」 | **已修**：本文件即该产物。原表述是流程顺序失误（先写引用、后落产物），非伪造结论；内容为复核者原始判定 + 处置，未改写其结论 |
| D2 | medium | `AGENTS.md`「记录纪律」引用旧版 `references/memory-policy.md`，而 1.3.1 包已不含该文件 → 悬空引用 | **已修**：该处标注为「旧版 PDW 的 …；1.3.1 包已不含该文档，本条规则本身继续有效」 |
| D3 | medium（误导） | MIGRATION.md 原称尾部英文块是「并入」到新位置的，但迁移前快照（= `HEAD`）不含任何 pdw 文本 → 措辞与事实矛盾 | **已修**：改为如实描述 —— 本块是**纯新增**；过程中 `install` 先追加到文件尾、随即被替换为「六步循环」节内的中文块，标记只留一处 |
| D4 | low | MIGRATION.md 的 `doctor`/`help` "exit 0" 在 `doctor.json`/`help.txt` 里没有退出码字段 | **已修**：新增 [`validation/summary.json`](validation/summary.json) 逐命令记录退出码与「非 0 仍可判 PASS」的理由，§6 已指向它 |
| D5 | low | MIGRATION.md 未说明替换后文件集缩小（`LICENSE`/`CHANGELOG`/`README`/`evals`/多数 `references` 消失） | **已修**：§2 增「Skill 文件集变化（诚实披露）」；说明这是上游包形态、旧版原件全量保留在 `backup/` |

复核者另标注 LEGACY-STATE §4 的 `active: 0` 表述不够严谨（该字段实为 `workers.active`）→ **已修**。

## 3. 复核者未能验证的事项（原文保留）

- 真实模型调用 / 路由 / 输出协议：**刻意未跑**（会消耗用户配额）；证据中没有任何东西可替代它。
- 本仓全量门禁（`npx tsc -b`、`npm run test:all`）：**未跑**；仅确认本次改动不含 `*.ts` / `package.json` / 锁文件变化。
- 「迁移瞬时无活动协调者」：只能证明**当下**存档状态如此，无法回溯证明某次瞬时锁不存在。
- 「与 ZIP 逐字节一致」：属**传递性**验证（安装树 == 清单哈希，且 ZIP sha256 == 清单声明值、条目列表一致），未解压后与磁盘逐字节对拍。
- `AGENTS.md` 迁移前保真度：依赖快照，且该快照与 `HEAD` 逐字节相同。

## 4. 结论

- 复核**通过**：C1–C10 全部 HOLDS；无 blocker。
- 复核发现的 5 项缺陷（1 high / 2 medium / 2 low）已在本次交付内**全部处置**，处置记录见 §2。
- 处置后**未再跑第二轮独立复核**（属于本次已知未闭合项，见 MIGRATION.md §7）。
