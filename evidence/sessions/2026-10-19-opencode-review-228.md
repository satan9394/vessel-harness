Let me carefully analyze this diff against the task requirements.

Task 228 requirements:
1. P0: IME composition guard in TaskComposer.tsx + independent unit test
2. P0/P1: Retina hairline compensation (--ring-hairline: 0.5px @2x/@3x), 4/6/8/10/20px precision radius matrix, 3-layer focus ring
3. P1: Native scroll fade mask (.scroll-fade-mask) for chat flow (ConversationView.tsx) and inspector (layout.css)
4. P1: 70-120ms haptic press feedback micro-interaction
5. Gate contract: packages/core zero changes, 41 web unit tests all pass

Let me go through each piece.

### 1. IME Guard in TaskComposer.tsx

```diff
+  const taskInput = useRef<HTMLTextAreaElement>(null);
+  const isComposingRef = useRef(false);
+  useEffect(() => {
+    if (!draftRequest) return;
+    setTask(draftRequest.text);
+    taskInput.current?.focus();
+  }, [draftRequest]);
```

Wait, the diff adds `draftRequest` prop and a useEffect that sets task from draftRequest. This seems unrelated to the IME task... but it's part of the diff. Hmm, this may be a concern - it's adding new functionality beyond the task scope. Actually wait, looking more carefully - this might be pre-existing or a different task's change mixed in. The task says "审查 Codex 刚落地的 Task 228 (基于 Open Claude UI CDS 的 Web UI 深度优化)". The draftRequest prop addition is suspicious - it's unrelated to Task 228. But it might be a legit dependency for other work. Let me note it as scope creep / potential concern.

Actually the key IME guard:
```tsx
onKeyDown={event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    if (isComposingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault(); void submit(event);
  }
}}
```

And submit guard:
```tsx
event.preventDefault(); if (isComposingRef.current || !root || ...) return;
```

Hmm, wait. There's a potential double-preventDefault issue. In onKeyDown, `event.preventDefault()` is called then `void submit(event)`. submit then calls `event.preventDefault()` again (idempotent, fine).

But there's a subtle issue: The onKeyDown handler only calls submit when `event.key === 'Enter' && !event.shiftKey`. Good. But the original behavior - was Enter previously submitting? Let me check. The original textarea had no onKeyDown handler, so Enter in a textarea inserts a newline by default. The form submission would be triggered by the submit button or by Enter... Actually wait, in a form with a textarea, pressing Enter inside a textarea does NOT submit the form (it inserts a newline). So the new onKeyDown handler changes behavior: now Enter (without shift) submits, and Shift+Enter inserts newline.

Hmm, this is a behavior change. Actually the tests confirm this:
- `shiftKey: true` → no preventDefault, native newline
- Enter → preventDefault + submit

So the new behavior is Enter submits, Shift+Enter newlines. That's a reasonable chat-composer UX. But it's a change from the original where Enter just newlines. Not necessarily a bug, but worth noting it's beyond the strict IME guard scope.

Now the IME guard correctness:

The guard checks:
1. `isComposingRef.current` - set on compositionstart, cleared on compositionend
2. `event.nativeEvent.isComposing` - native flag
3. `event.keyCode === 229` - legacy flag

This is a standard triple-guard. Good coverage.

However, there's a classic bug: on some browsers (Safari), `compositionend` fires AFTER `keydown` for the Enter that commits the composition. So when the user presses Enter to confirm the IME candidate, the keydown fires with isComposing still true, which is handled. Good. But the reverse issue: in Safari, isComposing may be false on keydown even during composition... Actually no. The isComposing flag is generally reliable. The keyCode 229 is a fallback. The ref-based guard handles the case where compositionend arrives after keydown but before the ref is cleared... no wait, the ref is cleared in compositionend.

Actually the real classic Safari bug: `compositionend` fires, then `keydown` fires with `isComposing === false`, so the Enter would submit. Some implementations defer the compositionend state reset with a setTimeout. This diff does NOT do that. Let me think.

The common pattern:
```js
onCompositionEnd={() => { setTimeout(() => { isComposingRef.current = false; }, 0); }}
```
or using a flag that resets on next input.

Hmm. Actually in Safari, the sequence for confirming IME with Enter is: keydown (keyCode 229, isComposing true) → compositionend → ... So the keydown with 229 is caught. The problematic sequence is: compositionend → keydown(Enter, isComposing false). This happens when the user presses Enter to confirm selection; Safari fires compositionend first then keydown. In that case, isComposingRef would be false (cleared by compositionend) and nativeEvent.isComposing would be false, so the Enter would submit.

This is a known Safari IME issue. The robust fix is to track composition end timing or check `event.key === 'Enter'` combined with a small delay. However, this is a known hard edge case and many implementations accept it. Given the task explicitly says "保证拼音输入候选词选词时不误触提交", the primary browsers for pinyin are Chrome/Edge (Windows) and Safari (macOS). Chrome's sequence: compositionend fires after keydown typically, so keydown with 229/isComposing handles it.

Actually let me be more precise. In Chrome, when committing a pinyin candidate with Enter:
- keydown: keyCode 229, isComposing: true
- compositionend

So keydown is caught by isComposing. Good.

In Safari (macOS):
- keydown: keyCode 229, isComposing: true (I believe Safari also sets this)
Actually Safari historically had issues but let me not overstate.

The guard is reasonable but the Safari-after-compositionend edge isn't handled. It's a potential gap but likely acceptable. I'll flag it as a minor robustness concern.

Now the test file. Let me evaluate the test's validity.

The test uses a custom hooks harness that mocks React's useState, useRef, useEffect. This is a "Node-only component harness" — it calls the component as a function `TaskComposer({...})` directly, not rendering through React. This is fragile and not a real integration test.

Critical concern: The test harness mocks `useRef` to return `{ current: initial }` stored in hooks.values. Let me trace.

```js
useRef: (initial: unknown) => {
  const i = hooks.cursor++;
  if (!(i in hooks.values)) hooks.values[i] = { current: initial };
  return hooks.values[i];
},
```

OK so it persists refs across renders. Good.

But here's the big issue: the test's `expectNoSubmission` just awaits a microtask and asserts mock functions weren't called. But `submit` is async and involves `await` calls. It's a weak assertion but works directionally.

Wait - actually there's a more serious issue. The test `invoke(textarea(), 'onKeyDown', event)` calls the handler. The handler calls `void submit(event)` which calls `event.preventDefault()`... but we already checked. Actually submit is called only if not composing. When composing, the handler returns early, no submit. Good.

Hmm, but `submit` is an async function defined inside the component. When called, it does `setBusy(true)` etc. The test harness's useState setter updates hooks.values. Fine.

Now "6用例全绿" — the describe block has: 
1. 'leaves Enter to the IME while composition is active across renders'
2. it.each with 2 cases → 2 tests
3. 'submits the completed text on Enter after compositionEnd'
4. 'allows the native Shift+Enter newline...'
5. 'blocks form submission during composition as well'

That's 1 + 2 + 1 + 1 + 1 = 6 tests. OK, matches "6用例".

Now — is this "独立单元测试"? It's a test file. But the harness is very hand-rolled and brittle. It doesn't use JSDOM or testing-library. It "doesn't install a DOM dependency". The comment says "the browser owns newline insertion" and "no DOM dependency is installed".

Concern: This test doesn't use any real React renderer, it directly invokes the function component. This means:
- Hooks rules violations won't be caught
- The `useEffect` for draftRequest is exercised in render() (effects are flushed). Actually render() does `hooks.effects.splice(0).forEach(effect => effect())`. With draftRequest undefined, the effect returns early. Fine.
- Real event behavior (composition events, preventDefault semantics) is simulated manually.

The test asserts the handlers' behavior, which is a unit test of the handler logic. It's defensible but fragile. I'd note the harness bypasses React entirely, so it can't catch integration bugs.

One more issue: The test name says "leaves Enter to the IME while composition is active across renders". It does `invoke(textarea(), 'onCompositionStart')`. But `textarea()` calls `render()` which re-runs the component, incrementing hooks.cursor from 0 and resetting. Wait:

```js
function render() {
  hooks.cursor = 0;
  const tree = nodes(TaskComposer({...}));
  hooks.effects.splice(0).forEach(effect => effect());
  return tree;
}
```

So render resets cursor to 0 each time. But the refs persist in hooks.values (since `i in hooks.values` check). So isComposingRef persists across render() calls. Good — so "across renders" works.

But careful: `textarea()` calls render() which resets cursor and re-executes the component. The component calls useRef(0) for isComposingRef returning the persisted ref object. Good.

Now, `invoke(textarea(), 'onCompositionStart')` — textarea() renders once (getting the textarea element), then invokes onCompositionStart. That sets isComposingRef.current = true. Then `enter()` calls textarea() again → render() → component re-runs, cursor reset, but isComposingRef persisted as true. Then onKeyDown checks isComposingRef.current (true) → returns. Good.

OK tests are functionally testing the guard.

### 2. Hairline / radii / focus ring

```css
:root ... actually .tokens {
  --r-0: 4px;
  --r-sm: 6px;
  --r-md: 8px;
  --r-panel: 10px;
  --r-composer: 20px;
  --ring-hairline: 1px;
  ...
  --focus-ring: 0 0 0 1px var(--panel), 0 0 0 2.5px var(--accent), 0 0 8px 1px var(--accent-soft);
  --r-1: 14px;
  --r-2: 18px;
  --r-3: 24px;
  --r-4: 30px;
  --r-pill: 999px;
```

Requirement: "补齐 4/6/8/10/20px 精密圆角矩阵". Values: --r-0: 4px, --r-sm: 6px, --r-md: 8px, --r-panel: 10px, --r-composer: 20px. So 4/6/8/10/20 covered. But there are also --r-1:14, --r-2:18, --r-3:24, --r-4:30, --r-pill:999. These are extra. The "4/6/8/10/20" matrix is present. OK.

Hairline:
```css
@media (min-resolution: 2dppx), (-webkit-min-device-pixel-ratio: 2) {
  .tokens { --ring-hairline: 0.5px; }
}
```
Requirement: "--ring-hairline: 0.5px @2x/@3x". The media query handles 2dppx and webkit-min-device-pixel-ratio: 2. For @3x it's also covered because 3dppx matches min-resolution: 2dppx (min = at least 2). So @3x → 0.5px. OK. Though technically at 3x, 0.5px = 1.5 device px, could be better as 0.33px, but requirement just says 0.5px at @2x/@3x. Fine.

But wait — is `.tokens` actually applied? index.html has `<html lang="zh-CN" class="tokens">`. Yes. Good.

However, there's a serious issue: The hairline is used as `var(--ring-hairline)` in `border: var(--ring-hairline) solid var(--ring);` in layout.css `.docked-inspector`. That's fine.

But `--focus-ring` is defined but is it a "3-layer focus ring"? 
```css
--focus-ring: 0 0 0 1px var(--panel), 0 0 0 2.5px var(--accent), 0 0 8px 1px var(--accent-soft);
```
3 layers: 1px panel, 2.5px accent, 8px glow. Good. Applied via:
```css
:where(button, input, textarea, select, a[href], summary, [tabindex]):focus-visible { outline: none; box-shadow: var(--focus-ring); }
```
This is a global focus ring override. Concern: This applies to ALL buttons/inputs/etc. That's a broad change, could conflict with existing components that had their own focus styles. But it's `:focus-visible` so only keyboard focus. Acceptable, though broad.

Potential regression: Setting `outline: none` globally and relying on box-shadow. If a component has overflow hidden and clips the box-shadow, focus becomes invisible → accessibility regression. E.g., `.inspector-content` has `overflow: auto` and elements inside with focus ring at 8px glow could be clipped. Hmm, box-shadow isn't clipped by the element's own overflow, but it IS clipped by an ancestor's overflow:hidden. The `.main` has `overflow: hidden`. Focus rings at the edges could be clipped. Minor concern.

### 3. Scroll fade mask

```css
.scroll-fade-mask {
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%);
  mask-image: linear-gradient(...);
}
```
Applied to ConversationView `<div className="message-list-scroll scroll-fade-mask">`. Good.

Inspector:
```css
.inspector-content {
  ...
  -webkit-mask-image: linear-gradient(...);
  mask-image: linear-gradient(...);
}
```
Good. Both chat and inspector covered.

Concern: The requirement says "消除生硬截断" (eliminate harsh truncation). But `mask-image` on a scroll container — when the content is shorter than the container, the top/bottom 24px of the *element* gets faded even if no scroll. That means the first/last content always fades when near the edges. Actually with `transparent 0%` → the very top 24px of the container is faded. If content fits without scrolling, the content at top/bottom still fades. This is a common aesthetic issue — masks don't conditionally apply based on scrollability. Could be considered fine for the design, but it does fade content that isn't overflowing. Minor.

Also, a real concern: Applying mask-image creates a stacking context / can interfere with `position: sticky` children or with elements that rely on being rendered outside. In ConversationView, the `.message-list-scroll` contains `PlanChecklist` and the message list. Masking the whole scroll container is fine.

But wait — mask-image on the scroll container also masks the scrollbar? No, scrollbars are typically not part of the element's painted content for mask... actually mask applies to the element's content including scrollbar? Scrollbars are usually rendered by the browser chrome, not masked. Generally fine.

Another concern: mask-image with a fade at top 24px — the sticky header inside? There's no sticky header inside message-list-scroll. OK.

### 4. Micro-interaction 70-120ms

```css
.btn, .starter-pill, .model-pill, .rail-item { transition: background-color 120ms var(--ease), color 120ms var(--ease), box-shadow 120ms var(--ease), transform 70ms var(--ease); }
.btn:active:not(:disabled), ... { transform: scale(0.98); }
```
Transition 120ms and transform 70ms. Requirement "70ms-120ms 触觉按压反馈微交互". 70ms transform + 120ms color. OK within range.

Also `--ease: cubic-bezier(0.32, 0.72, 0, 1)`. Fine.

`@media (prefers-reduced-motion: reduce)` disables transform. Good a11y.

### Scope creep in ConversationView.tsx

The diff imports and adds:
```tsx
import PlanChecklist, { usePlanTasks, planProgress } from './PlanChecklist';
import ComposerCapsules, { MetersRow, useContextWindow } from './ComposerMeters';
```
And adds `contextWindow`, `planTasks`, `planProgressValue`, `setRouteMode`, `composer-shell` with `ComposerCapsules`, `PlanChecklist`, `MetersRow`.

These are NOT part of Task 228 requirements! Task 228 is about IME guard, hairline, radii, mask, micro-interaction. The PlanChecklist/ComposerCapsules additions (P4/P5 in the CSS) are separate features. 

Wait, but the task card says "Task 228 (基于 Open Claude UI CDS 的 Web UI 深度优化)". Hmm, it lists 5 requirements. The ConversationView diff includes the mask (requirement 3) but ALSO a bunch of other stuff (PlanChecklist, ComposerCapsules, MetersRow). This is significant scope creep / unrelated changes mixed into the same diff. Unless those were required by another part... The requirement only mentions adding `.scroll-fade-mask` to chat flow.

Actually, re-reading requirement 3: "为聊天流 (ConversationView.tsx) 和检视器 (layout.css) 增加 mask-image 渐隐". So for ConversationView, only the mask is needed. The PlanChecklist/ComposerCapsules are extra.

This is a red flag. Are these imports safe? Do `./PlanChecklist` and `./ComposerMeters` exist? We can't verify from the diff, but if they don't exist, the build breaks. The CSS references `.plan-checklist`, `.composer-capsules`, `.meters`, `.capsule` etc., suggesting new components. These are new files presumably part of the same commit but not shown. The reviewer must flag: these are out-of-scope additions mixed into Task 228's diff, and their dependencies (`usePlanTasks`, `useContextWindow`, `MetersRow`, `ComposerCapsules`) aren't shown/verified.

Also `setRouteMode` calls `api.setRouteMode(sessionId, mode)` — does ApiClient have setRouteMode? Not verifiable.

This is a serious review concern: unverifiable dependencies and scope creep.

### layout.css changes

Big rewrite of `.dual-surface` from flex to grid, changes to `.docked-inspector`, media query breakpoint change from 1023px to 1180px. These are layout changes beyond "mask-image on inspector". 

Concern: The requirement for layout.css was "为...检视器 (layout.css) 增加 mask-image 渐隐". The diff adds mask to `.inspector-content` (good) but also rewrites the entire layout: grid, min-height 420px, breakpoint changes, inspector-backdrop, etc. Scope creep again.

Potential regression: `.dual-surface { min-height: 420px }` — forcing min-height could cause layout issues on small screens. And breakpoint change to 1180px changes responsive behavior.

Also removed `@media (max-width: 1023px)` block and replaced with 1180px. The `.inspector-backdrop` was moved out of the media query to global — now it's always defined globally. But the backdrop is only rendered when inspector open on mobile presumably. Moving it to global scope is fine since it's only used when rendered.

Hmm, but `.inspector-backdrop { position: fixed; inset: 0; z-index: 60; ... animation }` globally — if the component always renders it, it would always show. But it's conditional in JSX presumably. Can't verify.

### packages/core

Diff empty. Good — zero changes. Meets gate.

### 41 web unit tests

The diff adds ONE test file with 6 tests. Requirement says "41 个 Web 单测全部通过". We can't verify the total count or that all pass from the diff. The reviewer should note this can't be independently verified from the provided diff. Also the new test harness mocks React — is it counted in the 41? Unknown.

Now let me also check: the test file imports `translate` from `../i18n` and mocks `./LanguageProvider`. Fine.

### Detailed issues

1. **TaskComposer useEffect dependency**: 
```tsx
useEffect(() => {
  if (!draftRequest) return;
  setTask(draftRequest.text);
  taskInput.current?.focus();
}, [draftRequest]);
```
`draftRequest` is an object `{ text, serial }`. If the parent re-creates this object on every render, this effect runs every render, resetting the task text and stealing focus — a bad regression. The `serial` field suggests the parent memoizes, but the effect depends on the object identity, not serial. Better to depend on `draftRequest?.serial`. This is a potential bug: focus stealing + text reset on unrelated re-renders if parent doesn't memoize. Flag it.

2. **draftRequest is out of scope** for Task 228. Scope creep.

3. **onKeyDown handler + submit double handling**: When Enter pressed and not composing, onKeyDown calls preventDefault and submit. But since the textarea is inside a form, the Enter key... in a textarea, Enter doesn't trigger form submit normally. So this is needed to make Enter submit. Fine. But there's an inconsistency: the form's onSubmit also calls `submit`. If the user clicks the submit button, onSubmit fires → submit. If a user presses Enter in a single-line... it's a textarea. OK.

But wait — there's a subtle bug: `event.nativeEvent.isComposing` — in the test `enter()` passes `nativeEvent: { isComposing: false }`. In real React, `event.nativeEvent` exists. Fine. But TypeScript: `event.keyCode` is deprecated but exists on KeyboardEvent. Fine.

4. **isComposingRef not reset on blur**: If composition is interrupted (e.g., textarea disabled mid-composition), isComposingRef could stay true. Minor edge case.

5. **The guard in submit() also checks isComposingRef**: redundant but defensive. However, submit() is triggered by form onSubmit and by the button click too. If a user is composing and somehow the form submits (e.g. programmatic), it's guarded. Good.

6. **Test harness quality**: Directly invoking the component function, not real rendering. Doesn't test actual DOM composition event ordering. The test "leaves Enter to the IME while composition is active across renders" — the "across renders" claim: each `textarea()` call re-runs the component. But ref persistence across renders works only because hooks.values isn't reset between render() calls within a test. However, `beforeEach` resets hooks.values. Within a single test, multiple render() calls share state. OK that works. But note `render()` sets cursor=0 each time, so if the component called hooks in different order/conditions between renders (Rules of Hooks violations), the harness wouldn't catch it and could even silently misbehave. The harness is essentially not a React renderer.

Concern: the harness cannot detect stale closures or actual re-render semantics. It's a weak test.

7. **`onChange={event => setTask(event.target.value)}`** — with controlled textarea, when composing, React's onChange fires with intermediate composition text. Fine.

8. **Mask fade when not scrollable** — cosmetic, noted.

9. **`.scroll-fade-mask` global utility in styles.css** — fine.

10. **Global `outline: none` focus** — accessibility concern with box-shadow clipping in overflow:hidden containers (`.main { overflow: hidden }`, `.navigation-shell { overflow: hidden }`, `.docked-inspector { overflow: hidden }`). Elements focused inside these with the 8px glow could be clipped, but the 1px+2.5px rings likely visible. For elements at the very edge (e.g., last button in a scroll container), the ring may be clipped. Flag as a11y risk.

11. **`--ring-hairline` used for borders like `border: var(--ring-hairline) solid var(--ring)`** — 0.5px borders on 2x. But if the browser doesn't render sub-pixel borders well, 0.5px may round to 0 or 1px. Standard technique. OK. But `--ring-hairline` is also used in `border: var(--ring-hairline) solid transparent` on `.btn` (styles.css) and `.inspector-tabs .btn`. A 0.5px transparent border changes box size vs 1px. Minor.

12. **Focus ring on `.input`** — the global `:where(...)` sets box-shadow, but `.input` might need outline for high-contrast mode. Minor.

13. **`@media (min-resolution: 2dppx), (-webkit-min-device-pixel-ratio: 2)`** — the comma means OR. So on any device with min-resolution ≥ 2dppx, hairline = 0.5px. This includes 3x. Good. But it also applies to 2x Windows laptops with 125% scaling... 1.25 dppx wouldn't match min 2dppx. OK.

Wait — actually there's a subtlety: `-webkit-min-device-pixel-ratio: 2` in the same media query as `min-resolution: 2dppx` with a comma = it applies if EITHER matches. On a 3x device, both match anyway. On a 1.5x device, neither. Fine.

14. **ConversationView: `setRouteMode` defined but where used?** It's passed to `ComposerCapsules onModeChange`. And `setRouteMode` calls `api.setRouteMode`. Not part of Task 228. And `planProgressValue` from `planTasks`. Scope creep.

15. **`PlanChecklist` placed inside `.message-list-scroll` before the conditional** — so it renders inside the scrollable masked area. If `PlanChecklist` returns null when no tasks, fine. Can't verify.

16. **Potential double submit**: If Enter triggers onKeyDown→submit, and the textarea's native behavior might also... no, preventDefault stops it. But what about the form's onSubmit being triggered by the Enter key natively before onKeyDown? No — onKeyDown fires before default action; preventDefault stops the default (which for textarea Enter is newline, not submit). So the form isn't triggered by Enter natively. So submit is called once via onKeyDown. Good. But if `preventDefault` is called and then submit runs async, and meanwhile... fine.

Actually wait, is there a scenario of double submission? The onKeyDown calls `void submit(event)`. submit calls `event.preventDefault()` again (no-op). submit sets busy. Since busy guard exists, a second submit would be blocked by `busy`. But busy is state, set asynchronously... within the same tick, two calls could both pass the guard. But only one onKeyDown path. OK.

17. **The form onSubmit still works for the button**. When clicking the Send button (type=submit), onSubmit → `submit` via `event => { event.preventDefault(); void send(input); }`... 

WAIT. Look at ConversationView:
```tsx
<form className="composer" onSubmit={event => { event.preventDefault(); void send(input); }}>
```
That's a different component (ConversationView, not TaskComposer). Fine.

TaskComposer's form onSubmit: `<form ... onSubmit={submit}>` presumably (not shown in diff but the submit function takes event). The test does `invoke(render().find(node => node.type === 'form')!, 'onSubmit', ...)`. So form onSubmit = submit. Good.

18. **Test "blocks form submission during composition"**: invokes form onSubmit while composing. submit checks isComposingRef → returns. Good. But note the form's onSubmit is `submit` and it guards. However, in real usage, if the user is composing and clicks the submit button, the form submits → guarded. Good.

Now, is there a bug where the guard prevents legitimate submission after composition? The compositionend clears the ref. Good.

19. **Missing: the mask on ConversationView might break the "scroll to bottom" logic** since mask doesn't affect layout. Fine.

20. **The `--ring-hairline` in `.inspector-tabs .btn { border: var(--ring-hairline) solid transparent; }`** — 0.5px transparent border. When selected, `border-color: var(--ring-2)`. Fine.

21. **Requirement "3层立体焦点环"** — the `--focus-ring` has 3 layers. But there's ALSO the `.inspector-tabs .btn` and others that might define their own focus. The global `:where(...)` applies box-shadow, overriding component focus styles (box-shadow). Components using `box-shadow` for focus would be overridden. That's intended.

But `:where()` has 0 specificity, so ANY component with higher-specificity box-shadow on focus wins. E.g., `.input:focus { box-shadow: ... }` would override. Hmm, `:where(...):focus-visible` has specificity of `:focus-visible` (0,1,0) since :where is 0. A rule `.input:focus` is (0,2,0) → wins. So global focus ring may not apply where components define their own. Inconsistent focus ring. Minor.

22. **Duplicated reduced-motion blocks** — one `* { animation-duration... }` global, and one specific. Redundant but harmless.

23. **`body::before` fixed gradient with z-index 0 and `.app { z-index: 1 }`** — content above gradient. Fine. But `body::before` covers viewport; pointer-events none. Fine.

24. **Performance**: `backdrop-filter: blur(26px) saturate(1.7)` on rail, nav shell, topbar — heavy on low-end devices. Not a task requirement per se; part of the broader UI task. Could be a perf concern. Not strictly Task 228.

### Now the verdict

Meets:
- IME guard: yes (with minor Safari edge case gap)
- IME test: yes, 6 tests, but brittle Node-only harness
- hairline: yes
- radii matrix: yes (4/6/8/10/20 present; extra tokens)
- 3-layer focus ring: yes
- mask on chat + inspector: yes
- micro-interaction 70-120ms: yes
- packages/core zero diff: yes
- 41 tests pass: unverifiable from diff

Issues:
- Significant scope creep: PlanChecklist, ComposerCapsules, MetersRow, useContextWindow, usePlanTasks, setRouteMode, layout.css full rewrite (grid, breakpoints), draftRequest prop. These are unrelated to Task 228 and their dependencies are unverifiable → build risk.
- `useEffect([draftRequest])` object-identity dependency → potential focus-steal/reset regression.
- Test harness bypasses React, weak.
- Global outline:none focus risk with clipping.
- Mask fades even non-scrollable content.
- Breakpoint change 1023→1180 may regress responsive layout.

Given the gate contract and the presence of unverifiable/out-of-scope dependencies (potential build break) plus a real potential regression in the draftRequest effect, I'd lean toward "fail" or at least "blocked". Let me weigh.

The task's core 5 requirements: The IME guard is the P0 and it's correctly implemented. The CSS tokens are present. The masks are applied. The micro-interaction is present. packages/core is untouched.

But there's a serious problem: the diff mixes in a lot of unrelated changes (PlanChecklist, ComposerCapsules) that are not part of Task 228, and these add dependencies (imports of new components, new API methods) that cannot be verified from the provided diff. If `./PlanChecklist` or `./ComposerMeters` don't exist or `api.setRouteMode`/`api.getSessionPlan` etc. don't exist, the build fails and the "41 tests pass" claim is false. As an adversarial reviewer, unverifiable additions in a task-scoped diff are grounds to fail/block.

Also, is the diff itself the "Task 228" diff? The reviewer is asked to review "Task 228 代码变更". The presence of large unrelated features strongly suggests the diff is contaminated or the task was over-scoped. Either way, contract violation: Task 228 acceptance criteria don't include plan checklist/composer capsules.

Also the "3-layer focus ring" — is it a 3-layer "立体焦点环"? Yes.

Hmm, but let me reconsider whether the extra stuff might be required. The task title: "基于 Open Claude UI CDS 的 Web UI 深度优化". The 5 listed requirements are specific. P4/P5 CSS (.plan-checklist, .composer-shell) correspond to features NOT in the 5 requirements. So definitely scope creep.

Also note: requirement 3 mentions ConversationView.tsx for the mask. The diff touches ConversationView but also does a lot more.

Let me also double-check the IME guard for a critical flaw: The `onKeyDown` only handles when `event.key === 'Enter' && !event.shiftKey`. For IME confirmation, the Enter used to select candidate has key 'Enter' with shiftKey false → enters branch → checks guard → returns. Good. What about the "Enter to commit then Enter to send" scenario? First Enter commits composition (guard blocks), compositionend fires, second Enter sends. Good.

One more: In the test, `enter()` default `keyCode: 13`, `nativeEvent: { isComposing: false }`. First test: after compositionStart, enter() → isComposingRef true → return. preventDefault not called. Good.

Edge: Some IMEs on pressing Enter fire keydown with keyCode 229 AND key 'Enter'. Caught.

OK.

Let me also verify the requirement "具备独立单元测试" — yes, TaskComposer.test.tsx is independent (separate file), 6 cases. Acceptable, though harness quality questionable.

Now, is there any actual bug in the IME logic that fails the acceptance criterion "保证拼音输入候选词选词时不误触提交"? The triple guard handles the common case. The Safari compositionend-before-keydown case is a known gap but not universal. I'll note it as a residual risk, not a hard fail.

Let me settle the verdict. Given:
1. Scope contamination with unverifiable dependencies → high risk of build/test failure → can't confirm "41 tests pass".
2. Potential real regression via draftRequest effect.

As an adversarial reviewer with the mandate "严格对抗性、不留情面", I'll issue **fail** (or blocked). The distinction: "blocked" if we cannot proceed due to missing info. Given the diff contains unverifiable new imports/APIs and out-of-scope changes, and the P0 acceptance can't be fully certified... 

Hmm. Let me be fair: if I judge strictly on the 5 requirements + gate:
- IME guard: PASS
- Hairline/radii/focus: PASS
- Masks: PASS
- Micro-interaction: PASS
- packages/core 0 diff: PASS
- 41 tests: UNVERIFIABLE

So on the letter