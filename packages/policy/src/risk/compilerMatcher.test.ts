import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compilePolicyYaml } from './Compiler.js';
import { PolicyEngine } from '../engine/Engine.js';
import type { PolicyRule } from '@vessel/shared';

// Shell/Bash scoped-rule matchers (POLICY-SPEC §3.3). `parseMatcher` is
// module-private, so the predicates are exercised *indirectly* through the
// public compile entry (`compilePolicyYaml`) — no public surface was widened
// for these tests. Two documented shapes:
//   - without `*`: literal prefix match (legacy `startsWith`, unchanged);
//   - with `*`: anchored glob (`*` → `.*`, everything else escaped literally).
const MATCHER_POLICY = `
policy:
  version: "0.1"
  profile: workspace-write
  approval: never
  shell:
    scoped_rules:
      - id: shell-force-push
        match: "Shell(git push --force*)"
        action: deny
        reason: "force push rewrites shared history — denied by default"
      - id: shell-git-status
        match: "Shell(git status)"
        action: allow
        reason: "readonly prefix without glob — legacy prefix semantics"
      - id: shell-mid-wildcard
        match: "Shell(git * --force*)"
        action: deny
        reason: "wildcard in the middle of the command matcher"
      - id: shell-cleanup-glob
        match: "Bash(rm -rf ./node_modules*)"
        action: deny
        reason: "glob form of the workspace cleanup rule"
      - id: shell-cleanup-recursive
        match: "Bash(rm -rf ./node_modules)"
        action: deny
        reason: "existing default-config matcher (no glob)"
  tools:
    rules:
      - id: tool-read-secrets
        match: 'Read(path=glob "**/.env")'
        action: deny
        reason: "credentials"
`;

function compiledRule(id: string, yamlText: string = MATCHER_POLICY): PolicyRule {
  const found = compilePolicyYaml(yamlText).rules.find((r) => r.id === id);
  if (!found) throw new Error(`rule not compiled: ${id}`);
  return found;
}

const shellCall = (command: string) => ({ toolName: 'Shell', arguments: { command } });

/**
 * C-3 修复的判别策略：**只**启用内置 `git.force_push`（不含任何 `Shell(...)`
 * scoped 规则），使下面的命中/不命中只能来自内置 `git:force-push` **专用谓词**，
 * 与通用 `Shell(...)` matcher 的锚定语义彻底解耦（后者按本卡要求保持不变）。
 */
const GIT_FORCE_PUSH_POLICY = `
policy:
  version: "0.1"
  profile: workspace-write
  approval: never
  git:
    force_push: deny
`;

const gitForcePushRule = (yamlText: string = GIT_FORCE_PUSH_POLICY): PolicyRule =>
  compiledRule('git:force-push', yamlText);

/** 仓库自带系统策略（只读，不在本卡改动范围内） */
const DEFAULT_POLICY_PATH = fileURLToPath(new URL('../../../../configs/policy.default.yaml', import.meta.url));

describe('policy/risk — Compiler `Shell(...)`/`Bash(...)` matcher: `*` glob support', () => {
  it('`Shell(git push --force*)` 命中真实 force push（本次修复的核心判别点）', () => {
    const rule = compiledRule('shell-force-push');
    expect(rule.match(shellCall('git push --force origin main'))).toBe(true);
    expect(rule.match(shellCall('git push --force'))).toBe(true);
    expect(rule.match(shellCall('git push --force-with-lease origin main'))).toBe(true);
    // 命令尾随空白由原有的 trim() 归一化，语义不变
    expect(rule.match(shellCall('  git push --force origin main  '))).toBe(true);
  });

  it('`Shell(git push --force*)` 不过度拦截：普通 push 与其他命令为 false', () => {
    const rule = compiledRule('shell-force-push');
    expect(rule.match(shellCall('git push origin main'))).toBe(false);
    expect(rule.match(shellCall('git commit -m x'))).toBe(false);
    expect(rule.match(shellCall('git commit -m "push --force"'))).toBe(false);
    expect(rule.match(shellCall('git push origin --force-with-lease-feature'))).toBe(false);
  });

  it('带 `*` 的 matcher 整体锚定：前缀多出其他文本不命中（也不是正则）', () => {
    const rule = compiledRule('shell-force-push');
    // C-3：修复前这里断言「`sudo git push --force origin main` **不**命中 = 正确行为」，
    // 锁的正是缺陷本身。通用 matcher 的锚定语义（策略作者可预期）按本卡要求不变，
    // 因此 `sudo …` 的拦截**不再由它兜底**，而是移到内置 `git:force-push` 专用谓词
    // —— 翻转后的判别断言见下方「内置 git:force-push 专用谓词」用例组 C-3 ①。
    expect(rule.match(shellCall('echo git push --force origin main'))).toBe(false);
    // 工具面不变：谓词仍只认 Shell 工具
    expect(rule.match({ toolName: 'Read', arguments: { command: 'git push --force origin main' } })).toBe(false);
  });

  it('中段通配 `Shell(git * --force*)` 命中带 --force 的命令，不命中其他 git 命令', () => {
    const rule = compiledRule('shell-mid-wildcard');
    expect(rule.match(shellCall('git push --force origin main'))).toBe(true);
    expect(rule.match(shellCall('git push --force-with-lease origin main'))).toBe(true);
    expect(rule.match(shellCall('git push origin main'))).toBe(false);
    expect(rule.match(shellCall('git commit -m x'))).toBe(false);
  });

  it('含 `*` 时正则元字符逐字转义：`./` 里的 `.` 不是任意字符', () => {
    const rule = compiledRule('shell-cleanup-glob');
    expect(rule.match(shellCall('rm -rf ./node_modules'))).toBe(true);
    expect(rule.match(shellCall('rm -rf ./node_modules/foo'))).toBe(true);
    // 若 `.` 被当成正则通配（`^rm -rf ./node_modules.*$` 未转义）这条会误命中
    expect(rule.match(shellCall('rm -rf X/node_modules/foo'))).toBe(false);
    expect(rule.match(shellCall('rm -rf ./dist'))).toBe(false);
  });

  it('不含 `*` 的 matcher 保持原有 startsWith 前缀语义（回归护栏，刻意不改全等）', () => {
    const rule = compiledRule('shell-git-status');
    expect(rule.match(shellCall('git status'))).toBe(true);
    expect(rule.match(shellCall('git status --short'))).toBe(true);
    // 前缀关系 ⇒ 既有语义即为 true；本卡不动它（未顺手改成全等）
    expect(rule.match(shellCall('git statusx'))).toBe(true);
    expect(rule.match(shellCall('git statu'))).toBe(false);
    expect(rule.match(shellCall('git commit -m x'))).toBe(false);
  });

  it('不含 `*` 的 `Bash(rm -rf ./node_modules)` 对子路径命中，既有行为不变', () => {
    const rule = compiledRule('shell-cleanup-recursive');
    expect(rule.match(shellCall('rm -rf ./node_modules/foo'))).toBe(true);
    expect(rule.match(shellCall('rm -rf ./node_modules'))).toBe(true);
    // 既有的字面前缀语义（无 `./` 即不命中）——本卡不改变，如实断言
    expect(rule.match(shellCall('rm -rf node_modules'))).toBe(false);
  });

  it('`Write(path=...)` 类路径 matcher 已走 globMatch，本次无需改动（对照用例）', () => {
    const rule = compiledRule('tool-read-secrets');
    expect(rule.match({ toolName: 'Read', arguments: { path: 'a/.env' } })).toBe(true);
    expect(rule.match({ toolName: 'Read', arguments: { path: '.env' } })).toBe(true);
    expect(rule.match({ toolName: 'Read', arguments: { path: 'x.env' } })).toBe(false);
  });
});

describe('policy/risk — force-push 拦截端到端（系统默认策略真正生效）', () => {
  it('configs/policy.default.yaml 的 shell-force-push 现在真的命中 force push', () => {
    const yamlText = fs.readFileSync(DEFAULT_POLICY_PATH, 'utf8');
    const rule = compiledRule('shell-force-push', yamlText);
    expect(rule.match(shellCall('git push --force origin main'))).toBe(true);
    expect(rule.match(shellCall('git push --force-with-lease origin main'))).toBe(true);
    expect(rule.match(shellCall('git push origin main'))).toBe(false);
  });

  it('PolicyEngine 的 force-push 裁决来自 shell-force-push 规则（ruleRef 可判别）', async () => {
    // 与 default 配置同形的 scoped rule；此处刻意不含 git.force_push，
    // 使裁决只能由 scoped matcher 产生（修复前 ruleRef 会是 policy-never）。
    const engine = new PolicyEngine(compilePolicyYaml(MATCHER_POLICY));
    const denied = await engine.decide(shellCall('git push --force origin main'));
    expect(denied.action).toBe('deny');
    expect(denied.ruleRef).toBe('shell-force-push');

    const normal = await engine.decide(shellCall('git push origin main'));
    expect(normal.ruleRef).not.toBe('shell-force-push');
  });
});

describe('policy/risk — 内置 `git:force-push` 专用谓词：位置无关 + 包装剥离（C-3 修复）', () => {
  it('C-3 ①：`sudo … git push --force` 必须命中（修复前被断言为「不命中」，那条锁的是缺陷）', () => {
    const rule = gitForcePushRule();
    expect(rule.match(shellCall('sudo git push --force origin main'))).toBe(true);
    expect(rule.match(shellCall('sudo -E git push --force origin main'))).toBe(true);
    expect(rule.match(shellCall('sudo -u root git push -f origin main'))).toBe(true);
    expect(rule.match(shellCall('sudo sh -c "git push --force"'))).toBe(true);
  });

  it('C-3 ②：refspec 尾置 / `-f` / `--force=…` / `git -C` 都必须命中', () => {
    const rule = gitForcePushRule();
    expect(rule.match(shellCall('git push origin main --force'))).toBe(true);
    expect(rule.match(shellCall('git push origin main -f'))).toBe(true);
    expect(rule.match(shellCall('git push --force=true origin main'))).toBe(true); // 卡片要求含 `--force=…`
    expect(rule.match(shellCall('git push --force-with-lease origin main'))).toBe(true);
    expect(rule.match(shellCall('git push --force-with-lease=main:main origin main'))).toBe(true);
    expect(rule.match(shellCall('git -C /repo push --force'))).toBe(true);
    expect(rule.match(shellCall('git -C /repo --no-pager push --force'))).toBe(true);
    // 既有前缀形（回归护栏：修复前也命中，不能改坏）
    expect(rule.match(shellCall('git push --force'))).toBe(true);
    expect(rule.match(shellCall('git push --force origin main'))).toBe(true);
  });

  it('C-3 ③：`sh -c "…"` / `env VAR=x` / 多层包装剥离后仍命中', () => {
    const rule = gitForcePushRule();
    expect(rule.match(shellCall('sh -c "git push --force"'))).toBe(true);
    expect(rule.match(shellCall('sh -c \'git push --force\''))).toBe(true);
    expect(rule.match(shellCall("bash -lc 'git -C /repo push --force'"))).toBe(true);
    expect(rule.match(shellCall('env GIT_SSH_COMMAND=ssh git push --force'))).toBe(true);
    expect(rule.match(shellCall('env -i git push origin main --force'))).toBe(true);
    expect(rule.match(shellCall('nohup git push --force origin main'))).toBe(true);
  });

  it('C-3 ④：分段判定 —— 管道/`;`/`&&` 中的 force push 段命中，正常段不误判', () => {
    const rule = gitForcePushRule();
    expect(rule.match(shellCall('git fetch && git push --force origin main'))).toBe(true);
    expect(rule.match(shellCall('echo start; git push origin main --force'))).toBe(true);
    expect(rule.match(shellCall('git push --force | cat'))).toBe(true);
    expect(rule.match(shellCall('git push origin main | tee /tmp/log'))).toBe(false);
    expect(rule.match(shellCall('git fetch && git status'))).toBe(false);
  });

  it('C-3 ⑤：负对照 —— 不过度拦截', () => {
    const rule = gitForcePushRule();
    expect(rule.match(shellCall('git push origin main'))).toBe(false);
    expect(rule.match(shellCall('git commit -m "x"'))).toBe(false);
    // 引号里的 "push --force" 只是提交信息（子命令是 commit）
    expect(rule.match(shellCall('git commit -m "push --force"'))).toBe(false);
    // `--force-like-branch` / `--force-with-lease-feature` **不是** force 选项。
    // 本谓词按 token 精确匹配（不是 `\b`）：旧谓词 `…(--force)\b` 会在 `e` 与 `-`
    // 之间看到词边界而误命中，故这两条修复前是红的（修复前为过度拦截）。
    expect(rule.match(shellCall('git push --force-like-branch'))).toBe(false);
    expect(rule.match(shellCall('git push origin --force-with-lease-feature'))).toBe(false);
    // `--follow-tags` 是长选项，不得被短选项簇规则误判
    expect(rule.match(shellCall('git push --follow-tags origin main'))).toBe(false);
    // 分支名里含 force
    expect(rule.match(shellCall('git push origin feature/force'))).toBe(false);
    // 被打印的文本不是被执行的命令
    expect(rule.match(shellCall('echo "git push --force"'))).toBe(false);
    expect(rule.match(shellCall('git log --grep push --oneline'))).toBe(false);
  });

  it('C-3 ⑥：端到端 —— `danger-full-access` 放宽会话下 deny 规则是唯一防线', async () => {
    const yamlText = `
policy:
  version: "0.1"
  profile: danger-full-access
  approval: ask
  git:
    force_push: deny
`;
    const engine = new PolicyEngine(compilePolicyYaml(yamlText));
    for (const cmd of [
      'git push origin main --force',
      'sudo git push --force origin main',
      'sh -c "git push --force"',
      'git -C /repo push --force',
    ]) {
      const verdict = await engine.decide(shellCall(cmd));
      // 带上 cmd 一起断言，失败时的 diff 直接指出是哪条绕过形
      expect({ cmd, action: verdict.action, ruleRef: verdict.ruleRef }).toEqual({
        cmd,
        action: 'deny',
        ruleRef: 'git:force-push',
      });
    }
    // 同会话里普通 push 仍放行（不过度拦截）
    const normal = await engine.decide(shellCall('git push origin main'));
    expect(normal.action).toBe('allow');
  });

  it('C-3 ⑦：`+<refspec>` 强制推送必须命中（修复前 fail-open；`git push origin +main` 是标准惯用写法）', () => {
    const rule = gitForcePushRule();
    expect(rule.match(shellCall('git push origin +main'))).toBe(true);
    expect(rule.match(shellCall('git push origin +HEAD:main'))).toBe(true);
    expect(rule.match(shellCall('git push origin +refs/heads/x:refs/heads/y'))).toBe(true);
    expect(rule.match(shellCall('git push +main'))).toBe(true);
    expect(rule.match(shellCall('git -C /repo push origin +main'))).toBe(true);
    expect(rule.match(shellCall('git push --force origin +main'))).toBe(true);
    // 引号由 tokenizer 剥掉：`"+main"` 与 `+main` 是**同一个参数**（shell 引号不改变
    // 参数内容），语义上确为强制推送 ⇒ 如实断言命中。
    expect(rule.match(shellCall('git push origin "+main"'))).toBe(true);
  });

  it('C-3 ⑧：`+` 只在 refspec 位置才算 force —— 负对照（不得因任意 `+` 误判）', () => {
    const rule = gitForcePushRule();
    expect(rule.match(shellCall('git push origin main'))).toBe(false); // 无 `+`
    expect(rule.match(shellCall('git push origin feature+fix'))).toBe(false); // `+` 不在 token 开头
    expect(rule.match(shellCall('git push origin a+b'))).toBe(false);
    expect(rule.match(shellCall('git push origin main && echo a+b'))).toBe(false); // 落在另一段
    expect(rule.match(shellCall('git push origin main; echo +done'))).toBe(false);
    expect(rule.match(shellCall('git commit -m "+main"'))).toBe(false);
    // `-o <opt>` 的值不是 refspec（取独立值的选项连它的值一起跳过）
    expect(rule.match(shellCall('git push -o +ci.skip origin main'))).toBe(false);
    expect(rule.match(shellCall('git push --push-option=+ci.skip origin main'))).toBe(false);
  });

  it('C-3 ⑨：`env -S` / `--split-string` 脚本模式必须命中（修复前 fail-open）', () => {
    const rule = gitForcePushRule();
    expect(rule.match(shellCall('env -S "git push --force" origin main'))).toBe(true);
    expect(rule.match(shellCall('env -S "git push --force"'))).toBe(true);
    expect(rule.match(shellCall('env --split-string="git push --force" origin main'))).toBe(true);
    expect(rule.match(shellCall('env -S "git push origin +main"'))).toBe(true);
    expect(rule.match(shellCall('env FOO=bar -S "git push --force"'))).toBe(true);
    // 负对照：`-S` 的脚本里没有 force push
    expect(rule.match(shellCall('env -S "echo hi"'))).toBe(false);
    expect(rule.match(shellCall('env -S "git push origin main"'))).toBe(false);
    // `-i` 仍是无值开关，不得被当成 split-string 模式
    expect(rule.match(shellCall('env -i git status'))).toBe(false);
  });

  it('C-3 ⑩：`eval "<string>"` 与 `sh -c` 同类，必须命中（修复前 fail-open）', () => {
    const rule = gitForcePushRule();
    expect(rule.match(shellCall('eval "git push --force origin main"'))).toBe(true);
    expect(rule.match(shellCall("eval 'git push --force'"))).toBe(true);
    // eval 把参数用空格拼接后再执行 ⇒ 不加引号同义
    expect(rule.match(shellCall('eval git push --force origin main'))).toBe(true);
    expect(rule.match(shellCall('sh -c \'eval "git push --force"\''))).toBe(true);
    // 边界：只有**段首**的 `eval` 才按命令处理；出现在参数位一律不触发
    expect(rule.match(shellCall('echo eval "git push --force"'))).toBe(false);
    expect(rule.match(shellCall('git commit -m "eval git push --force"'))).toBe(false);
    expect(rule.match(shellCall('eval "echo hi"'))).toBe(false);
    expect(rule.match(shellCall('git push origin main && eval "echo hi"'))).toBe(false);
  });

  it('C-3 ⑪：R-1 保守兜底 —— 未跟随的间接执行层（`xargs`/`find -exec`）含 git+push 签名即命中', () => {
    const rule = gitForcePushRule();
    expect(rule.match(shellCall('xargs git push --force'))).toBe(true);
    expect(rule.match(shellCall('git fetch | xargs git push --force'))).toBe(true);
    expect(rule.match(shellCall('xargs -n1 git push --force origin main'))).toBe(true);
    expect(rule.match(shellCall('find /repo -name x -exec git push --force {} \\;'))).toBe(true);
    // 硬边界：不含 git+push 签名的段不得因兜底被误拦
    expect(rule.match(shellCall('xargs ls'))).toBe(false);
    expect(rule.match(shellCall('xargs -n1 echo hi'))).toBe(false);
    // 已跟随的包装器仍走精确判定：普通 push 不因「包了一层」被拦
    expect(rule.match(shellCall('sudo git push origin main'))).toBe(false);
  });

  it('C-3 ⑫：R-1 保守兜底 —— 解释器执行脚本文件（内容不可知）判命中，`-c` 形仍精确判定', () => {
    const rule = gitForcePushRule();
    expect(rule.match(shellCall('sh script.sh'))).toBe(true);
    expect(rule.match(shellCall('bash -e build.sh'))).toBe(true);
    expect(rule.match(shellCall('sh deploy.sh --force'))).toBe(true);
    // 负对照：`-c` 形可完整解析 ⇒ 精确判定为不命中
    expect(rule.match(shellCall('sh -c "echo hi"'))).toBe(false);
    expect(rule.match(shellCall('bash -lc "git status"'))).toBe(false);
    // 裸解释器 / 纯选项调用（没有脚本文件参数）不命中
    expect(rule.match(shellCall('sh'))).toBe(false);
    expect(rule.match(shellCall('bash --version'))).toBe(false);
  });

  it('C-3 ⑬：R-1 保守兜底 —— 包装层级超过跟随上限判命中，无签名深包装仍不命中', () => {
    const rule = gitForcePushRule();
    // MAX_WRAPPER_DEPTH = 4：≥5 层包装后仍展开不完 ⇒ 未解析 ⇒ fail-closed
    expect(rule.match(shellCall('sudo sudo sudo sudo sudo sudo git push origin main'))).toBe(true);
    expect(rule.match(shellCall('sudo sudo sudo sudo sudo sh -c "git push origin main"'))).toBe(true);
    // 4 层以内仍能精确展开：普通 push 不命中（不得因「层数多」误拦）
    expect(rule.match(shellCall('sudo sudo sudo sudo git push origin main'))).toBe(false);
    // 硬边界：没有 git+push 签名的深包装不被兜底波及
    expect(rule.match(shellCall('sudo sudo sudo sudo sudo sudo ls'))).toBe(false);
  });

  it('C-3 ⑭：端到端 —— `danger-full-access` 下新增绕过形同样落到 `git:force-push`（deny）', async () => {
    const yamlText = `
policy:
  version: "0.1"
  profile: danger-full-access
  approval: ask
  git:
    force_push: deny
`;
    const engine = new PolicyEngine(compilePolicyYaml(yamlText));
    for (const cmd of [
      'git push origin +main',
      'git push origin +HEAD:main',
      'env -S "git push --force" origin main',
      'eval "git push --force origin main"',
      'xargs git push --force',
      'sh script.sh',
    ]) {
      const verdict = await engine.decide(shellCall(cmd));
      expect({ cmd, action: verdict.action, ruleRef: verdict.ruleRef }).toEqual({
        cmd,
        action: 'deny',
        ruleRef: 'git:force-push',
      });
    }
    // 同会话里不得因兜底把无关命令拦掉
    for (const cmd of ['git push origin main', 'git push origin a+b', 'env -S "echo hi"', 'xargs ls']) {
      const verdict = await engine.decide(shellCall(cmd));
      expect({ cmd, action: verdict.action }).toEqual({ cmd, action: 'allow' });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R-1 复评（EVALUATION-REPORT-22）新增：续行拼接 ① / git alias 走私 ②。
  // 两条在修复前都是 **fail-open**（下表标注「修复前必红」的断言即复评实测漏网形）。
  // ───────────────────────────────────────────────────────────────────────────

  it('R-1 ①a：cmd 续行（`^` + 换行）必须命中 —— 修复前 fail-open（复评实测漏网）', () => {
    const rule = gitForcePushRule();
    // `packages/tools/src/shell/shellTool.ts:44/70`：Windows 走 cmd.exe，`^` + 换行是**续行**，
    // 真实执行的是 `git push --force origin main`。修复前 splitShellSegments 把 `^` 当普通字符、
    // 按 `\r\n` / `\n` 切段 ⇒ 两段都不含 force ⇒ allow。
    expect(rule.match(shellCall('git push ^\r\n--force origin main'))).toBe(true); // 修复前必红
    expect(rule.match(shellCall('git push ^\n--force origin main'))).toBe(true); // 修复前必红
    expect(rule.match(shellCall('git push ^\r\n-f origin main'))).toBe(true); // 修复前必红
    expect(rule.match(shellCall('git -C /repo push ^\r\n--force-with-lease origin main'))).toBe(true);
    // 续行跨行 + `+<refspec>`（强制形状落在第二行）
    expect(rule.match(shellCall('git push origin ^\r\n+main'))).toBe(true); // 修复前必红
  });

  it('R-1 ①b：POSIX 续行（`\\` + 换行）必须命中 —— 修复前 fail-open（复评实测漏网）', () => {
    const rule = gitForcePushRule();
    // POSIX sh：`\` + 换行是续行。修复前 tokenizer 把 `\` + 换行当转义吞掉 ⇒ `--force` 变
    // 第二段的段首 token，`git push` 段里没有 force ⇒ allow。
    expect(rule.match(shellCall('git push \\\n--force origin main'))).toBe(true); // 修复前必红
    expect(rule.match(shellCall('git push \\\r\n--force origin main'))).toBe(true); // 修复前必红
    expect(rule.match(shellCall('git push \\\norigin +main'))).toBe(true); // 修复前必红
    expect(rule.match(shellCall('git push origin main \\\n--force'))).toBe(true); // 修复前必红
    // 续行与包装剥离组合：拼接后才是完整的 `sudo git push --force`
    expect(rule.match(shellCall('sudo git \\\npush --force'))).toBe(true); // 修复前必红
    // 引号内的续行：`sh -c "<script>"` 的**脚本参数**在真实 shell 里同样拼接 ⇒ 递归判定命中
    expect(rule.match(shellCall('sh -c "git push \\\n--force"'))).toBe(true); // 修复前必红
    expect(rule.match(shellCall("bash -lc 'git push \\\n--force'"))).toBe(true); // 修复前必红
  });

  it('R-1 ①c：续行负对照 —— 行中 `^` 不被吞、无续行符的真换行仍分段、偶数反斜杠不是续行', () => {
    const rule = gitForcePushRule();
    // `^` 只在**行尾**（后随换行）才是 cmd 续行；行中的 `^` 是转义符，原样保留
    expect(rule.match(shellCall('echo a^b'))).toBe(false);
    expect(rule.match(shellCall('echo "a^b"'))).toBe(false);
    expect(rule.match(shellCall('git log --oneline -1 ^main'))).toBe(false);
    // 多行脚本（**没有**续行符的真换行）仍是两条独立命令 ⇒ 不得因合并而误判
    expect(rule.match(shellCall('echo a\ngit status'))).toBe(false);
    expect(rule.match(shellCall('git status\r\ngit log --oneline'))).toBe(false);
    // 偶数个反斜杠 = 字面反斜杠 + **真换行**（不是续行）：两段都不含 force
    expect(rule.match(shellCall('echo a\\\\\ngit status'))).toBe(false);
    // 非续行语境里的 `\` 逐字保留（Windows 路径）
    expect(rule.match(shellCall('git -C C:\\repo push origin main'))).toBe(false);
    expect(rule.match(shellCall('find . -name x -exec rm {} \\;'))).toBe(false);
  });

  it('R-1 ①d（已知边界，如实记录）：整条命令被引号粘成**一个词**的续行形判定为 allow', () => {
    const rule = gitForcePushRule();
    // `"git push \` + 换行 + `--force"` 拼接后是 `"git push --force"` —— 在真实 shell 里这是
    // **一个带空格的单词**（命令名），shell 会去找名为 `git push --force` 的可执行文件
    // （command not found），**不是** git 调用，因此按语义如实判定 allow，而不是为了凑绿
    // 硬判 deny。该形已列入 `detectForcePush` JSDoc 的「已知 fail-open 边界」（不假装覆盖）。
    expect(rule.match(shellCall('"git push \\\n--force"'))).toBe(false);
  });

  it('R-1 ②：`git -c alias.…` 别名走私 fail-closed —— 修复前 fail-open（复评实测漏网）', () => {
    const rule = gitForcePushRule();
    // 展开文本藏在 `-c` 的**值**里，子命令 token 只是别名名 `p` ⇒ 段内精确判定看不到 push
    expect(rule.match(shellCall("git -c alias.p='push --force' p"))).toBe(true); // 修复前必红
    expect(rule.match(shellCall('git -c "alias.p=push --force" p'))).toBe(true); // 修复前必红
    expect(rule.match(shellCall("git -c alias.p='!git push --force' p"))).toBe(true); // 修复前必红
    expect(rule.match(shellCall('git --config=alias.p=push p'))).toBe(true); // 修复前必红
    expect(rule.match(shellCall('git --config-env=alias.p=EVIL p'))).toBe(true); // 修复前必红
    expect(rule.match(shellCall('git -calias.p=push p'))).toBe(true); // `-c` 紧贴值写法
    expect(rule.match(shellCall('git -c alias.P=push p'))).toBe(true); // config 键不分大小写
    // 已知代价（如实记录）：`-c` 里定义**任何**别名都 fail-closed，与是否 force 无关
    expect(rule.match(shellCall('git -c alias.st=status st'))).toBe(true);
  });

  it('R-1 ②：非别名 `-c` 配置不得被误判 —— 负对照（`core.pager` / `user.email` / `-C`）', () => {
    const rule = gitForcePushRule();
    expect(rule.match(shellCall('git -c core.pager=cat status'))).toBe(false);
    expect(rule.match(shellCall('git -c user.email=a@b push origin main'))).toBe(false);
    expect(rule.match(shellCall('git -c http.proxy= push origin main'))).toBe(false);
    expect(rule.match(shellCall('git -C /repo -c core.pager=cat push origin main'))).toBe(false);
    expect(rule.match(shellCall('git --config=core.pager=cat status'))).toBe(false);
    expect(rule.match(shellCall('git --config-env=core.pager=PAGER status'))).toBe(false);
    // 别名判定只落在 **git 全局选项位**；子命令自己的 `-c`（`git commit -c <commit>`）不受影响
    expect(rule.match(shellCall('git commit -c alias.p commit'))).toBe(false);
  });

  it('R-1 ① ②：端到端 —— 续行 / alias 走私在放宽会话下同样落到 `git:force-push`（deny）', async () => {
    const yamlText = `
policy:
  version: "0.1"
  profile: danger-full-access
  approval: ask
  git:
    force_push: deny
`;
    const engine = new PolicyEngine(compilePolicyYaml(yamlText));
    for (const cmd of [
      'git push ^\r\n--force origin main',
      'git push \\\n--force origin main',
      'sh -c "git push \\\n--force"',
      "git -c alias.p='push --force' p",
      'git --config-env=alias.p=EVIL p',
    ]) {
      const verdict = await engine.decide(shellCall(cmd));
      expect({ cmd, action: verdict.action, ruleRef: verdict.ruleRef }).toEqual({
        cmd,
        action: 'deny',
        ruleRef: 'git:force-push',
      });
    }
    // 同会话里不得因新增判定把无关命令 / 正常配置拦掉
    for (const cmd of [
      'git push origin main',
      'echo a^b',
      'git -c core.pager=cat status',
      'echo a\ngit status',
    ]) {
      const verdict = await engine.decide(shellCall(cmd));
      expect({ cmd, action: verdict.action }).toEqual({ cmd, action: 'allow' });
    }
  });
});
