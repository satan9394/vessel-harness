# 193 — Claude Code Mods 沙箱化兼容适配器与防提权网关 (Sandboxed Claude Code Mods Adapter)

- 编号：193
- 优先级：P1
- 关联模块：`packages/runtime`, `packages/policy`, `packages/shared`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已实现，定向门禁通过；整体验收归 Epic 195
- 创建日期：2026-10-08

---

## 1. 目标与意图

Claude Code 官方推出的 Mods 允许通过 TypeScript 函数拦截与扩展工具流，社区已有大量开源 Mod（如自定义 diff 工具、特定框架上下文提取器等）。然而，Claude 原生 Mods 与早期 DSH 兼容层暴露了极其严重的安全隐患：
1. **沙箱逃逸与高危提权风险（CVE-2026-82533 惨痛教训）**：Claude 原生 Mod 直接运行在宿主未受限进程中，若智能体读入恶意外部网页或仓库文件，可能被诱导执行未授权 Mod，进而利用本地特权窃取密钥或越界删除文件；
2. **前缀缓存（KV Cache）被击穿**：未经调度的外部 Mod 随意在系统提示词前后动态追加易变时间戳或随机文本，直接摧毁 V2.1 建立的前缀缓存优势。

本任务旨在建立**具备硬核安全隔离与缓存守护的 Claude Mods 兼容层**：
1. **兼容标准 Claude Code Mod 清单格式**：
   - 支持读取包含 `claude.mod` 或 `package.json` 中定义入口的模块；
2. **受限环境与防提权围栏（Security Enclave）**：
   - 外部 Mod 实例与宿主进程隔离，严禁直接读取宿主 `CredentialStore` API Key 密文；
   - 严禁外部 Mod 动态降低当前平台的 `NativeSandboxRunner` 隔离等级（严禁篡改 Low Integrity / Job Object 配置）；
   - 所有文件与命令执行委托给既有的受限沙箱工具；
3. **前缀缓存纪律（Prefix Cache Guard）**：
   - 外部 Mod 声明的静态系统提示词强制规范化（`canonicalJson`），并统一打上 `[Mod: <name>]` 标签归入三段式布局的 `scopedPrefix`，禁止插入微回合中间。

---

## 2. 接口契约规范 (Interface-First)

> 本节为原始设计草案；本轮用户指定的 Runtime Worker API 取代宿主 implementation 接口，实际契约与兼容边界见 §5。

### 2.1 Claude Mod 规范解析器 (`packages/policy/src/mods/claude/claudeModAdapter.ts`)

```typescript
export interface ClaudeModManifest {
  name: string;
  version: string;
  entrypoint: string;
  permissions?: {
    network?: boolean;
    filesystemRead?: string[];
    filesystemWrite?: string[];
    allowedTools?: string[];
  };
  systemPromptContribution?: string;
}

export class ClaudeModAdapter {
  static loadFromDirectory(dirPath: string): Promise<ClaudeModManifest>;
  static createMiddleware(manifest: ClaudeModManifest, implementation: Record<string, unknown>): ModMiddleware;
}
```

### 2.2 防提权与凭据访问守卫 (`packages/policy/src/mods/security/ModSecurityGuard.ts`)

```typescript
export class ModSecurityGuard {
  static assertSafeAccess(target: 'credentials' | 'sandbox_tier' | 'filesystem', operation: string): void;
}
```
- 任何试图读取 `apiKey` 或降权沙箱级别的调用强制抛出 `SecurityViolationError`。

---

## 3. 架构红线与禁做准则

1. **薄核铁律**：`packages/core` 保持 0 改动，所有适配与隔离在 `packages/policy` 与 `packages/runtime`；
2. **纯本地开发**：绝不提交或推送到 GitHub；
3. **离线测试**：单测使用 Mock 模拟 Mod 入口，严禁运行真实外部未验证网络脚本。

---

## 4. 完成门禁 (DoD)

1. 定向测试全绿：
   - `npx vitest run packages/runtime/src/mods`（实际 Adapter、Worker 与攻防用例；取代原设计草案路径）
2. 类型构建通过：
   - `npx tsc -b tsconfig.json` exit 0
   - `npm run typecheck:tests` exit 0

## 5. 工作证明（2026-10-08）

- 实际挂载位置遵循本轮用户指令：`packages/runtime/src/mods/workerSandbox.ts` 与 `claudeModAdapter.ts`；共享纯清单契约为 `packages/shared/src/modManifest.ts`。`packages/core` 零改动。
- 未签名源码只在环境变量清空、Node Permission Model 拒绝文件/子进程/Worker 权限的 Worker 内执行；VM 无宿主函数/对象、无 process/require/Buffer，禁动态代码生成。输入输出为 JSON 数据，VM 的 RPC 队列在私有闭包内，超时终止 Worker。禁止权限/凭据/沙箱字段跨边界；上下文 metadata 不传给 Mod。
- RPC 只支持 Read/Write/Edit，固定清单快照、路径 realpath、隐藏/凭据路径拒绝、范围白名单及独立宿主 policy 授权同时生效。授权与委托回调接收 AbortSignal，超时后不得发起委托；已发起工具须遵守取消信号，并使用既有受限文件工具在实际操作时再次执法（防外部路径竞争）。不支持网络、命令执行或任意 npm 依赖，全部 fail closed。
- 兼容范围：`vessel.mod.json`、JSON `claude.mod` 或 package.json 的 `claude.mod` 对象；入口为预编译、无依赖的 CommonJS JS 或 ESM `export default` 对象。旧卡中的宿主 `implementation: Record` 调用明确不采用。每个 hook 新 Worker，不保留跨 hook 运行状态。
- 静态 scoped contribution 按换行/首尾空白规范化为确定性字符串表示，加 `[Mod: name]`；调用者必须启动时固定，仅追加 scopedPrefix 尾部。此卡不编辑三段式构建器。
- `npx vitest run packages/runtime/src/mods`：4 文件 / 33 测试通过；覆盖环境/constructor/dynamic import 逃逸、权限降级、RPC 越权、目录 junction 指向秘密、超时 CPU/异步挂起、延迟授权取消、桥接 Array/Reflect 篡改、解析与上下文隔离。
- `npx tsc -b tsconfig.json` 与 `npm run typecheck:tests`：exit 0。
- 原始输出：`evidence/sessions/2026-10-08-v2.2/card193-tests.log`、`card193-tsc.log`、`card193-typecheck-tests.log`，均包含显式 `EXIT_CODE=0`。没有调用外部 Agent、安装依赖、提交/推送/发布或永久删除仓库文件。
- 对抗评审 Agent 的工具回合被内容过滤阻断，未形成独立新增测试文件；其返回的 Array 原型可变风险已修复，并由确定性攻防测试验证。Epic 195 负责独立整体验收，此卡不自证全仓完成。
