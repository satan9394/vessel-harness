# Vessel UI 最终验收 — 2026-10-23

**Conclusion: audit completed; UI final acceptance is NOT granted.** Two UI defects were reproduced: deletion confirmation ignores Escape and loses focus, and the English 360px footer overlaps the Goals area. True 150%/200% browser page zoom remains unverified. The real-model Shell call was denied by the active policy, so successful command execution was not established. No product fixes were made.

Environment: Windows, Codex in-app browser (IAB), `http://127.0.0.1:5678/`, HEAD `4827275`; fixture `C:\Users\SATANC~1\AppData\Local\Temp\vessel-ui-901296ac`. All dates refer to 2026-10-23. Scope: task 275 and its final-acceptance prompt.

| Item | Verdict | Observation | Evidence |
|---|---|---|---|
| A Zoom | Unable to verify page zoom | Menu unavailable; keyboard unchanged; CDP changed DPR only | [A1](A1-zoom.png), [A2](A2-browser-menu-attempt.png), measurements below |
| B Keyboard/accessibility | Fail overall | Keyboard route reachable; ten computed names readable; Escape leaves delete confirmation open and focus moves to BODY | [B1](B1-focus.png), [B5](B5-delete-keyboard-escape.png) |
| C Visual matrix | Fail sample | Twelve cells captured and inspected; English 360px footer overlaps Goals; no document horizontal overflow in measured cells | Twelve numbered cells below |
| D Real-model E2E | Partial, not accepted | Two real requests; denied Shell shown honestly; Diff empty; history survives reload; deletion reaches Recycle Bin | [D1](D-e2e-01.png), [D2](D-e2e-02-diff.png), [D3](D-e2e-03-refresh.png), [D4](D-e2e-04-deleted.png) |
| E1 Deletion | Pass, injected failure disclosed | Success persists; index failure exposes specific reason and retains readable history; retry succeeds | [Failure](E1-failure-reason.png), [retained](E1-failure-after-refresh.png), [final reload](E1-after-refresh.png) |
| E2 Input | Pass | Shift+Enter and pasted blank lines retained; one Enter produces one exact user record | [Before](E2-multiline-before.png), [after](E2-multiline-after.png) |
| E3 Length notice | Pass with offline provider fixture | Explicit length termination notice remains on the restored message after reload/reopen | [Before](E3-length-before.png), [after](E3-length-after-refresh.png) |
| E4 Activity Stop | Pass with offline provider fixture | Activity shows Interrupted; linked session opens; persisted terminal state is CANCELLED | [Activity](E4-activity-interrupted.png) |

## Environment, provenance, and limits

- Startup checked port availability. `npm run -w @vessel/web build -- --emptyOutDir false` exited 0 (Vite 8.3.0, 98 modules). The build reported a large-chunk advisory. `curl.exe --noproxy '*' -I http://127.0.0.1:5678/` returned HTTP 200 and `text/html; charset=utf-8`; this is startup evidence only.
- First ran the requested CLI `serve --port 5678 --workspace <fixture>`. Its default registry listed existing projects and sessions. Only the new temporary project was selected; no pre-existing session was opened, deleted, or edited. The first Mock session was created in the fixture and recycled.
- For D and deterministic E regressions, restarted the same port with an inline fixture composition using existing application/local-server/LLM `dist` modules and the freshly built Web assets. No fixture script or product source was written to the repository. The backend used the installed compiled runtime, as the normal workspace package entry points do; this audit did not rebuild/typecheck the backend or run the full test suite.
- Session/project/provider/review registries and the named runtime state roots were directed under `<fixture>/state`. Actual session logs were under `<fixture>/.harness/sessions`. Existing ancillary runtime stores were not comprehensively snapshotted, so this is not a claim that every user-home runtime byte was unchanged.
- Real provider: `commandgota-real`, OpenAI-compatible, `https://api.commandcode.ai/provider/v1`, model `deepseek/deepseek-v4.1-flash`. Credentials were loaded by dot-sourcing `scripts/use-env.ps1` and passed programmatically to a memory credential backend. No secret values were printed, placed in the browser, or included in this report. The provider wrapper capped upstream starts at three; observed console counters were `REAL_CALL=1` and `REAL_CALL=2`, matching UI usage of two calls. No third call was made.
- `offline-acceptance / fixture` was an explicitly injected provider: no network requests; normal response emitted `Offline truncated answer` then `finishReason=length`; `STOP_FIXTURE` emitted a delayed stream so the real Stop path could be exercised. A temporary SessionRegistry subclass threw once on removal of that provider's session. These are controlled input/failure fixtures, not simulated UI screenshots or claims about real model token truncation.
- The Mock preset is built in: Provider Hub showed protocol `mock`, model `mock`, and no endpoint/key requirement. It was selected through the model picker.
- No external agent CLI, commit, push, release, or publish was performed. The task card/index were left unchanged because the prompt permits only this report and screenshots.

## A. Browser zoom

Measurements below are actual browser `innerWidth`, `devicePixelRatio`, and `visualViewport.scale`, not inferred screenshot magnification.

| Method | Result | innerWidth | DPR | visualViewport.scale |
|---|---|---:|---:|---:|
| Baseline | Default IAB viewport | 1280 | 2.1137499809265137 | 1 |
| Ctrl+plus | No visible/metric change | 1280 | 2.1137499809265137 | 1 |
| CDP deviceScaleFactor=1.5 | Command returned `{}`; raster density changed | 1280 | 1.4999999537566566 | 1 |
| CDP deviceScaleFactor=2 | Command returned `{}`; raster density changed | 1280 | 2.0000000223350867 | 1 |
| Browser menu attempt, Alt+F | AX unchanged; no browser zoom menu exposed in this IAB surface | 1440 | 1.0000000111675433 | 1 |

The menu attempt occurred later with the visual-matrix viewport override active; its 1440px width is not a zoom result. DPR-only emulation does not establish 150%/200% browser page zoom. The requested browser zoom-menu controls were unavailable, the keyboard attempt had no measurable effect, and CDP density changes did not reflow the viewport. **Unable to verify true page zoom.** No 960px viewport or enlarged screenshot was used as substitute evidence. Device metrics were cleared and the temporary viewport override reset after testing.

## B. Keyboard and accessible names

The isolated offline session was created through keyboard traversal: Shift+Tab from the task input through project/preferences/commands/theme/navigation/search to New Session; Return; Tab back to task input/model selector; Return opened the picker; typing `fixture`, Down, Return selected the offline model; Shift+Tab returned to the input; typing and Return created the session. From the conversation input, Shift+Tab traversed mode controls, audit/message cards, model controls, and Inspector; Return closed and reopened Inspector. Later Shift+Tab reached the deletion icon, Return opened its confirmation, and Tab reached Confirm. No mouse click was needed for this keyboard route.

Focus rings were visible on the composer and confirmation controls; the tested desktop confirmation was not obscured. Tab could leave the controls and continue through the page; no deadlock was observed. **Opening deletion confirmation removes the focused trigger and leaves `document.activeElement.tagName === 'BODY'`. Escape leaves the confirmation visible.** Tab can eventually reach Confirm/Cancel, but Escape does not return to the previous state. The visible focused Confirm is captured in B5. Ctrl+I attempts did not toggle Inspector in this IAB run; the keyboard-accessible Inspector button did work. No global shortcut success is claimed.

Ten-control sample from Chromium `Accessibility.getFullAXTree` (computed names, not guessed from icon appearance):

| # | Control | Readable computed name | Result |
|---|---|---|---|
| 1 | Sidebar icon button | 收起侧边栏 | Pass |
| 2 | Main action | + 新建会话 | Pass |
| 3 | Session search | 搜索会话… | Pass |
| 4 | Archive visibility checkbox | 显示已归档 | Pass |
| 5 | Inspector button | 收起检视器 | Pass |
| 6 | Model selector | offline-acceptance / fixture | Pass |
| 7 | Message textbox | 输入消息…（Enter 发送，Shift+Enter 换行） | Pass |
| 8 | Send | 发送 | Pass |
| 9 | Stop | 停止 | Pass |
| 10 | Goal textbox | 输入目标，加入本项目的任务队列… | Pass |

The higher-level AX snapshot omitted some textbox names, but Chromium's computed tree supplied them. This is not an unnamed-input defect. This sample does not constitute a full screen-reader or WCAG audit.

### Finding B-F1 — deletion confirmation ignores Escape and loses focus

Reproduce: open a disposable session; Tab to its Delete icon; Return; press Escape. Expected: cancel confirmation and restore focus to its trigger. Actual: confirmation stays open; focus is BODY. Tab remains usable. Evidence: [B5](B5-delete-keyboard-escape.png); DOM observation `{"confirmationVisible":true,"focus":"BODY"}`. Suggested severity P2. No fix made.

## C. Twelve-cell visual sample

All final matrix images are actual PNGs, exact listed width × 900, captured from the same populated Mock conversation with Inspector closed. Each image was opened and visually inspected after its final capture. The inherited 120-cell campaign is sampled here, not re-certified in full. Ellipsis of a long title/placeholder is distinguished from overlap or loss of an actionable label.

| Cell | Width/theme/language | Horizontal overflow | Truncation/wrapping | Control overlap | Screenshot |
|---|---|---|---|---|---|
| C01 | 360/dark/zh | None | Header/model/goal text shortened; mode labels wrap vertically | None observed in this cell | [C01](C-360-dark-zh.png) |
| C02 | 768/dark/zh | None | Goal placeholder shortened | None observed | [C02](C-768-dark-zh.png) |
| C03 | 1024/dark/zh | None | Session title wraps; goal placeholder shortened | None observed | [C03](C-1024-dark-zh.png) |
| C04 | 1440/dark/zh | None | Sidebar title and goal placeholder shortened | None observed | [C04](C-1440-dark-zh.png) |
| C05 | 1920/dark/zh | None | Sidebar title and goal placeholder shortened | None observed | [C05](C-1920-dark-zh.png) |
| C06 | 1440/light/zh | None | Sidebar title and goal placeholder shortened | None observed | [C06](C-1440-light-zh.png) |
| C07 | 360/light/en | None | Header/model text shortened; Pin wraps | **Footer KEY HINTS overlaps GOALS** | [C07](C-360-light-en.png) |
| C08 | 768/light/en | None | Goal placeholder shortened | None observed | [C08](C-768-light-en.png) |
| C09 | 1024/light/en | None | Session title wraps; goal placeholder shortened | None observed | [C09](C-1024-light-en.png) |
| C10 | 1440/light/en | None | Sidebar title and goal placeholder shortened | None observed | [C10](C-1440-light-en.png) |
| C11 | 1920/light/en | None | Sidebar title and goal placeholder shortened | None observed | [C11](C-1920-light-en.png) |
| C12 | 1440/dark/en | None | Sidebar title and goal placeholder shortened | None observed | [C12](C-1440-dark-en.png) |

At each of the five widths in both measured language/theme series, `innerWidth === document.documentElement.scrollWidth === document.body.scrollWidth` (360, 768, 1024, 1440, 1920 respectively). DPR was approximately 1.0000000112 and visual scale 1. These measurements prove no document-level horizontal overflow, not absence of nested scrolling or clipping. The 360px conversation has a particularly short nested message area.

Capture quality control: the high-level IAB screenshot function initially produced JPEG bytes and clipped 1920px views to 1577px. All twelve final C images were replaced with settled-layout CDP PNG captures (`Page.captureScreenshot`, `fromSurface:true`, `captureBeyondViewport:true`) and their decoded dimensions verified. Other evidence screenshots were losslessly re-encoded from their captured pixels into PNG; no resizing or content retouching was applied. Auxiliary `*-check.png` files are capture diagnostics, not extra matrix cells.

### Finding C-F1 — English mobile footer paints over Goals

Reproduce: populated Mock conversation; Inspector closed; English; viewport 360×900; inspect the composer footer and Goals boundary. Expected: KEY HINTS occupies layout space above Goals. Actual: KEY HINTS/newline help paints across the GOALS label/area. [C07](C-360-light-en.png) shows the collision. In a matching 360px English observation, the hints parent occupied y=810.02–842.92 while the Goals container started at y=774.03 (Goals label y=790.03–808.62). Suggested severity P2. No fix made.

## D. Real-model session

Session `sess_1792771314513_314aabd5` was newly created in the temporary workspace. Prompt:

> Use the Shell tool exactly once to run echo ui-e2e in the current workspace. Do not read or change any files. Then reply ui-e2e.

The real provider made two upstream requests. The tool card showed **Shell — denied**, reason `approval required but approval=never (profile)`. The assistant returned `ui-e2e` and explicitly said the command had not run. Thus the model/tool activity presentation is verified, **successful Shell execution is not**. The audit did not weaken policy or consume additional requests to force a pass.

Inspector → Changes → Code patches opened and displayed `本会话暂无补丁提案。` An echo-only command would not create a patch anyway; this verifies the Diff empty state, not patch creation/application. After browser reload, reopening this session from history restored the user prompt, denied tool card, assistant output, and two-call usage. It did not automatically reopen the session on reload.

Deletion via the UI removed the row; refresh did not restore it. Read-only Windows `Shell.Application.Namespace(10)` enumeration found the exact session directory in Recycle Bin, original location `C:\Users\Satanchen\AppData\Local\Temp\vessel-ui-901296ac\.harness\sessions`. Therefore refresh/history/delete/recycle portions pass; full successful-tool E2E is not accepted.

## E. Regression details

### E1 — deletion

Expected: success removes immediately and persists across reload; failure exposes a specific reason and retains the session. Actual: successful deletion settled to an absent row and stayed absent after reload. For offline session `sess_1792775740029_8173b3af`, a one-time injected index-removal failure displayed `无法更新会话索引；历史记录已保留，可重试。` with its session ID and Retry. After reload the row remained; reopening restored both the truncated answer and interrupted history. Retry succeeded, and the directory was independently found in Windows Recycle Bin. **Pass for these success/failure paths.** The injected failure is not evidence of an organic filesystem fault.

Additional observation: during otherwise successful deletion, an intermediate browser state briefly displayed `无法连接本地服务，请先运行 vessel serve（127.0.0.1:5678）。` before returning to the new-task view. The service was still listening. This misleading transient connection message is recorded separately from the final successful deletion result; duration was not measured. Evidence: [D4](D-e2e-04-deleted.png) for settled deletion, [E1-after](E1-after.png) for the earlier capture, and the browser AX observations. It was not treated as a persistent server outage.

### E2 — multiline input

Expected: Shift+Enter adds a newline, pasted blank lines are preserved, Enter submits once. Actual: task composer value was `keyboard-ui-first\npaste-line-1\npaste-line-2`; one Enter created one session and one Mock call. In the conversation composer, pasting leading/interior/trailing blank lines, Shift+Enter, then typing a tail produced exactly `\nE2-a\n\nE2-b\n\nE2-tail`. After one Enter the composer cleared. The temporary session JSONL contained exactly one matching `user/message`, seq 28. **Pass.** The offline response was stopped afterward; this did not use the real provider.

### E3 — length notice persistence

Expected: a length termination notice remains attached to its message after reload. Actual: injected provider `message_end.finishReason=length` traversed the actual backend and persistence path; session JSONL seq 12 recorded `finishReason:"length"`. The UI showed `内容达到模型长度上限，可继续生成。` before reload and after reopening the persisted session. **Pass with deterministic provider input**, not a claim that a real model reached its output-token limit during this run.

### E4 — Activity cancellation

Expected: Stop produces cancelled/interrupted Activity status, not Failed or Completed. Actual: after Stop during the delayed offline response, Activity grouped the session under `已中断 · 1`; its row showed `已中断 会话 LENGTH_FIXTURE keyboard acceptance`. The Session action reopened the correct history. JSONL seq 22 recorded `kind:"interrupted"`, `outcomeReason:"cancelled"`, `executionState:"CANCELLED"`. A later stopped offline response had the same terminal state at seq 32. **Pass.**

## Cleanup and completion boundary

All four sessions created by this audit were confirmed in Windows Recycle Bin under the fixture's original `.harness/sessions` location:

- `sess_1792770802182_e7de0d0e` — initial CLI Mock/input check.
- `sess_1792771314513_314aabd5` — real-model E2E.
- `sess_1792775740029_8173b3af` — offline length/Stop/failure/input checks.
- `sess_1792776065059_cdbeede8` — final matrix Mock scene.

The isolated registry ended as `{"sessions":[]}`; the browser was refreshed to verify no fixture session returned, then the acceptance tab was closed. Chinese/dark preferences were restored and the temporary viewport override reset. The initial CLI service and subsequent fixture service were stopped. Final `Get-NetTCPConnection -LocalPort 5678 -State Listen` found no listener (`PORT_5678_RELEASED`). Temporary fixture files were retained; no permanent cleanup was performed.

Repository tracked product diff remained empty. Deliverables are this report and same-directory screenshots only. No full-test-suite, native IME, screen-reader, full 120-cell, actual page-zoom, successful Shell execution, or non-empty patch acceptance is claimed.

Next: coordinator triage B-F1 and C-F1; separately provide an approved environment where the requested harmless Shell command can execute, and a browser surface exposing genuine page zoom, then repeat the outstanding acceptance checks. This audit does not authorize code changes or policy relaxation.
