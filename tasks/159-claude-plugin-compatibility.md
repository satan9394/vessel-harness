# 159 — Claude Code 社区插件与 Hook 生态全兼容层 (Claude Plugin & Hook Compatibility Layer)

- 编号：159
- 状态：已合入（用户验收通过 2026-09-24）
- 优先级：P1
- 创建日期：2026-09-24
- 关联模块：`packages/skills`, `packages/policy`
- 执行模型：Codex (GPT-6 Luna - Max Thinking)
- 验收人：用户

## 1. 目标与意图

打破单纯支持单一 `SKILL.md` 的狭隘局面，全面接入 Claude Code、`claw-code` 与 ECC 社区的完整插件生态。
使 Vessel 具备识别并加载包含 `plugin.json`、多 Skill 组合、以及声明式生命周期 Hook（如 `PreToolUse`、`PostToolUse`）的复合插件包能力，
同时将外部未受信任的 Hook 动作安全映射至 Vessel Policy Engine 四件套进行硬执法拦截，兼顾生态兼容与系统安全。

## 2. 权威开源参考基准与读取指引 (GitHub & Local Assets)

### 重点参考开源项目：
1. **Claude Plugins Official**：`https://github.com/anthropics/claude-plugins-official`
   - 本地免下直读路径：`E:\DeepSeek_Harness\workspace\2026_08_25\stars-scan\repos\anthropics__claude-plugins-official\`
   - 对标要点：官方插件包目录结构、`plugin.json` 规范、多 skill 的命名空间划分。
2. **Everything Claude Code (ECC)**：`https://github.com/affaan-m/ECC`
   - 本地免下直读路径：`E:\DeepSeek_Harness\workspace\2026_08_25\stars-scan\repos\affaan-m__ECC\`
   - 对标要点：社区生产级复杂插件架构、插件级 hooks 声明与跨工具编排。
3. **Claw-Code (UltraWorkers)**：`https://github.com/ultraworkers/claw-code`
   - GitHub: `https://github.com/ultraworkers/claw-code`
   - 对标要点：`.claw/skills/` 规范化发现根与多级配置合并（user > project > local）。

### 读取纪律：
- 优先读取本地已存在的 `stars-scan\repos\` 目录，零网络消耗秒读。
- Clean-room 准则：仅参考其配置结构与事件定义，核心适配器逻辑完全 clean-room 自主编写。

## 3. 接口与数据契约

在 `packages/skills/src/plugin/`（或扩展根目录）定义复合插件契约：

```typescript
export interface ClaudePluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  skills?: string[]; // 相对路径列表
  hooks?: {
    preToolUse?: string[];  // 钩子规则或脚本指针
    postToolUse?: string[];
  };
}

export interface DiscoveredPlugin {
  id: string;
  manifest: ClaudePluginManifest;
  rootDir: string;
  skills: SkillIndexEntry[];
  isTrusted: boolean;
}

/** 扩展插件与技能扫描根：支持 .vessel, .claude, .claw, plugins/ 目录 */
export function discoverClaudePlugins(workspaceRoot: string): DiscoveredPlugin[];
```

同时，将 Claude 插件声明的 Hook 映射为 Vessel 的 `PolicyRule`（声明式拦截规则），
坚决禁止随意启动无沙箱保护的子进程执行任意脚本。

## 4. 确定性完成门禁 (DoD)

- [x] **单元测试**：新建 `packages/skills/src/plugin/pluginLoader.test.ts`：
  - 测试探测一个标准的包含 `plugin.json` 与多个子技能目录的测试夹具，成功识别出插件及内嵌的所有 Skills。
  - 测试同时支持 `.claude/` 和 `.claw/` 路径扫描。
  - 覆盖默认 `hooks/hooks.json` 与清单相对引用；非法/越界/超大 Hook 文件会 fail closed，外部命令仅作为数据保留。
  - 覆盖安全边界：对于未受信任标记的插件（触发 §18 判定），标记 `isTrusted: false`，不开放直接执行。
- [x] **生产装配集成**：`composeHarness` 在工作区边界内发现 `.claude/`、`.claw/` 与清单插件，将 `PreToolUse` 声明并入 Policy Engine；插件技能进入索引、搜索与按需加载，加载时再次校验路径和 §18 信任。
- [x] **禁止脚本执行**：应用层集成测试验证 Hook 命令只保留为元数据、匹配的前置工具调用 fail-closed，未产生脚本副作用；没有对应 `PolicyRule` 生命周期的 Hook 保留为 `enforced: false` 声明。
- [x] **构建检查**：
  - `npx tsc -b tsconfig.json` 退出码必须为 0。
  - `npm run typecheck:tests` 退出码必须为 0。
- [x] **全量回归**：
  - `npm run test:all` 双 root 全部通过。

## 5. 架构红线与禁做项 (Out of Scope & Invariants)

- **坚守安全第一**：严禁在未经过 Policy Engine 授权的情况下，直接用 `child_process.exec` 执行插件目录下的脚本。
- **薄核原则**：插件装配与生命周期管理仅存在于 `packages/skills` 与 `packages/policy`，严禁污染 `packages/core`。
- **删除纪律**：测试中生成的临时插件夹具若需清理，必须符合只删 `os.tmpdir()` 下临时目录的例外，其余操作一律进回收站。

## 6. 架构提示与避坑点 (GAN 对抗审计沉淀)

- 很多社区插件在 `plugin.json` 中使用非标准字段名（例如用 `skill_paths` 代替 `skills`），解析时应使用防腐函数做好健壮的备选回退。
- 插件技能的 ID 命名应采用 `<plugin-name>:<skill-name>` 命名空间隔离，防止不同插件之间的同名技能相互覆盖。
