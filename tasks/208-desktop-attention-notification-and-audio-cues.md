# 208 — 注意力提醒系统、浏览器通知与任务完成音频提示 (Attention System & Notifications)

- 编号：208
- 优先级：P2
- 关联模块：`apps/web`, `packages/shared`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已验证（Web 251；类型与安全构建 exit 0）
- 创建日期：2026-10-10

---

## 1. 目标与意图

在长链路自主编程任务中，用户往往会切出窗口处理其他事务。如果缺乏有效的“注意力唤醒机制（Attention Mechanism）”，会导致模型挂起等待审批数十分钟而无人响应，严重拖慢交付节奏。

本任务旨在建立 **Vessel 多端注意力提醒与通知系统**：
1. **就地与离焦双态唤醒**：
   - 监听三大关键注意力事件：
     - `decision_needed`：Policy 拦截或权限待审批；
     - `task_completed`：长耗时任务执行完毕；
     - `breaker_tripped`：无进展熔断器跳闸或异常终止；
2. **轻量桌面通知与标头指示**：
   - 当页面处于后台（`document.hidden === true`）时，通过 HTML5 Notification API 弹出系统级桌面通知，点击通知直接聚焦回工作区；
   - 网页 Title 动态闪烁徽章（如 `(待审批) Vessel`）；
3. **零外部资源合成音效 (`WebAudioSynthesizer`)**：
   - 采用纯浏览器原生 Web Audio API，无需加载任何外部 mp3/wav 静态资源，纯代码合成柔和微弱的完成提示音；
   - 提供界面全局静音（Mute）开关，设置持久化在 `localStorage`。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 注意力服务类型契约 (`apps/web/src/services/attentionService.ts`)

```typescript
export type AttentionEventKind = 'decision_needed' | 'task_completed' | 'breaker_tripped';

export interface AttentionOptions {
  soundEnabled: boolean;
  notificationEnabled: boolean;
}

export interface IAttentionService {
  trigger(event: { kind: AttentionEventKind; title: string; body: string }): void;
  setOptions(options: Partial<AttentionOptions>): void;
  getOptions(): AttentionOptions;
}
```

---

## 3. 验收标准与测试用例 (DoD)

1. **注意力服务单元测试 (`apps/web/src/services/attentionService.test.ts`)**：
   - 验证静音状态下不产生音频调用；
   - 验证在 `document.hidden` 状态下触发 Notification 派发，窗口聚焦时只更新标题；
2. **构建与门禁**：
   - `npm run -w @vessel/web build -- --emptyOutDir false` exit 0；
   - `npm run test:all` 全绿通过。

工作证明：`evidence/sessions/2026-10-10-v2.5/208-proof.md`。完成提示阈值为实测 5 秒；原生通知与合成音权限以离线 Mock 证据验收。

