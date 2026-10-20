Let me carefully review the diff against the requirements.

Task 229 requirements:

1. P1: Tool card upgrade (ToolActivityRow.tsx & .tool-row):
   - var(--panel-2) background, hairline border, precise radius (--r-sm: 6px) ✓ present in .tool-row
   - Status breathing animation and clear color-level mapping (running/ok/danger) ✓ statusTone, tool-pulse
   - Args summary + timestamp layout spec, keep SandboxAuditBadge ✓

2. P1: Thinking stream collapsible card (StreamingReasoningBlock & .thinking-block):
   - --think: #7c5ce0 accent hairline and animated dot ✓ (border-left: 3px solid var(--think), thinking-dot background var(--think))
   - smooth collapse transition (interpolate-size: allow-keywords) ✓ present
   - mount tabular-nums ✓ body has font-variant-numeric: tabular-nums

3. P1: motion duration/easing tokens:
   - --dur-* (60/120/200/300/450ms) ✓ --dur-fast 60, --dur-snap 120, --dur-base 200, --dur-sheet 300, --dur-slow 450
   - --ease-* (swift, enter) ✓ present
   - message text typography text-wrap: pretty, inline code code hairline and background ✓ (.msg-assistant .msg-body { text-wrap: pretty; } and .msg-body code)

4. Gates and unit tests:
   - packages/core 0 modifications ✓ (empty diff)
   - Includes new independent unit test (ToolActivityRow.test.tsx), all pass ✓

Now let me do adversarial review looking for bugs.

Potential issues:

1. ToolActivityRow test: `it('omits absent optional metadata')` — in this test the tool has status 'done' by default and no durationMs. But note the test's `render` default: `{ toolName: 'read_file', status: 'done', ts: 1 }`. It checks not contains `class="tool-dur"`, `class="tool-args"`, `class="tool-badge"`. That's fine.

But wait: the omits test - `expect(html).not.toContain('class="tool-dur"')`. Fine.

2. Test with toolName: undefined - the fallback test. It renders toolName: undefined. In the component, `const name = delta.toolName ?? t('noTool');`. Good.

3. Duration formatting: `delta.durationMs >= 1000 ? t('timeSeconds', { value: (delta.durationMs / 1000).toFixed(1) })`. For 1250ms → 1.25 → toFixed(1) → "1.3". Test expects '1.3s'. Good (rounding). For 1000 → "1.0" → '1.0s'. Good.

But is `timeSeconds` a real i18n key? We can't verify from the diff. The original code only used `timeMilliseconds`. Adding `timeSeconds` to i18n is required. If the key doesn't exist, the test would still pass if translate returns the key or something, but the test asserts `t('timeSeconds', { value: '1.5' })` — this is self-referential: the test uses the same translate function as the component, so it would pass even if the key is missing. That's a weak test (self-verifying), but more importantly, if `timeSeconds` isn't defined in i18n, the UI shows garbage. This is a potential defect: the diff for i18n.ts is not provided. The task says packages/core 0 changes, but i18n is in apps/web. We don't see i18n diff. This is a gap — unverifiable. Actually the reviewer should note that `timeSeconds` i18n key addition is not shown in the diff; if missing, it's a bug. Let me consider: the tests import `translate` from '../i18n'. The test asserting `t('timeSeconds', ...)` uses the same function. So the test cannot detect a missing key. This is a "tautological test" - dead test coverage. Worth flagging.

4. Accessibility: `role="group" aria-label={...}`. Note `aria-label` includes `·` character. Fine.

5. The component removed `tool-${statusClass}` class which previously might be used by other CSS. The new classes are `tool-row--${tone}`. Check the CSS diff: previously there were `.dot-warn`, `.dot-ok`, `.dot-err` classes presumably used elsewhere. The `.tool-row` CSS no longer references those. But the `.dot` class might still be used elsewhere. Not a big issue.

Wait - a potential regression: The old code had `dot-warn`, `dot-ok`, `dot-err` classes that were probably defined in CSS. The new code uses `.tool-dot`. But the diff for styles.css may still have `.dot-*` definitions—not shown as removed. Not a correctness issue for this component.

6. Now, a real potential bug: the `.tool-args` has `-webkit-line-clamp: 2` with `display: -webkit-box`. But also `overflow: hidden; text-overflow: ellipsis;`. Fine.

7. `.tool-badge` `grid-column: 2 / -1` on max-width 600px. The grid has 3 columns. When the badge wraps to column 2/-1... actually the badge is the third grid item. On narrow screens it should span. Fine.

8. Check the CSS: `.tool-row` sets `--tool-tone` only via modifier classes `.tool-row--running` etc. But `.tool-dot` uses `background: var(--tool-tone)`. If no tone modifier, undefined → but always has one.

9. `.tool-status` uses `color: var(--tool-tone)`. Good mapping running=warn (amber), ok=ok (green), danger=danger (red). But wait: the requirement says "清晰色阶映射 (running / ok / danger)". Original semantics: started → amber (warn). Now running → --warn. Consistent.

But hold on: the requirement asked for 状态呼吸动效 (breathing animation). Only running has animation. OK.

10. Now a potential issue with `interpolate-size`. `interpolate-size: allow-keywords` on `.thinking-block` — this property is only supported in Chrome 129+, and applies to the element to allow animating to/from `auto` keywords. The `::details-content` pseudo with block-size transition. This is progressive. Fine.

However there's a subtlety: `interpolate-size` is an inherited property? Actually `interpolate-size` is not inherited in the spec... Let me recall. The CSS `interpolate-size` property: initial value `numeric-only`, applies to all elements, inherited: yes. Actually per MDN, interpolate-size is inherited. Anyway setting on .thinking-block covers the details-content child. Fine.

11. The `@supports (interpolate-size: allow-keywords)` guard is used. But the `.thinking-block { interpolate-size: allow-keywords; }` is set unconditionally outside the supports block. In a non-supporting browser, invalid declaration is ignored. Fine.

12. Reduced motion media query: sets `.thinking-block::details-content { transition: none; }`. Also global `*` transition-duration 0.01ms. Fine.

13. Now the big one: is there a regression in `.thinking-block`? The diff shows `border-left: 3px solid var(--think)` but the original had `border: 1px solid var(--border)`. Now `border: hairline solid var(--ring)` then `border-left: 3px solid var(--think)`. That means border-left is 3px, others hairline. Fine. Requirement wanted `--think: #7c5ce0` accent hairline. Actually the requirement says "思考强调色发丝线" (hairline). 3px is not exactly hairline, but it's an accent bar. Minor.

14. `--think: #7c5ce0` is defined in `.tokens` for light, dark has `#a78bfa`. Requirement said --think: #7c5ce0. In dark it's different. That's acceptable (theme).

Wait, requirement literally: "具备 --think: #7c5ce0 思考强调色发丝线与动态点". The light value matches exactly. Fine.

15. Now check the tokens layer: The color tokens moved from `:root` to `.tokens`. The comment says index.html sets that class on <html>. This is a significant change. If index.html does NOT set class="tokens", all tokens would be undefined and the entire UI breaks. The diff does not show index.html changes. This is a critical risk! The task 229 says P1 only about tool cards and thinking block and motion tokens. Moving all color tokens to `.tokens` is a much broader change (looks like the whole redesign, P2-P6). This may be part of a larger task, but the diff is truncated/summarized. Hmm, the diff is huge and includes many unrelated changes (rail nav, glass shell, plan checklist, composer capsules, etc.). This suggests the diff provided is broader than Task 229. But we're asked to review Task 229 changes. The presence of these broad changes could be from earlier tasks. Hard to say.

Actually the instruction says "审查 Codex 刚落地的 Task 229 代码变更" and gives these diffs. The styles.css diff is enormous and includes P2-P6 stuff. Hmm, but they said "完整未截断" for styles.css. So it's intentionally the full diff. That's weird - Task 229 is about message flow and tool cards. The styles.css diff includes a ton of unrelated redesign. Maybe the repo was mid-redesign. But we should note scope creep.

Actually, wait. Is the provided styles.css diff actually the diff for this task, or the whole file diff since a base commit? The diff moves tokens from :root to .tokens. This is a big change that could break things if index.html doesn't have the class.

Let me evaluate whether this breaks the app. If `<html>` doesn't have `class="tokens"`, then `.tokens { --bg: ... }` never matches, and the variables used in `body { background: var(--bg) }` would be undefined → invalid, so body background falls back to initial (transparent/white). Actually `var(--bg)` with no fallback and undefined variable → the declaration is invalid at computed-value time → property becomes its inherited/initial value. So background would be transparent → default white. In dark mode also white. That would be a catastrophic visual regression.

But since the diff comment says "index.html sets that class on <html>", presumably there's an index.html change not shown. Since the task says "packages/core 0 修改" but doesn't mention index.html. This is a verification gap: we can't confirm index.html has the class. Should flag as unverifiable / potential blocker.

Hmm, but the reviewer contract wants a verdict. Let me think about what's actually verifiable within the given diff.

Let me focus on concrete bugs in the shown code.

Bug candidate A: In `ToolActivityRow`, `role="group"` with `aria-label`. Fine.

Bug candidate B: The test file uses `renderToStaticMarkup`. Test asserts `expect(html).toContain('class="tool-badge"')`. Good.

Bug candidate C: The test `it('renders the real sandbox audit disclosure and security details')` expects `class="sandbox-audit sandbox-green"`. That depends on SandboxAuditBadge. Fine.

Bug candidate D: `it('escapes tool arguments...')` expects `&lt;script&gt;`. React escapes. Fine.

Bug candidate E: The test's `omits absent optional metadata` uses default status 'done'. Fine.

Now, the test says "14 用例全绿". Let's count: 1 (name/status/duration) + 4 (it.each status mapping) + 5 (duration formats) + 1 (omits) + 1 (fallback) + 1 (sandbox) + 1 (escapes) = 14. Good, matches.

Now, potential real bug: In the duration test, `it.each([[0, '0ms'], [999, '999ms'], [1000, '1.0s'], [1250, '1.3s'], [12000, '12.0s']])`. For 1250, `(1250/1000).toFixed(1)` = `(1.25).toFixed(1)`. JS toFixed uses round-half-to-even? Actually toFixed(1) of 1.25 → "1.3"? Let me think. 1.25 in binary is exactly 1.25 (since 0.25 is power of 2). toFixed uses round-half-up? The spec: Let n be an integer for which n/10^f - x is as close to zero as possible. If there are two such n, pick the larger n. So for 1.25, f=1, candidates 12 (1.2) and 13 (1.3); both equally close; pick larger → 13 → "1.3". So yes "1.3". Good.

For 12000 → 12.0 → toFixed(1) = "12.0". Good.

Now the i18n 'timeSeconds' key. The component calls `t('timeSeconds', { value: ... })`. If the key doesn't exist, `translate` might return the key itself or fall back. The test at line: `expect(html).toContain(t('timeSeconds', { value: '1.5' }))` — self-referential, always passes. So this test is tautological and cannot catch a missing i18n key. However, the other duration test asserts exact `1.0s`, `1.3s`, `12.0s` — which DOES verify the actual rendered output. So if `timeSeconds` were missing, `render({durationMs:1000})` would produce something != "1.0s" and the test would fail. So the exact-assertion test does verify. Good, so not a problem—unless translate returns "timeSeconds" formatted? Then it'd fail. So the test coverage is real for the English path. For the zh path, it's self-referential though. Minor.

Actually wait: the duration test asserts `<span class="tool-dur">1.0s</span>`. This requires the English translation of timeSeconds to be exactly `{value}s`. That's plausible.

Now, potential issue: `t('timeSeconds', { value: (delta.durationMs / 1000).toFixed(1) })` — for zh, the test asserts `t('timeSeconds', { value: '1.5' })`. Self-referential. Fine.

Now let's look at things that might be "dead zone" or meaningless styles.

- `.tool-row { transition: border-color ... }` but no hover change except `.tool-row:hover { border-color: var(--ring-2); }`. Used.

- The old `.dot` classes removed? The diff removed `statusClass` returning `dot-warn` etc. If those classes are still used elsewhere (e.g., other components use `dot-ok`), no.

- `.tool-rail { display: flex; align-items: center; min-height: 24px; }` and inner `.tool-dot` 7px. The grid column is 7px. Fine.

Now, an actual concern: The `.tool-row` grid is `7px minmax(0,1fr) auto`. The `tool-badge` is the third item. On mobile, `grid-column: 2/-1`. But the badge is only rendered if `delta.sandbox`. Fine.

Now, the requirement: "参数摘要与时间戳排版规范" - args summary and timestamp. The timestamp: there's no timestamp rendered! The original had `delta.durationMs` rendered as duration, and `delta.argsSummary`. The ToolDelta has `ts: 1` but the component doesn't render `ts`. Hmm, "时间戳" might refer to duration. The requirement says "参数摘要与时间戳排版规范" (arg summary and timestamp typography spec). The component renders duration, not ts. Maybe "时间戳" = duration display. Ambiguous. In the styles, `.tool-dur` is styled. So probably duration counts.

Now, one more: the requirement mentions "保留沙箱凭据 SandboxAuditBadge" — preserved. ✓

Now, let me look for regressions in the CSS that could break things.

Critical: `.tokens` class migration. Also `--border`, `--dim` aliases kept. But note `.input` uses `border: var(--ring-hairline) solid var(--border)` while `--ring-hairline` is defined inside `.tokens`. If a component is outside `.tokens` context... all are inside html.tokens. Fine.

But wait: `--ring-hairline: 1px` defined in `.tokens` (light) and overridden in `@media (min-resolution: 2dppx) { .tokens { --ring-hairline: 0.5px; } }`. Fine.

Now: the `body` uses `font-variant-numeric: tabular-nums;` globally. Requirement said "挂载 tabular-nums 等宽数字" for thinking block. The CSS also adds `.counter, .token-count, .timer, time, .tool-dur, .reasoning-rate { font-variant-numeric: tabular-nums; }` which is now redundant given body-level tabular-nums. That's a "meaningless style" (redundant). Minor but worth flagging as dead/redundant.

Actually global tabular-nums for all text could be considered a typography regression for prose (tabular figures look odd in body text). It's a design choice. Could flag as questionable.

Now let's consider the `@media (max-width: 700px)` change:
```
.app {
  grid-template-columns: 58px minmax(0, 1fr);
  height: 100dvh;
  overflow: hidden;
}
```
Previously it was single column with rows. Now at ≤700px the app is `58px 1fr` — but the rail is 58px, and there's also the navigation drawer from ≤1180px. Hmm. At ≤700px, `.app` grid has 2 columns: 58px + 1fr. The rail takes col1, main takes col2. The navigation-shell is `position: fixed` (from ≤1180px) displayed none unless open. OK.

But wait, at ≤700px, the base `.app` has `grid-template-columns: 58px 232px minmax(0,1fr)` and `gap: 12px; padding: 12px`. The ≤700px override sets `grid-template-columns: 58px minmax(0,1fr)` but keeps gap 12px and padding 12px. Fine.

Hmm, but there's a potential issue: the rail is rendered? In the app presumably the rail component exists. Not verifiable.

Let me now check the `@media (max-width: 1180px)` block: `.navigation-shell { display: none; position: fixed; top: 12px; bottom: 12px; left: 82px; ... }`. left: 82px = 12px padding + 58px rail + 12px gap. OK.

Now, the base `.app` grid at >1180px includes `58px 232px minmax(0,1fr)`. And `.sidebar-collapsed` sets `58px 0px`. Fine.

Now the `.navigation-shell .sidebar { background: transparent; border-right: 0; padding: 14px; }` and later `.navigation-shell .sidebar { flex: 1; min-height: 0; border: 0; }`. Fine.

Now, potential CSS bug: In the diff, the `.navigation-shell` block added near top:
```
.navigation-shell {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: var(--r-3);
  ...
}
```
Then later in the P2/P3 section: `.navigation-shell { min-height: 0; display: flex; flex-direction: column; background: var(--panel); border-right: 1px solid var(--border); }` — wait, the diff removed that line? Let me re-read.

The diff shows:
```
 /* Card 218: product regions and task-first workbench. */
-.navigation-shell { min-height: 0; display: flex; flex-direction: column; background: var(--panel); border-right: 1px solid var(--border); }
-.primary-nav { display: grid; gap: 4px; padding: 12px; border-bottom: 1px solid var(--border); }
-.primary-nav .btn { text-align: left; }
+.primary-nav { display: flex; flex-direction: column; gap: 6px; }
```
So the `.navigation-shell` rule in that later section was removed, and it's now defined at the top. OK. But note the top definition has `background: var(--panel)`? Let me re-check: The added `.navigation-shell` near top has `background: var(--panel); border: 1px solid var(--ring); box-shadow: var(--shadow-2); overflow: hidden;`. Yes, in the added block:
```
.navigation-shell {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: var(--r-3);
  background: var(--panel);
  border: 1px solid var(--ring);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}
```
Yes. Good.

Now `.main { ... overflow: hidden; }`. The message list scroll inside. But the new `.app` and `.main`—fine.

Hmm, note: `.main` has `overflow: hidden`. And `.workbench-home { overflow-y: auto; }` etc.

Now potential real regression: `.module-sections { flex: none; }` and the parent rule adding `overflow-y: auto`. The comment says the conversation keeps usable height. This is P4-ish. Not Task 229.

OK so the styles.css diff is a full redesign, not just Task 229. This suggests the reviewer should flag scope: The diff substantially exceeds Task 229's stated scope (P1 tool cards + thinking block + tokens + typography). It includes rail nav (P2/P3), plan checklist (P4), composer capsules (P5), behavior inspector flattening (P6), team DAG colorization, etc. That's scope creep / possibly a diff against an older base. But since we're told this is the diff, we flag that Task 229's own acceptance items are present among many unrelated changes, making the change non-isolated and riskier.

Hmm, but the adversarial review should focus. Let me weigh: The instructions say "评估这个 diff 严格对照需求". The prompt explicitly lists the requirements. The styles.css diff includes the required pieces. Whether unrelated changes are present—yes, and that's a concern but maybe out of scope of "Task 229"? The reviewer should mention it.

Now, let's find concrete defects that would fail acceptance.

Defect 1: `--panel2` alias vs `--panel-2`. The task requires `var(--panel-2)`. Tool row uses `background: var(--panel-2)`. ✓

Defect 2: Hairline border: `border: var(--ring-hairline) solid var(--ring)`. ✓

Defect 3: radius `--r-sm: 6px` ✓.

Defect 4: status breathing animation: `.tool-row--running .tool-dot { animation: tool-pulse 1.4s ease-in-out infinite; }` and keyframes include box-shadow glow with `var(--warn)`. But the dot's background is `var(--tool-tone)` = `--warn` for running. Fine.

Hmm, but the keyframes `50% { ... box-shadow: 0 0 6px var(--warn); }` hardcodes `--warn` rather than `var(--tool-tone)`. Since only running uses it, fine.

Defect 5: "清晰色阶映射 (running / ok / danger)" — implemented via data-tone and classes. ✓

Defect 6: `.tool-status` color mapping. For running, `--warn` (amber), ok green, danger red. ✓

Now, a potential accessibility/UX bug: the `aria-label` on the group includes name and status, and the inner spans also have text ("read_file", "done"), so screen readers might announce duplicates (group label then children). Not a hard failure.

Now let's scrutinize `statusTone` exhaustiveness: The switch covers 'started','done','denied','error'. TypeScript: ToolDelta['status'] is a union of exactly these four, and the function returns the union type 'running'|'ok'|'danger'. With all cases returning and no default, TS may complain "function lacks ending return statement" unless it can prove exhaustiveness. Since the union is exhaustive and all cases covered, TS's control flow analysis will consider the function to have no implicit return... Actually TS does NOT infer exhaustiveness for return type unless `noImplicitReturns` and it can determine the end is unreachable. For a switch over a union with all members handled, TS does understand the end is unreachable and won't error. Yes, TS handles this: when switching over a union and all cases return, the code after is unreachable. But if the union later gains a member, it silently returns undefined (no default). The original had a `default` case. Removing the default means future 'warn' state would return undefined → `tool-row--undefined`. Minor robustness regression. Worth flagging as a latent risk: removing the `default` fallback makes the component brittle to ToolDelta status union expansion (return type claims 3 tones but could yield undefined at runtime). Actually, with `noImplicitReturns` off, TS is fine. But the function's declared return type is a closed union; if a new status is added, TS errors at call site? No—statusTone would return `undefined` implicitly which conflicts with declared return type; TS would error "Function lacks ending return statement and return type does not include 'undefined'" only if `noImplicitReturns` is enabled, or... Actually even without noImplicitReturns, if a function has a declared return type that doesn't include undefined and there's a code path that reaches the end, TS reports error TS2366 "Function lacks ending return statement and return type does not include 'undefined'." This error is emitted regardless of noImplicitReturns when there's a declared return type. Hmm, but TS's control flow: if it determines all switch cases are exhaustive over the union and all return, the end is unreachable, so no error. If a new union member is added, the end becomes reachable → TS2366 error. So actually it's compile-safe: adding a status would break the build, which is arguably good (forces update). So not a real defect. But the original `default: return 'dot-warn'` was more tolerant. Eh, I'd call it neutral/minor.

Hmm wait, actually there's a subtlety: does TS narrow the union exhaustively? Yes, for a switch on a value of union type, after handling all members, the implicit default is `never`. TS reports the function's end as unreachable. So no error. Good.

Now, a real question: the renaming from `tool-${statusClass}` to `tool-row--${tone}`. Any other code/test referencing `tool-dot-warn` etc.? Not in the diff. The previous CSS classes `dot-warn`, `dot-ok`, `dot-err` presumably still exist in styles.css (not removed). If they remain but unused, that's dead CSS. But the diff doesn't show them being removed. Are they in the file? Let me search the diff: I see `.tool-row` region, `.tool-name`, `.tool-status`, `.tool-dur`, `.tool-args`. No `.dot-*` definitions in the diff context. Hmm, the original `.tool-row` had `class="dot ${statusClass(...)}"` so `.dot-warn` etc. must be defined somewhere in styles.css (maybe in the non-shown parts). If those rules remain and are now unused by ToolActivityRow, they might still be used elsewhere (e.g., status dots elsewhere). Unknown. Could flag as "potential dead CSS / need to verify no orphaned .dot-* rules".

Now let's look at `localizedValue` import — it was already imported. Yes, originally used.

Now `const status = localizedValue(delta.status, t);` computed unconditionally, used in aria-label and rendered. Fine. Previously it was computed inline twice. Fine.

Now, does the component still compile? `data-status={delta.status}` fine. `data-tone={tone}` fine.

Now, tests: `renderToStaticMarkup` and `vi.hoisted`. `LanguageProvider` mocked. But the test imports `localizedValue, translate, type Lang` from '../i18n'. So i18n must export `translate`, `localizedValue`, `Lang`. Presumably yes. If `translate` is not exported by i18n, the test fails to compile → "全量通过" claim false. We can't verify. Flag as unverifiable dependency.

Now, `it.each` with `as const` array of tuples and callback `(status, tone)` — TypeScript infers types. Fine.

Now the `beforeEach(() => { language.current = 'en'; });` resets language. Good.

Potential test pollution: `vi.mock('./LanguageProvider', ...)` hoisted; `language` via vi.hoisted. Fine.

Now: The test file location — Task says "包含新增的独立单元测试 (ToolActivityRow.test.tsx)". ✓.

Now let me reconsider the `.tokens` migration more carefully, because that's the highest-risk item and it's the kind of thing an adversarial reviewer should catch.

The old CSS defined tokens on `:root`. The new CSS defines them on `.tokens`. This means any usage of `var(--bg)` etc. outside an element with class `tokens` (or its descendants) would be invalid. Everything in the document is inside `<html>`; if `<html class="tokens">` then all descendants inherit. So it works only if index.html has the class. The diff comment claims so. But the index.html change is not in the provided diff. If index.html was updated in a previous commit (e.g., the skeleton), then fine.

However, there's a subtle issue: CSS custom properties defined on `:root` (html) vs `.tokens` (html class) — both on the same element if html has class. Equivalent. So the only risk is the missing class. I'll flag it as "must verify index.html sets class='tokens'; otherwise total theme failure" — a conditional blocker. Since we can't verify, the verdict might be "blocked" or note as risk.

But hold on—the review contract asks for strict adversarial review and a verdict. Let me determine if any requirement is actually violated.

Requirement 4: "packages/core 保持 0 修改" — satisfied (empty diff).

Requirement: "包含新增的独立单元测试 (ToolActivityRow.test.tsx)，全量通过" — the test file is provided; can't run. But let's check for any test that would fail.

Test: `it('omits absent optional metadata')` asserts `expect(html).not.toContain('class="tool-badge"')`. With no sandbox, no badge. ✓

Test: `uses the localized fallback name and duration` sets language to 'zh' and calls `render({ toolName: undefined, status: 'started', durationMs: 1500 })`. Expects aria-label `${t('noTool')} · ${localizedValue('started', t)}`. The component builds `aria-label={`${name} · ${status}`}` where name = t('noTool') and status = localizedValue('started', t). ✓. Also expects `t('timeSeconds', {value:'1.5'})` present. `1500/1000 = 1.5`, toFixed(1) = "1.5". ✓ (self-referential but fine).

Test: `renders the real sandbox audit disclosure`. expects `class="sandbox-audit sandbox-green"`. Depends on SandboxAuditBadge implementation. If the badge's class changed, test fails. Can't verify. The prompt says "保留沙箱凭据 SandboxAuditBadge" unchanged. Assume fine.

Now `escapes tool arguments` — React escapes `<` to `&lt;`. But does React also escape `"`? The expectation is just `&lt;script&gt;` present and `<script>` absent. ✓

Now count "14 用例全绿" matches.

Now let's examine whether the new markup breaks any existing tests (regression). E.g., other tests that assert the old markup `class="tool-row tool-dot-ok"` or `class="dot dot-ok"` or `.tool-dur` exact string. If there are existing integration tests (e.g., App.test.tsx or a snapshot) that assert the old tool row markup, they'd fail. The prompt says "全量通过" — all pass. We can't verify. Potentially there are existing e2e/snapshot tests. Flag as risk: markup change may break existing tests/snapshots not shown.

Actually, an important one: The old markup was a flat structure with `dot` span. Now `tool-rail`/`tool-main`/`tool-head`. Any CSS elsewhere targeting `.tool-row > .dot` or `.tool-status` sibling selectors could break. E.g., `.tool-row .dot` rules. The removed `.dot-*` classes. Unknown.

Now let me check the CSS for the `.dot` class usage—it's not touched in the diff. If `.dot` had a default style (e.g., 8px circle) it's irrelevant now.

Now, let's think about whether `.tool-status` background uses `color-mix(in srgb, var(--tool-tone) 12%, transparent)`. Supported in modern browsers. Fine.

Now check the requirement: "状态呼吸动效" — only running pulses. And "清晰色阶映射". ✓

Requirement 2: "挂载 tabular-nums 等宽数字" — body-level tabular-nums + explicit list. ✓

Requirement 3: "消息文本排版 text-wrap: pretty" — `.msg-assistant .msg-body { text-wrap: pretty; }`. The requirement says "消息文本排版 text-wrap: pretty". Only applied to assistant messages, not user. Acceptable? "消息文本" generally. Applying only to assistant is a reasonable choice. Minor.

"行内代码 code 发丝与底色规范" — `.msg-body code { ... border: hairline solid var(--ring); background: var(--panel-2); }`. ✓ Note it targets `.msg-body code`, and there's a global `code` rule earlier (line ~658) not shown. Fine.

Now, the `code` font-size `0.9em` and padding. Fine.

Now, let's consider potential layout regression in `.tool-row` due to grid with `align-items: start` and the dot rail `min-height: 24px`. Fine.

Potential issue: `.tool-head` has `min-height: 24px` and `align-items: center`. The `.tool-dur` has `margin-inline-start: auto` to push right. With flex-wrap, it wraps. OK.

Now `--r-sm: 6px` matches requirement.

Now, let's consider the "prefers-reduced-motion" global rule:
```
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```
This `*` selector affects all elements including pseudo? No, `*` doesn't match ::before/::after (they're pseudo-elements, need `*, *::before, *::after`). So body::before glow (no animation anyway) fine. The `.thinking-block::details-content { transition: none; }` explicit. Fine. But note `transition-duration: 0.01ms !important` doesn't reset `transition-delay`, but no delays used. Fine.

Now, one more: `interpolate-size` on `.thinking-block` is set, but the `@supports` block uses `::details-content`. In browsers supporting interpolate-size but not `::details-content` (Chrome supports both since 131 for details-content), fine.

Now, is `interpolate-size: allow-keywords` inherited to ::details-content? The pseudo-element inherits from its originating element for inherited properties. `interpolate-size` is inherited (per spec, inherited: yes). So ok.

Now, potential bug: `.thinking-block