# T10 · 260/275 browser acceptance, run 2

Conclusion: **not accepted**. Evidence below is from IAB against isolated fixture data; no real provider or user session was used. Scripted loopback provider supplied deterministic model responses; tool execution, UI, server, persistence and deletion were real. Status labels describe each criterion, not unit-test results.

## A. Matrix — PASS requested measurements; sampled visual observations

`metrics.json` contains **80 distinct cells**: 5 widths × 2 themes × 2 languages × 4 surfaces. Every cell recorded documentElement.scrollWidth = innerWidth, respectively 360, 768, 1024, 1440, 1920. This proves document-level horizontal width only; it does not prove text is untruncated or all controls unobscured. 360 workbench visibly truncates model text with ellipsis; some Chinese labels wrap. Usability of every cell was not established.

Screenshots are archived here. Despite initial .png filenames, bytes began FF D8 FF E0 (JPEG/JFIF); originals were renamed to .jpg without conversion. Original full-view 1920 captures decode to 1577×900 and are cropped at right; they must not be treated as full-width. The four `*-1920-pair-left.jpg` and `*-1920-pair-right.jpg` pairs capture the same settled Chinese/light page at x=0..1000 and x=1000..1920: decoded sizes 1000×900 and 920×900, respectively. These cover those four sampled states, not every theme/language's pixels. Other screenshots sample both themes/languages and widths. No synthesis was used.

150% / 200% genuine browser zoom and native IME: **UNVERIFIED**, per prior run [report](../2026-10-26-iab-acceptance/report.md), not retried. Prior baseline (innerWidth,DPR,visualViewport.scale)=(918,2.1137499809265137,1); Ctrl+= remained identical; CDP deviceScaleFactor 1.5 produced (918,1.4999999537566566,1), changing DPR only. IAB browser zoom menu unavailable, no post-menu value; native IME unavailable. Viewport resizing is not zoom.

## B. Keyboard and names — PASS for exercised route and sampled focus states

Actual keyboard sequence at 1440: Tab through navigation to +新建会话 → Enter → Tab through controls to 高级新会话 → Enter → Tab twice to 创建 → Enter → type and Enter to send → Tab then Ctrl+I twice (close/open Inspector) → Tab through Inspector and sidebar to 删除 → Enter → Esc (focus returned 删除) → Enter → Shift+Tab (确认) → Enter. `keyboard-end-to-end.json` records focus rectangles/styles, `keyboard-delete-focus.jpg` captures delete focus. Sidebar Delete had blue focus shadow, visible rectangle x=201.92 y=337.47 27.99×27.99; Inspector controls had solid outlines. Coordinator independently sampled 17 focused controls at 1280×720: center hit tests were unobscured; screenshots and `coordinator-focus-audit.json` record the sampled states. A focused SELECT had outline none but its `.capsule-select` ancestor showed a blue 2.5px shadow; after blur the shadow disappeared (`coordinator-focus-indicator-ancestors.json`, permission focus/blur screenshots). Esc from confirmation restored Delete at x=186.78, y=345.99, 27.99×27.99. Two Ctrl+I presses from the composer and Esc from dock Close had no effect in the coordinator's separate attempts; those attempts do not establish a general shortcut failure. The audit is bounded to the exercised controls and viewports.

Ten actual AX names observed: 收起侧边栏, + 新建会话, 搜索会话…, 显示已归档, 工作台, 活动, Agent Studio, 设置, 打开检视器, 删除. Also 输入消息…（Enter 发送，Shift+Enter 换行） and 关闭检视器. Shift+Enter produced two lines in the composer and Enter sent both. Native IME remains unverified.

## C. Focus and draft isolation — PASS for exercised fixture paths

Fresh workbench AX focus was `textarea#taskInput`. Entered `draft A fixture` in workspace A, switched project selector to manual path B: `#taskInput.value=''`; entered `draft B fixture`, switched back to A: value `draft A fixture`. B was a second owned system-temp directory; no user data used. This tests UI drafts, not an independently restarted browser persistence claim.

## D. Effective Policy — PASS

Agent Studio's `region 当前生效 Policy（只读）` displayed workspace-write, approval `never`, snapshot hash, system policy source `configs/policy.default.yaml` and session override `{"profile":"workspace-write"}`; it distinguished enforced, advisory and declared-not-enforced. In that region the only button was Refresh; no editing control was observed. `policy-zh.jpg`; source path points to repository configuration, not fixture injection.

## E. Tools, Stop, scrolling — FAIL for readable Stop feedback in the captured viewport; other exercised subchecks PASS

Scripted OpenAI-compatible response requested real `Write` to fixture.txt; UI showed `Write · 已完成` with 工具详情 collapsed by default and final response. A second scripted response requested `Read(missing-fixture.txt)`; real tool card displayed `Read · 错误` and alert `read failed: ENOENT: no such file or directory, stat 'C:\work\AppData\Local\Temp\vessel-iab-run2-1b21431d\workspace\missing-fixture.txt'` without opening details (`tool-error.jpg`).

Held local response: Stop action yielded `[已中断]`; after reload that marker remained. In an initial outage attempt, stopping only our owned Vessel fixture process and then clicking Stop showed the generic local-service-disconnected message (`stop-outage.jpg`); that observation alone did not isolate Stop feedback. In a subsequent coordinator browser-network fixture, documented CDP Fetch interception paused only the fixture session's POST `/interrupt`: UI showed `正在请求停止…` and disabled=true (`coordinator-stop-inflight.json/.jpg`). A browser-controlled 503 response with `{error:'fixture_stop_failed',message:'Controlled fixture Stop failure'}` placed the full text `停止请求失败，尚未确认中断。请重试；运行状态与未发送草稿已保留。` in the DOM, restored Stop disabled=false, and retained `思考推演中…` (`coordinator-stop-failure.json`). However, `coordinator-stop-failure.jpg` shows the red error line vertically clipped at the bottom of the message viewport; only the upper portions of glyphs are visible. DOM presence does not establish readable feedback, so the visual criterion fails for this captured state. Pending disabling and state retention are verified under this browser-controlled response; real backend 503/error-code mapping and general behavior across other viewports are not established. This observation does not replace card 270's historical verification. A later retry click was attempted only after the 30-second held response had expired and timed out because the control was disabled; retry execution is not claimed. No product code was changed to repair the clipped feedback.

Long scripted response: `.message-list-scroll` clientHeight=252, scrollHeight=10600, initial scrollTop=10348.43, document scrollTop=0; a wheel-up inside its measured rectangle moved scrollTop to 5846.95 while document remained 0. Wheel-down attempted immediately afterwards recorded 5846.95, so only upward internal movement is verified. `long-scroll.jpg`.

## F. Delete, occupied failure and retry — PASS for exercised fixture

UI confirmation showed `将这组 1 个会话移入回收站？`. Exclusive Windows handle on a newly created fixture-lock file in the fixture session directory caused deletion failure: `sess_1793105810871_2938ba07: 无法移入回收站；会话索引已恢复，可重试。` and 重试 button (`delete-locked.jpg`). After lock release Retry removed session from list; reload kept it absent. App trash contained `entry.json`, `data/session.jsonl`, and `data/fixture-lock` under fixture workspace .harness/trash. This is application staging, not proof of the operating-system recycle bin. Another scripted tool session was also deleted through keyboard confirmation.

## G. Activity — PASS for four exercised states

Real fixture sessions produced running (held local response), failed (scripted HTTP 503), interrupted (Stop), completed (normal response). After reload Activity showed 失败·1, 运行中·1, 已中断·1, 已完成·3 simultaneously; `activity-four-after-reload.jpg`. Stopping displayed interrupted rather than failed. Fixture provider supplies the responses; no activity records were directly injected.

## H. History — PASS for exercised message, tool, interruption and length termination

After reload and reopening scripted Write session AX contained user `Scripted fixture write`, collapsed `Write · 已完成` card, and `Fixture complete` (`scripted-reloaded.jpg`). Reopened pending fixture retained user messages and `[已中断]` after reload. Coordinator's local scripted provider returned `Fixture length-limited answer` with `finish_reason: length`; UI showed `内容达到模型长度上限，可继续生成。` both before reload and after reopening `length fixture coord`. The `text` field in each of `coordinator-length-before.json` and `coordinator-length-after.json` contains that exact hint; matching screenshots are retained. The boolean comparison was printed during the coordinator's tool call, rather than stored as JSON keys.

## I. End-to-end — FAIL, Diff criterion unmet

Normal UI created a session, sent a prompt to loopback scripted provider, actual engine executed Write, UI displayed completed tool and response; message and tool survived reload; keyboard confirmation deleted the session into app trash. Inspector Changes → Patch instead said `本会话暂无补丁提案。` after Write. A real patch/Diff was not produced or reviewed, so full chain cannot pass. No synthetic widget was injected. The scripted provider isn't a real model and this does not validate model behavior.

## Commands, exits, boundaries

- Coordinator supplied `node node_modules/typescript/bin/tsc -b tsconfig.json` exit 0 before launch; no shared build or full gate by this lane.
- `Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue`: exit 1, no output (no listener). Launched `node apps/cli/dist/cli.js serve --port 5678 --workspace <fixture>/workspace` with isolated USERPROFILE/HOME/VESSEL_PROVIDER_ROOT/VESSEL_USAGE_ROOT; listening URL confirmed. After deliberate owned-process outage rechecked same port: exit 1/no output; restarted same fixture, exit 1 on intentional Ctrl+C. Original server also exit 1 on intentional Ctrl+C.
- Temp Node provider listened on free OS-assigned loopback port 58948, configured through normal UI, keyless. First version generated Write then final response; second version generated held, 503, missing Read and long response modes. Both stopped by Ctrl+C, exit 1. Five 503 calls were observed in stub logs due to product request behavior; no external model quota used. Fixture scripts and workspace retained in `C:\work\AppData\Local\Temp\vessel-iab-run2-1b21431d`.
- Final `Get-NetTCPConnection -LocalPort 5678,58948 -State Listen -ErrorAction SilentlyContinue`: exit 1, no output. Browser warning/error logs returned `[]`; screenshot viewport override reset.
- Visible IAB attempt `cua.createBrowserTab('iab', 'http://127.0.0.1:5678', {visible:true})` rejected literally: `IAB visibility is not supported in a subagent thread`; hidden IAB succeeded.
- On a resumed subagent turn, inventory returned `browsers: []`; both `cua.createBrowserTab('iab','http://127.0.0.1:5678',{visible:false})` and `cua.getBrowser({id:'iab'})` returned `Browser is not available: iab`. Coordinator's own IAB performed the subsequent length and focus checks. Its length stub was local and returned only scripted data. Before restart, listener query for ports 5678 and 58948 exited 1 with no output; restarted owned fixture server and length stub, then stopped both with Ctrl+C (each exit 1). Final listener query exited 1 with no output.
- Stop fixture CDP validation: `send('Fetch.enable',{patterns:[{urlPattern:'*/api/sessions/*/interrupt',requestStage:'Request'}]})` was rejected with `This method is not supported through raw CDP. Use explicit non-Document resourceType patterns; Browser Use reserves Document responses for browser-managed navigation.` The narrower `resourceType:'Fetch'` pattern was allowed. `send('Fetch.disable',{})` was rejected with `This method is not supported through raw CDP. Use Fetch.enable with an empty patterns array to clear raw interception.` `Fetch.enable` with empty patterns cleared interception successfully. An earlier UI fill attempt encountered clipboard target mismatch with Inspector open; closing Inspector and using the accessible input succeeded. After this check both owned processes were stopped with Ctrl+C (exit 1 each); final port query for 5678 and 58948 exit 1/no output.
- First attempted exclusive lock on existing session.jsonl failed: `Exception calling "Open" with "4" argument(s): "The process cannot access the file ...\session.jsonl because it is being used by another process."` The helper then printed misleading LOCK_HELD/LOCK_RELEASED and a null Dispose error; it did not hold a lock. A separate new fixture-lock file acquired the exclusive handle and produced the above observed failure/retry.
- A PowerShell command intended to edit a temporary helper failed exit 1 with `ParserError: Unexpected token '\",\"listen' in expression or statement.` A separate temp helper was then created; no product edit resulted.
- Only this evidence directory was written in repository; no source/test/card changes, full gate, commit, push, branch, or local agent CLI. Fixture remains in temp for inspection, no permanent cleanup performed.

## Artifact index

[完整截图与测量文件索引](artifacts.md) includes every retained JPEG and JSON file with decoded dimensions and byte counts.

## Independent review

`gpt-6.1-terra` / `medium` independently reviewed the report, original captures, data, dimensions and artifact index. Final report integrity: PASS after correcting DOM-versus-visual feedback and the JSON field description. Product acceptance remains NOT ACCEPTED: E's captured Stop feedback is clipped and I's Diff step is unmet; genuine zoom and native IME remain carried-forward UNVERIFIED. The review did not modify product code or rerun tests.
