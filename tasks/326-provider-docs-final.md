# T326 — provider 文档最终收口（import / profile / 架构 / 对照表）

- Status: 待执行（2026-10-26）
- 依赖：T324（已提交）、T325（profile 落地后）

> 只改文档，不改代码。文风与既有章节一致，中文为主，命令与字段保持英文原文。

## 1. 要写的内容

1. `docs/PROVIDER-MANAGEMENT.md` 新增 **§3.4 从 cc-switch 导出导入**（8–15 行）：
   `vessel provider import --from <file> [--dry-run] [--yes] [--prefix p] [--json]`；默认预览；
   `--yes` 才写盘；key 只经 `CredentialStore`（`secretRef`）落库、不进 `providers.json`；
   已存在 id 默认跳过、`--prefix` 并存；只读你显式给的文件，不读 cc-switch 数据库、不写回。
2. `docs/PROVIDER-MANAGEMENT.md` 新增 **§3.5 供应商 profile 快照**（8–15 行）：
   存储 `~/.vessel/provider-profiles.json`（独立文件；`providers.json` 仍是裸数组，不改形态）；
   形状 `{version:1, profiles:{name:{provider, model?, baseUrl?, label?}}}`；不存凭据、不复制端点池；
   四条 API（`GET/POST /api/providers/profiles`、`POST /api/providers/profiles/:name/use`、
   `DELETE /api/providers/profiles/:name`）与状态码 200/201/400/404；
   `use` 只覆盖给定字段，provider 被删时报悬空错误。
3. `docs/ARCHITECTURE.md`：provider 段补一句「profile 快照是独立文件，不参与凭据解析，也不复制端点池」。
4. `docs/MAGPIE-ABSORPTION.md`：
   - 顶部对照表「切换与 profile」行改为「已有 profile 快照（独立文件 + HTTP API），仍无跨供应商快照/配额路由」；
   - §3 P1-3 标注「已吸收（T325）」；
   - §3 P2-2 标注「已吸收（T324，仅从用户导出文件导入）」。

## 2. 不许做

- 不写「已支持跨供应商 failover / 配额感知路由 / profile 自动同步」——都没做。
- 不改任何代码、不改卡文件、不 commit。

## 3. 验收

```powershell
node scripts/sync-web-presets.mjs --check
```

（文档改动不影响测试；`--check` 只是确认没有把生成物写坏。人工核对：四处改动都能在文件里定位到。）

## Result

（待 Codex 执行后由协调者填写）
