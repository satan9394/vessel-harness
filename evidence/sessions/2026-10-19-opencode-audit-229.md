The user wants a detailed audit report against Claude Design System (CDS) sections 3.1, 3.2, 3.5, with concrete code changes for the files provided. Let me produce a thorough, actionable report with before/after code.

Let me structure it:

1. Executive summary / audit verdict with a table of findings
2. Token layer additions (CDS motion tokens) — styles.css `.tokens`
3. ToolActivityRow.tsx + `.tool-row` CSS — card upgrade
4. StreamingReasoningBlock.tsx + `.thinking-block` CSS — think accent, interpolate-size
5. Message bubbles + markdown/codeblock styling
6. Accessibility / keyboard / a11y notes
7. Implementation checklist for Codex (ordered), plus test/QA verification

I should be careful: current styles.css shown is truncated (the excerpt ends mid-`.plan-checklist`). The `.tool-row` and `.thinking-block` styles aren't shown — I should note that and provide the full replacement rules, telling Codex to locate per selectors.

Let me write actual CSS with the given tokens. Tokens exist: --panel-2, --ring, --ring-hairline, --r-sm (6px), --ok/--warn/--danger + soft variants, --think, --tools, --approve, --policy, --ease, --shadow-1, --focus-ring, --glow, etc.

Add CDS motion tokens:
```css
/* CDS §3.1 motion scale */
--dur-instant: 90ms;
--dur-fast: 140ms;
--dur-base: 200ms;
--dur-slow: 320ms;
--dur-slowest: 480ms;
--ease-swift: cubic-bezier(0.22, 1, 0.36, 1);      /* enter / decelerate */
--ease-enter: cubic-bezier(0.16, 1, 0.3, 1);        /* expo-out */
--ease-exit: cubic-bezier(0.4, 0, 1, 1);
--ease-standard: cubic-bezier(0.32, 0.72, 0, 1);    /* = legacy --ease */
```

Also `--ease-spring`? Keep it to what's asked: 5 durations + swift/enter curves (mention a couple extras).

Note reduced-motion already kills transitions globally via the `*` rule — but that rule sets transition-duration to 0.01ms !important, which kills all transitions. That's fine but note that the pulse animation should also be disabled; it sets `animation-duration: 0.01ms !important` so ok. But an infinite pulse... animation-iteration-count: 1 !important handles it.

Now ToolActivityRow:

Current DOM: div.tool-row.tool-dot-ok with span.dot, span.tool-name, span.tool-status, span.tool-dur, span.tool-args, SandboxAuditBadge.

Problems:
- class `tool-dot-ok` is weird naming — should be `tool-row--ok` / data-status attribute.
- no aria semantics for status (screen reader just reads the status text, ok but no live region role)
- no `title` on status dot; the dot is aria-hidden so status text carries meaning — fine.
- args summary is inline text that may overflow; needs monospace + ellipsis.
- status localization via localizedValue.
- duration formatting: uses t('timeMilliseconds') even for large durations → should switch to seconds like the thinking block does. Suggest a shared `formatDuration` util.

Proposed refactor:

```tsx
import { localizedValue } from '../i18n';
import { useI18n } from './LanguageProvider';
import type { ToolDelta } from '../sse';
import SandboxAuditBadge from './SandboxAuditBadge';

type ToolStatus = ToolDelta['status'];

/** CDS §3.5 — semantic tone per tool lifecycle state. */
type Tone = 'running' | 'ok' | 'danger';

function toneOf(status: ToolStatus): Tone {
  switch (status) {
    case 'started': return 'running';
    case 'done': return 'ok';
    case 'denied':
    case 'error': return 'danger';
    default: return 'running';
  }
}

/** Shared with StreamingReasoningBlock — one duration formatter, tabular-nums safe. */
export function formatDuration(ms: number, t: ReturnType<typeof useI18n>['t']): string {
  return ms >= 1000
    ? t('timeSeconds', { value: (ms / 1000).toFixed(1) })
    : t('timeMilliseconds', { value: String(Math.round(ms)) });
}

export default function ToolActivityRow({ delta }: { delta: ToolDelta }) {
  const { t } = useI18n();
  const tone = toneOf(delta.status);
  const name = delta.toolName ?? t('noTool');
  const status = localizedValue(delta.status, t);
  return (
    <article
      className={`tool-row tool-row--${tone}`}
      data-status={delta.status}
      data-tone={tone}
      aria-label={`${name} · ${status}`}
    >
      <span className="tool-rail" aria-hidden="true">
        <span className="tool-dot" />
      </span>
      <div className="tool-main">
        <div className="tool-head">
          <span className="tool-name">{name}</span>
          <span className="tool-status">{status}</span>
          {typeof delta.durationMs === 'number' && (
            <span className="tool-dur">{formatDuration(delta.durationMs, t)}</span>
          )}
        </div>
        {delta.argsSummary && (
          <div className="tool-args" title={delta.argsSummary}>{delta.argsSummary}</div>
        )}
      </div>
      {delta.sandbox && (
        <div className="tool-badge"><SandboxAuditBadge audit={delta.sandbox} /></div>
      )}
    </article>
  );
}
```

Careful: `article` with aria-label — role article is fine. But MessageList wraps each item in a `div[data-message-card]` with role=group. Keep `div` to be safe? Using `<div>` avoids any surprise with role mapping. Actually `<article>` maps to role=article; that's fine and semantically nice. But since it's inside a role="group" card, either works. I'll suggest `<div>` for minimal diff, or article. I'll go with `<div className="tool-row" role="group" aria-label=...>` — hmm, role="group" nested inside group. Simpler: `<div className="tool-row ...">` and keep aria-label on it (aria-label on a plain div with no role is ignored by some AT... actually aria-label on generic elements is discouraged/ignored). Better: put aria-label on a `<section>` or use `role="group"`. I'll recommend `<section className="tool-row" aria-label={...}>` — section with accessible name maps to role="region". Nested regions can be noisy. Let me just use `<div className="tool-row" role="group" aria-label>` — that's legit and predictable.

Hmm, but also status should be announced live when it changes? Tool rows in a log container with aria-live=polite on the parent message-list. Adding role="status" per row would spam. Keep static.

Also add `data-tone` for CSS hooks and avoid the old `dot-*` class collision (the `.dot` class is presumably used elsewhere, e.g. connection status; keep `.dot` usage? I'm renaming to `.tool-dot` to avoid cross-component style bleed. Note that in the CSS I'd scope under `.tool-row .dot` too. I'll mention the risk: global `.dot`/`.thinking-dot` classes are shared; the ripple is that the statusClass() returns 'dot-warn' etc. which are global utility classes — renaming to `--ok`/`--danger` modifiers scoped to `.tool-row` avoids bleed.

CSS for tool row:

```css
/* ============ CDS §3.5 — tool activity card ============ */
.tool-row {
  --tool-tone: var(--tools);
  --tool-tone-soft: color-mix(in srgb, var(--tools) 12%, transparent);
  position: relative;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  margin: 6px 0;
  padding: 8px 10px 8px 8px;
  border: var(--ring-hairline) solid var(--ring);
  border-radius: var(--r-sm);
  background: var(--panel-2);
  box-shadow: var(--hl, inset 0 1px 0 rgba(255,255,255,.9));
  font-size: 12.5px;
  line-height: 1.45;
  transition: border-color var(--dur-fast) var(--ease-swift),
              background-color var(--dur-fast) var(--ease-swift);
}
.tool-row--ok { --tool-tone: var(--ok); --tool-tone-soft: var(--ok-soft); }
.tool-row--running { --tool-tone: var(--warn); --tool-tone-soft: var(--warn-soft); }
.tool-row--danger { --tool-tone: var(--danger); --tool-tone-soft: var(--danger-soft); }

/* left hairline rail — CDS 3.2/3.5 accent */
.tool-row::before {
  content: '';
  position: absolute;
  inset: 6px auto 6px 0;
  width: 2px;
  border-radius: var(--r-pill);
  background: var(--tool-tone);
  opacity: .55;
  transition: opacity var(--dur-base) var(--ease-swift);
}
.tool-row:hover { border-color: var(--ring-2); }
.tool-row:hover::before { opacity: 1; }

.tool-rail { display: grid; place-items: center; padding-top: 2px; }
.tool-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--tool-tone);
  box-shadow: 0 0 0 3px var(--tool-tone-soft);
}
.tool-row--running .tool-dot { animation: tool-pulse 1.6s var(--ease-swift) infinite; }
@keyframes tool-pulse {
  0%   { transform: scale(.86); box-shadow: 0 0 0 0 var(--tool-tone-soft); }
  60%  { transform: scale(1);   box-shadow: 0 0 0 6px transparent; }
  100% { transform: scale(.86); box-shadow: 0 0 0 0 transparent; }
}
```

Careful with reduced motion: global rule `animation-duration: .01ms !important; animation-iteration-count: 1 !important` will make the pulse stop — good, but then the dot's final state... it'll just be static with box-shadow from the base rule. Fine. But explicitly add:

```css
@media (prefers-reduced-motion: reduce) {
  .tool-row--running .tool-dot { animation: none; box-shadow: 0 0 0 3px var(--tool-tone-soft); }
}
```

Head/status/dur/args:

```css
.tool-head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.tool-name {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tool-status {
  flex: none;
  padding: 0 6px;
  border-radius: var(--r-pill);
  background: var(--tool-tone-soft);
  color: var(--tool-tone);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .02em;
  text-transform: lowercase; /* or none per i18n */
}
```
Hmm — text-transform on localized status text may be wrong for CJK; better avoid. Skip text-transform, or use `font-variant-caps`. I'll note to skip.

```css
.tool-dur {
  margin-left: auto;
  flex: none;
  color: var(--text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.tool-args {
  margin-top: 3px;
  color: var(--text-2);
  font-family: ui-monospace, ...;
  font-size: 11.5px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```
Wait — `.tool-main` needs to be a grid child. Let me define `.tool-main { min-width: 0; }`.

Also `.tool-badge { grid-column: 3; }` — actually sandbox badge should be on the right of the head row ideally. Let me restructure grid: columns `18px minmax(0,1fr) auto`. Head inside main; badge as third column aligned to head row. Hmm badge may be wide. Alternative: keep badge inside `.tool-main` as inline element at end of head. Simpler and robust: put badge inside head. But then status/dur/badge compete. Let me place badge as third grid column, top-aligned; grid handles it.

Actually in my TSX I put sandbox badge outside `.tool-main` as sibling — matches 3-column grid. Good. Add `.tool-badge { display:flex; align-items:center; padding-top: 1px; }`.

Row states for done/error: `done` could subtly reduce emphasis (opacity .92?) Hmm, better: done rows keep neutral tone but status chip green. What about the left rail for `done`? Using --ok for the rail on every done tool is loud. CDS 3.5 says tool cards use `--tools` teal for the rail when neutral. Maybe: rail uses tone color only for running/danger; for ok use `--tools` teal at lower opacity. Let me define:
- `.tool-row--ok { --tool-tone: var(--ok); ... }` — the dot is green, chip green, rail could be var(--tools) neutral. I'll set rail color separately with `--tool-rail: var(--tools)` and override for danger/running. Keep it simple: rail = `var(--tools)` for ok, `var(--warn)` running, `var(--danger)` danger. That's a nice nuance; I'll implement with two custom props: `--tool-accent` (rail) and `--tool-tone` (dot/chip).

Let me finalize:
```
.tool-row { --tool-accent: var(--tools); --tool-tone: var(--ok); --tool-tone-soft: var(--ok-soft); }
.tool-row--running { --tool-accent: var(--warn); --tool-tone: var(--warn); --tool-tone-soft: var(--warn-soft); }
.tool-row--ok { --tool-accent: var(--tools); --tool-tone: var(--ok); --tool-tone-soft: var(--ok-soft); }
.tool-row--danger { --tool-accent: var(--danger); --tool-tone: var(--danger); --tool-tone-soft: var(--danger-soft); }
```
Good.

Also mention: on `done`, collapse args by default? Could add an optional disclosure. Maybe too much. Mention as optional: wrap args in a `<details>` when long (>120 chars) to keep cards compact. I'll offer it as an optional enhancement (P2).

Now StreamingReasoningBlock.

Issues:
1. `<details open={expanded}>` — React `open` prop on details is controlled-ish: React will set the attribute; user clicking summary is preventDefault'd so state drives it. OK. But `open={expanded}` + preventDefault means fine. However keyboard activation (Enter/Space on summary) also triggers click → preventDefault → toggles state. OK.
2. No animation on expand/collapse — needs `interpolate-size: allow-keywords` and `::details-content`.
3. The clock: `useEffect` updates every 100ms → re-renders whole block 10x/sec during streaming. Should throttle to 1s? But the label shows 0.1s precision when >1s... `timeSeconds` uses toFixed(1) — 100ms updates make the tenths digit tick. That's a perf concern for long streams; suggest `requestAnimationFrame`-free 250ms or switching granularity. Actually mention: gate to 200ms is a reasonable compromise; or better, only re-render the time text in an isolated child component to avoid re-rendering `<pre>` content (which for long reasoning text is expensive). That's a real perf finding: re-rendering a `<pre>` with large content 10x/second. Recommend extracting `<ElapsedLabel>` child.

4. `started.current = Date.now()` resets on every isStreaming effect run — if isStreaming stays true, effect doesn't re-run so fine.

5. `if (!content && !isStreaming) return null;` — early return after hooks: fine.

6. When streaming ends, `setExpanded(false)` collapses immediately, hiding the reasoning before user can read. Suggest: auto-collapse only if user hasn't manually interacted (`userToggled` ref), and keep default expanded state when `defaultExpanded ?? false` after stream end. Actually current behavior: streaming→expanded, done→collapsed. Many UIs collapse after done. But abrupt. Suggest: keep collapsed but with smooth height transition + preserve scroll anchor. Also respect manual toggle: if the user collapsed during streaming, don't force-expand on next stream? Minor. I'll include a `touched` ref.

7. `rate` — complex nested ternary; refactor into a helper. Also `tokenRateUnavailable` string is rendered as ` · ${unavailable}` — weird. Better: omit the rate span when unavailable rather than showing "unavailable" text. Flag it.

8. accessibility: summary has `aria-label={label}` but content inside also includes rate → aria-label overrides, so rate is not announced. Suggest instead: put `aria-label` combining label+rate, or drop aria-label and use visible text with `.visually-hidden` for the rate. Also `onClick` preventDefault on summary means no default toggle; but `details` with `open` attribute + preventDefault: assistive tech may announce expanded state from `open`. OK.

9. matchedRules `<details>` nested — fine. Note `.reasoning-rule` styling typically missing; include a compact style.

10. The `<pre className="thinking-content">` — should be scrollable with max-height, `overscroll-behavior: contain`, monospace with readable line-height, and preserve whitespace.

CSS for thinking block:

```css
.streaming-reasoning { --think-line: var(--think); }

.thinking-block {
  position: relative;
  margin: 6px 0 10px;
  padding: 2px 0 2px 12px;          /* space for the hairline rail */
  border-left: var(--ring-hairline) solid var(--ring);  /* hairline? better: 2px colored */
  interpolate-size: allow-keywords;  /* CDS 3.2 — animate to/from auto height */
}
```
Hmm, `interpolate-size: allow-keywords` goes on the element whose children animate (it's inherited? It's not inherited: it applies to the element, and animatable values it declares... Actually `interpolate-size: allow-keywords` must be set on the element that has the animatable height/block-size — and it's inherited? Per spec, `interpolate-size` is inherited. Yes — MDN: "Inherited: yes". So set on `:root`/`.tokens` or on `.thinking-block`. I'll set on `:root`-ish (the `.tokens` class or `html`) so all disclosures can animate.

For `<details>` animating: modern approach:

```css
details.thinking-block::details-content {
  block-size: 0;
  overflow: hidden;
  transition: block-size var(--dur-slow) var(--ease-swift),
              content-visibility var(--dur-slow) allow-discrete,
              opacity var(--dur-slow) var(--ease-enter);
  opacity: 0;
}
details.thinking-block[open]::details-content {
  block-size: auto;
  opacity: 1;
}
```
With `interpolate-size: allow-keywords` on the root, `block-size: auto` interpolates. Note browser support: `::details-content` in Chrome 131+, Safari 18.4+? Firefox? Provide `@supports` fallback with grid-template-rows trick or just keep instant toggle. I'll note graceful degradation and provide a `@supports selector(::details-content)` guard... Actually just writing the rules is fine; browsers that don't support the pseudo-element ignore it (invalid selector → whole rule dropped). Good — degradation is automatic.

Alternative for broader support: `details > summary + *` with grid-template-rows 0fr/1fr trick on a wrapper div. But `<details>` content isn't wrapped. We could keep `<details>` and animate only `opacity`+`translateY` of `.thinking-content` via a keyframe on mount... For robust cross-browser, I'll offer the primary (`::details-content` + interpolate-size) and a fallback (`@supports not (selector(::details-content))` → simple fade/slide via `animation` on the content when `[open]`).

Hmm, the fallback: content is display:none when closed, so animating in requires `[open] .thinking-content { animation: think-in var(--dur-base) var(--ease-enter) both; }`. That works since when opened the element mounts from display:none → animation runs. Good enough (no close animation).

Also the summary marker: `details > summary { list-style: none }` + `::-webkit-details-marker { display: none }` — need the chevron/disclosure replaced by a rotating caret since current summary uses a dot/mark span only. Add caret:

In TSX: add `<span className="thinking-caret" aria-hidden="true" />` and CSS rotate 90deg when `[open]`. But the summary already has `thinking-dot`/`thinking-mark` state indicator. Recommendation: keep the state indicator as the left rail dot, and use the dot→caret? Simpler: keep the existing spans and style the `thinking-mark` as a small chevron? No — the mark signals "completed". 

I'll add a caret at the end and put the rate before it. Layout: `[state dot] label · rate ............ [caret]`.

Also time/rate use `tabular-nums`: `font-variant-numeric: tabular-nums;` (body already sets it globally, but nested monospace maybe resets; explicitly set).

Also `--think` hairline: left border 2px with `color-mix` gradient? CDS 3.2 — "左侧 --think: #7c5ce0 思考色发丝强调线与动态状态点". So: `.thinking-block { border-left: 2px solid color-mix(in srgb, var(--think) 55%, transparent); }` and while streaming the dot pulses in --think.

Let me write the thinking CSS:

```css
.thinking-block {
  interpolate-size: allow-keywords;
  position: relative;
  margin: 8px 0 12px;
  padding: 6px 10px 6px 12px;
  border-radius: var(--r-sm);
  border: var(--ring-hairline) solid transparent;
  border-left: 2px solid color-mix(in srgb, var(--think) 45%, transparent);
  background: linear-gradient(90deg, color-mix(in srgb, var(--think) 7%, transparent), transparent 42%);
  color: var(--text-2);
  transition: border-left-color var(--dur-base) var(--ease-swift),
              background-color var(--dur-base) var(--ease-swift);
}
.thinking-block[open] { border-left-color: var(--think); }
```

Summary:
```css
.thinking-block > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  list-style: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-2);
  user-select: none;
}
.thinking-block > summary::-webkit-details-marker { display: none; }
.thinking-block > summary:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-sm); }
```

State dot:
```css
.thinking-dot, .thinking-mark {
  flex: none; width: 6px; height: 6px; border-radius: 50%;
}
.thinking-dot { background: var(--think); animation: think-pulse 1.4s var(--ease-swift) infinite; }
.thinking-mark { background: color-mix(in srgb, var(--think) 55%, var(--panel)); }
@keyframes think-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--think) 45%, transparent); }
  70% { box-shadow: 0 0 0 6px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
```

Rate + caret:
```css
.reasoning-rate { color: var(--text-3); font-size: 11px; font-variant-numeric: tabular-nums; margin-left: 2px; }
.thinking-caret {
  margin-left: auto; width: 8px; height: 8px; flex: none;
  border-right: 1.5px solid var(--text-3); border-bottom: 1.5px solid var(--text-3);
  transform: rotate(45deg) /* closed? */;
  transition: transform var(--dur-fast) var(--ease-swift);
}
.thinking-block[open] .thinking-caret { transform: rotate(225deg); }
```
Hmm, direction: rotate(45deg) makes a down-right chevron? A square with right+bottom borders rotated 45° shows a chevron pointing down-right... Let's use: closed → `rotate(-45deg)` (points right), open → `rotate(45deg)` (points down). Yes standard: caret uses border-right+border-bottom rotated 45deg = pointing down; rotated -45deg = pointing right. Good.

Content:
```css
.thinking-content {
  margin: 8px 0 0;
  padding: 0 0 0 14px;
  max-height: min(48vh, 420px);
  overflow: auto;
  overscroll-behavior: contain;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-2);
  scrollbar-gutter: stable;
}
```
Note `white-space: pre-wrap` on pre is default pre-wrap? `<pre>` default is `white-space: pre` — long lines overflow horizontally. So setting pre-wrap is a fix. Good finding: current `.thinking-content` unknown; recommend pre-wrap.

matched rules styling:
```css
.reasoning-rules { display: flex; flex-direction: column; gap: 4px; margin: 0 0 6px; }
.reasoning-rule { border: var(--ring-hairline) solid var(--ring); border-radius: var(--r-sm); background: var(--panel-2); padding: 6px 8px; font-size: 11.5px; }
.reasoning-rule > summary { cursor: pointer; color: var(--text-2); }
.reasoning-rule p { margin: 4px 0 0; color: var(--text-2); }
.reasoning-rule small { display: block; margin-top: 4px; color: var(--text-3); }
```
Note: `--policy` token exists; use it for the rules accent: `border-left: 2px solid var(--policy)`.

Now message bubbles / markdown: `.msg`, `.msg-role`, `.msg-body`. Since CSS wasn't provided for those, I'll specify props with `text-wrap: pretty`, and code styles:

```css
.msg { max-width: min(760px, 100%); }
.msg-body {
  text-wrap: pretty;
  overflow-wrap: anywhere;
  word-break: normal;
  hyphens: auto; /* only if lang set */
}
.msg-body code:not(pre code) {
  padding: 0.1em 0.35em;
  border: var(--ring-hairline) solid var(--ring);
  border-radius: var(--r-0); /* 4px */
  background: var(--panel-2);
  font-family: ui-monospace, ...;
  font-size: 0.92em;
  font-variant-ligatures: none;
  color: var(--text);
}
.msg-body pre {
  margin: 8px 0;
  padding: 10px 12px;
  border: var(--ring-hairline) solid var(--ring);
  border-radius: var(--r-md);
  background: var(--panel-2);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  font-size: 12px;
  line-height: 1.6;
  tab-size: 2;
}
@media (color-scheme: dark) ... 
```
Actually code block background in dark: `--panel-2` is #131725 which is slightly lighter than panel #0d0f18. Fine both ways.

Also: blockquote, tables, lists, and copy button suggestion.

Add `text-wrap: pretty` caution: it's Chromium 117+/Safari 17.5+; harmless fallback.

Also `.msg-assistant` bubble vs user bubble: user uses `--bubble-user: var(--accent-soft)`. Mention keeping.

Now MessageList-level: the `hidden` attribute wrapper kills the exit animation. Note: when collapsing a card, `<div hidden>` snaps. Could use `content-visibility`. Minor; mention.

Also `MessageList` renders `item.msg?.text ?? ''` as raw text — no markdown renderer? "Markdown 代码美化" implies markdown is rendered elsewhere or not at all. I should flag: if `msg.text` is rendered as plain text, code fences will show literally. Check: `{item.msg?.text ?? ''}` — plain text. The task assumes markdown code beautification; I should note the gap and recommend either rendering with the existing markdown component (if any) or applying `white-space: pre-wrap`. That's an important honest finding: there's no markdown pipeline visible in MessageList; if a markdown renderer exists elsewhere, these styles must target its output (`.msg-body pre`, `.msg-body code`). I'll phrase it carefully: "MessageList 直接渲染纯文本…若非纯文本，则 CSS 需覆盖渲染器输出".

Now also the `.tool-row` old classes: `tool-dot-ok` etc. from statusClass — if we change class names, ensure no other CSS references `dot-ok`, `dot-warn`, `dot-err`. Let me grep mentally: styles.css shown includes `.subagent-badge.status-running` etc. `dot-ok/dot-warn/dot-err` probably defined in styles.css (not shown). I'll instruct Codex to grep and update both the definitions and any other consumers (e.g., connection status). Actually safer: KEEP the existing `dot-ok` classes on the dot element for backward compat, and ADD the new modifiers on the row. Hmm, but the row classes `tool-dot-ok` (i.e., `tool-${statusClass}`) produce `tool-dot-ok` — a class that may have no rule at all currently! `className={`tool-row tool-${statusClass(delta.status)}`}` → `tool-row tool-dot-ok`. Yes! `tool-dot-ok` is a dead class unless defined. That's a real finding: the row modifier classes are `tool-dot-ok|tool-dot-warn|tool-dot-err` and likely undefined in CSS → no visual state on the row. And `.dot` + `.dot-ok` on the span presumably styled elsewhere. Good catch to call out — instruct to grep for `tool-dot-`.

So my new `--ok/--running/--danger` modifiers replace dead classes. And I keep `.dot dot-ok` classes? In my refactor I renamed the span to `.tool-dot`. To be safe: keep both — `<span className={`tool-dot dot ${statusClass(delta.status)}`} aria-hidden="true" />`. Hmm, that inherits global dot styles (e.g. size/color) which might conflict. I'll recommend keeping `.tool-dot` and removing `.dot dot-*` from this component only, after grepping that `.dot-*` is used by other components (connection indicator) so leaving those rules alone. Provide instruction: "don't delete global `.dot-*` rules; just stop using them here."

Also add: `title` attribute for truncated args already there; add `aria-label` too? title is enough.

Now the tabular-nums for `.tool-dur`.

Also: I18n — `t('noTool')`, `localizedValue(delta.status, t)`. Fine.

Accessibility additions: `aria-hidden` dot; add `<time>` semantics? Not needed.

Additional: add `data-call-id={delta.callId}` if exists in ToolDelta — unknown fields; avoid.

Let me check ToolDelta fields used: status, toolName, durationMs, argsSummary, sandbox. Fine.

Now the motion tokens block and where to put it. `.tokens` block addition:

```css
  /* CDS §3.1 动效令牌：5 档时长 + 专业缓动曲线 */
  --dur-0: 90ms;      /* instant  — 状态点闪烁 */
  --dur-1: 140ms;     /* fast     — hover / chip */
  --dur-2: 220ms;     /* base     — 卡片状态切换 */
  --dur-3: 320ms;     /* slow     — 折叠展开 */
  --dur-4: 480ms;     /* slower   — 面板级转场 */
  --ease-swift: cubic-bezier(0.22, 1, 0.36, 1);   /* 进入/位移，快速收敛 */
  --ease-enter: cubic-bezier(0.16, 1, 0.3, 1);    /* expo-out，内容入场 */
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);        /* 退出，加速离场 */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* 轻微回弹（仅装饰） */
  /* 兼容既有命名 */
  --ease-standard: var(--ease);
```
Named ranges: user asked `--dur-fast 到 --dur-slow`. Let me name them `--dur-fast`, `--dur-base`, `--dur-slow`, plus `--dur-instant` and `--dur-slower`. Better to match the ask: five steps: `--dur-instant: 90ms; --dur-fast: 140ms; --dur-base: 220ms; --dur-slow: 320ms; --dur-slower: 480ms;`

And `--ease-swift`, `--ease-enter` (required), plus `--ease-exit`, `--ease-spring` optional.

Also should I put `interpolate-size: allow-keywords` on `.tokens` (which is `<html>`)? Since it's inherited, yes: add to `.tokens` block. Good — one line, global.

Also `color-scheme`? not needed.

Also consider adding `@media (prefers-reduced-motion: