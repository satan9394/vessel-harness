# Card 365 execution evidence

Executed 2026-10-29 (America/Los_Angeles); directory date follows the supplied handoff. Baseline **5dc1c421a93340b4ed9534c40187cffb37043161**, clean before work. Main thread only; requested route gpt-6.1-sol / medium, Fast off. No model override, other Agent CLI, subagent, commit, push, or full gate was invoked.

| Acceptance | Verdict | Evidence |
| --- | --- | --- |
| A1 | **通过 / PASS** | `rg -n outputCopy apps/web/src` returns exit 1 / no matches. Production copy comes from five typed `uiTeamOutput*` keys. Expected literal strings remain in the required exact-copy regression assertions. |
| A2 | **通过 / PASS** | Existing `i18n.test.ts` passes. Five parameterized assertions in `TeamNodeDrawer.test.tsx` compare all ten exact zh/en strings. `scope-audit.json` independently evaluates both dictionaries against HEAD: exactly five additions per language, every existing value unchanged. |
| A3 | **通过 / PASS** | Original five cases/assertions retained: 298/300 unchanged, 570 round trip/cache, safe error, cap notice. Added real LanguageProvider switch en → zh on the same expanded task, exact dictionary assertions, DOM order/button identity/focus/cache assertions, and pending-fetch focus tests with/without user focus movement. |
| A4 | **通过 / PASS** | Visible IAB, **1440×900**, dark background `rgb(13, 17, 23)`. Exact outputs **570** and **4800**; each expands → collapses to **301** → expands from cache → collapses to **301**. In both samples and every state, toggle **top 458.13128662109375 / bottom 490.1241912841797 / innerHeight 900**. Active element remains the toggle after initial asynchronous load and cached transitions. Final images: `570-expanded.jpg`, `4800-expanded.jpg`; measurements/network/console: `browser.json`. Console warnings/errors **[]**. |
| A5 | **通过 / PASS** | Final web suite **61 files / 543 passed**, exit **0**; web tsc exit **0**. Fresh production build exit **0**. Full gate intentionally left to coordinator. |
| A6 | **通过 / PASS** | Runtime/server/CLI sources untouched. Short/exact-length regression tests pass. Final browser trace records **one GET per sample**, including both expansions; trace neither truncated nor paginated. |

## Implementation and browser findings

The existing `.btn` now sits in a control row immediately above the `<pre>` in both states. No CSS change or inner scrolling container: computed output `max-height: none`, `overflow-y: visible`. The button retains `aria-expanded`, native loading `disabled`, and its DOM identity. Existing close-button label is unchanged; the output toggle continues to use its visible localized text as its accessible name.

The initial browser run exposed native focus loss when loading disables the focused button. The drawer now records the focused toggle before requesting the result and restores focus after loading only if focus is still on body; focus deliberately moved to another control is respected. This lives in the existing stateful drawer, keeping the display helper compatible with its existing callers.

The first focus-repair suite failed **2 tests** because hooks had been added to a helper that existing tests invoke directly. Preserved full stdout/stderr in `web-tests-focus-repair-failed.json`. Moving the focus lifecycle to the stateful parent fixed the failure without changing those tests or widening scope. All final checks and final screenshots follow the last source edit. `browser-initial.json` and `browser-focus-repair.json` retain earlier measurements, including the initial focus loss.

Served **the repository's freshly rebuilt `apps/web/dist`**, not a copied/stale bundle. Final entry assets: `index-BnpHX6ao.js` and `index-DUltVpcM.css`; build/source SHA-256 values are in `scope-audit.json`. Actual app UI and existing backend dist were used with a synthetic loopback OpenAI-compatible provider. Fixtures and user-state roots were isolated under TEMP; no paid/external provider request. Backend behavior was not modified or reimplemented. No browser downloads occurred.

## Commands and results

| Command | Final result | Record |
| --- | --- | --- |
| `node node_modules/vitest/vitest.mjs run --root apps/web` | **0**, 61 files / 543 passed | `web-tests.json` |
| `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit` | **0** | `web-types.json` |
| `npm run -w @vessel/web build` | **0**, existing >500 kB chunk warning | `web-build.json` |
| `node evidence/sessions/2026-10-30-drawer-polish/audit.mjs` | **0** | `scope-audit.json` |
| `git diff --check` | **0** | Final execution output |

Initial focused drawer/i18n run: 2 files / 25 tests passed. Final full web run includes those files plus all existing web regressions. No full root suite, endpoint tests, conformance, or full gate was run.

## Cleanup and failures

Ports **5700/5701** were checked free before each fixture launch. Owned fixture PIDs **27156** and **4740** stopped through the fixture's shutdown endpoint. Final independent audit: **0 listeners / 0 owned processes**; both created IAB tabs closed, viewport override reset. TEMP fixtures retained; no permanent deletion. See `cleanup.json`. Non-test tool/search errors are preserved in `failures.json`; no approval/policy rejection occurred.

## Final scope and handoff

Product/test changes, exactly matching the card's allowed files:

- `apps/web/src/components/team/TeamNodeDrawer.tsx`: dictionary lookups, control order, focus lifecycle.
- `apps/web/src/components/team/TeamNodeDrawer.test.tsx`: original assertions retained, real provider and new regression coverage.
- `apps/web/src/i18n.ts`: five declarations plus five values in each language; existing values untouched.

No stylesheet changes. Only additional tracked changes are this new evidence directory and an append to card 365. Card's existing bytes/status, `tasks/README.md`, packages, backend, CLI, endpoint, runtime truncation and existing i18n values are preserved (`scope-audit.json`).

Final web count **61 files / 543 passed**; web tsc **exit 0**. Ports **5700/5701**, **0 listeners / 0 owned processes**. Next: coordinator review, acceptance/index closeout, and coordinator full gate. No remaining implementation item in this card's scope.
