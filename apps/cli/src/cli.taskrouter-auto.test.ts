import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { composeHarness } from '@vessel/application';
import { MockProvider } from '@vessel/llm';

/**
 * 056 compose seam —— CLI/web 后端的组装根。TaskRouter 默认 Auto：
 * taskRouter 配置 + 触发条件（taskPrompt 或显式 fast/pro）→ AutoTaskRouter 解析，
 * 实际选择（mode/roles/tier/model/hints）经 ComposedHarness.route 暴露给 UI，
 * pin 在组装时锁定本 session 的选择（不再自动重判）。
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');

const tierModel = {
  pro: { providerId: 'pro', model: 'pro-model' },
  fast: { providerId: 'fast', model: 'fast-model' },
  mini: { providerId: 'fast', model: 'mini-model' },
};

function providers() {
  const mk = (id: string, text: string) =>
    new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text } }], { model: `${id}-model` });
  return { pro: mk('pro', 'AUTO-ROUTED-PRO'), fast: mk('fast', 'AUTO-ROUTED-FAST'), review: mk('review', 'AUTO-ROUTED-REVIEW') };
}

describe('056 TaskRouter Auto — compose seam (apps/cli 组装根)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-056-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('Auto 默认：implementation → medium(Developer+Reviewer) → pro-model，route 暴露实际选择', async () => {
    const h = await composeHarness({
      workspaceRoot: dir,
      provider: providers().fast,
      model: 'fallback',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      taskRouter: { providers: providers(), tierModel, taskPrompt: '请实现一个用户登录功能' },
    });
    expect(h.route?.mode).toBe('auto');
    expect(h.routedCategory).toBe('implementation');
    expect(h.route?.complexity).toBe('medium');
    expect(h.route?.roles).toEqual(['developer', 'reviewer']);
    expect(h.route?.primary.model).toBe('pro-model');
    expect(h.taskRouter?.isPinned()).toBe(false);
    const result = await h.loop.runTurn('继续实现');
    expect(result.finalText).toContain('AUTO-ROUTED-PRO'); // session 主 agent 用 primary provider/model
    await h.close();
  });

  it('显式 Pro（无 taskPrompt）绕过 classify 直达 pro tier', async () => {
    const h = await composeHarness({
      workspaceRoot: dir,
      provider: providers().fast,
      model: 'fallback',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      taskRouter: { providers: providers(), tierModel, mode: 'pro' },
    });
    expect(h.route?.mode).toBe('pro');
    expect(h.route?.category).toBe('unknown'); // 未分类 —— 绕过 classify
    expect(h.route?.complexity).toBeUndefined();
    expect(h.route?.roles).toEqual(['developer']);
    expect(h.route?.primary.model).toBe('pro-model');
    const result = await h.loop.runTurn('随便什么任务都走 Pro');
    expect(result.finalText).toContain('AUTO-ROUTED-PRO');
    await h.close();
  });

  it('显式 Fast 绕过 classify 直达 fast tier', async () => {
    const h = await composeHarness({
      workspaceRoot: dir,
      provider: providers().pro,
      model: 'fallback',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      taskRouter: { providers: providers(), tierModel, mode: 'fast' },
    });
    expect(h.route?.primary.tier).toBe('fast');
    expect(h.route?.primary.model).toBe('fast-model');
    const result = await h.loop.runTurn('x');
    expect(result.finalText).toContain('AUTO-ROUTED-FAST');
    await h.close();
  });

  it('Pin for this session：compose pin=true 锁定解析（route.pinned + router.isPinned）', async () => {
    const h = await composeHarness({
      workspaceRoot: dir,
      provider: providers().fast,
      model: 'fallback',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      taskRouter: { providers: providers(), tierModel, taskPrompt: '请实现一个用户登录功能', pin: true },
    });
    expect(h.taskRouter?.isPinned()).toBe(true);
    expect(h.route?.pinned).toBe(true);
    expect(h.route?.mode).toBe('auto');
    // pin 后同一 router 再解析不同任务 → 仍返回锁定选择（不再自动重判）
    const again = h.taskRouter!.resolve({ task: '搜索 needle 在哪些文件被调用' });
    expect(again.pinned).toBe(true);
    expect(again.roles).toEqual(h.route?.roles);
    expect(again.primary.model).toBe('pro-model');
    await h.close();
  });

  it('review 档未配置 → hints 回落默认档；bindings 扩展可绑定 review 档（无 hints）', async () => {
    // 未扩展：tierModel 只有 pro/fast/mini → reviewer(review 档) 回落 pro + hints
    const h1 = await composeHarness({
      workspaceRoot: dir,
      provider: providers().fast,
      model: 'fallback',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      taskRouter: { providers: providers(), tierModel, taskPrompt: '请实现一个用户登录功能' },
    });
    expect(h1.route?.hints.length).toBeGreaterThan(0);
    expect(h1.route?.roleModels[1]).toMatchObject({ role: 'reviewer', configured: false, model: 'pro-model' });
    await h1.close();

    // 扩展：review 档绑定专属评审 provider/model → 无回落、无 hints
    const h2 = await composeHarness({
      workspaceRoot: dir,
      provider: providers().fast,
      model: 'fallback',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      taskRouter: {
        providers: providers(),
        tierModel,
        bindings: { review: { providerId: 'review', model: 'review-model' } },
        taskPrompt: '请实现一个用户登录功能',
      },
    });
    expect(h2.route?.hints.length).toBe(0);
    expect(h2.route?.roleModels[1]).toMatchObject({ role: 'reviewer', tier: 'review', model: 'review-model', configured: true });
    await h2.close();
  });
});
