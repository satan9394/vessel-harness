# 152 — 1.0 发布准备：release notes（中英双语）+ 门槛核对

- 编号：152
- 状态：已合入（2026-09-19）
- 优先级：P1（1.0 收尾准备）
- 创建日期：2026-09-19
- 关联：`docs/RELEASE-NOTES-v1.0.md`（新）、`docs/V1.6-STABLE-CHECKLIST.md`、`README.md`、`tasks/149`
- 执行器：指挥侧

## 1. 目标

准备 1.0 发布材料，**停在打 tag 前**（发布不可逆，留人工确认）。

## 2. 交付（纯文档）

- 新增 **`docs/RELEASE-NOTES-v1.0.md`**（中英双语草稿）：产品定位、安装与运行、13 项 Stable 门槛状态
  （**达成 10 / 部分 3 / 阻塞 0**）、本版本实测门禁、亮点、路线排除项；明确标注"**尚未打 tag**"与
  两项待刷新产物（`release-report.{md,json}`）。
- **`README.md` 现状数字改准**：badge `2197+120` → `2237+120`；门禁表 `171 文件 / 2197 passed` →
  `178 文件 / 2237 passed + 6 skipped`；"已知边界"补 `--live` 外部 adapter 脱节（`tasks/149`）。
- **`docs/V1.6-STABLE-CHECKLIST.md` 结论更新**：可自主项新增 `150`（修复 adapter）；"离 1.0 只差"① 由
  "待配额确认"改为 **blocked（本仓缺陷）**；登记发布准备已就绪。

## 3. 验收与实测

- 门禁（纯文档仍跑）：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` exit 0
  （根 **178 文件 / 2237 passed + 6 skipped**；web **11 / 120**）、web `vite build` exit 0、CLI 冒烟 exit 0。
- 核验：`docs/RELEASE-NOTES-v1.0.md` 存在且标注"草稿 / 尚未打 tag"；`README.md` 门禁数为 `178/2237`；
  `V1.6-STABLE-CHECKLIST` 结论含 `150` 与 blocked ①。

## 4. 边界

- 只写文档；**不执行** `git tag` / `npm publish`（不可逆，留人工）。
