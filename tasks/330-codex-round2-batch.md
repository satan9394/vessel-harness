# T330 — Codex 应用第二批（E–Q 共 13 段）批次入口

- Status: 执行中（2026-10-26；执行单 `tasks/CODEX-PROMPT-ROUND2.md`）
- PDW task: none（用户指定由 Codex 应用直接实现；PDW 不参与写作）

> 一个批次、13 段，每段有独立验收与 Done 判据；段间串行、同文件单写者。
> 已落地待验收的前序：A（profile HTTP 122 用例）、B（CLI profile 11 用例）、C（Web Profiles 34 用例）。

## 分段与验收

| 段 | 内容 | 验收命令 | Done |
|---|---|---|---|
| E | `byProvider.lastTs` + Web 相对时间 | `apps/cli/src/usage`、web modal | 有值显示、无值不显示 |
| F | `/api/providers/usage?since=&until=` | `apps/local-server/src/server.test.ts` | 过滤生效、非法日期 400、无参不变 |
| G | `vessel usage --csv` | `apps/cli/src/cli.test.ts` | 表头/两行/无记录/与 `--json` 互斥 |
| H | 删除 provider 的 profile 悬空保护 | providers + cli.test | 拒绝、`--force` 级联、无引用正常 |
| I | export↔import 往返保真 | 新 `providerRoundTrip.test.ts` | 非敏感字段逐字一致、key 不出现 |
| J | 用量卡「按模型 Top3」 | `apps/cli/src/usage`、web modal | 降序截断、可展开收起 |
| K | CLI 人读 Top3 模型 | `apps/cli/src/cli.test.ts` | 缩进行数/顺序正确、`--json` 不变 |
| L | Web「未配置密钥」提示 | web modal | 两种状态断言、英文无 CJK |
| M | `provider profile rename` | providers + cli.test | 成功与两种失败路径 |
| N | API/CLI profile 一致性快照 | 新 `profileParity.test.ts` | 四操作一致、能指出漂移侧 |
| P | Provider Hub 名称过滤 | web modal | 命中/未命中/清空 |
| Q | 用量口径可见（T320） | `apps/cli/src/usage`、web modal | 同值/mixed/无值三态 |
| D | 文档收口（§3.4–§3.7、ARCHITECTURE、MAGPIE 表） | `sync-web-presets.mjs --check` | 四处可定位、未写未实现能力 |

## 收口

该批完成后由协调者（DeepSeek 侧）执行：16 条全量门禁（11 批 + `index.test.ts` + web + 三处 tsc）→
提交 → 同步 `tasks/README.md` 与 `HANDOFF.md` 的门禁数字。

## Result

（待 Codex 执行 + 协调者验收后填写）
