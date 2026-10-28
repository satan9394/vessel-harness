# Cards 260/275 — visible IAB run 5 (2026-10-28)

## 1. Conclusion

- W1: 通过. Full Stop error is readable in the final 917×567 screenshot.
- W2: 通过. New-file patch and read-only controls are visible in the final 917×567 screenshot; overwrite adds zero widgets.
- These are fixture-provider viewport results, not whole-card acceptance or real-model evidence. Coordinator signature remains required.
- Main thread only; no subagents or Agent CLIs. Requested route: gpt-6.1-sol / medium / Fast off. Host model settings were not changed or independently queried.

## 2. Measured criteria

### W1

- Full text: 停止请求失败，尚未确认中断。请重试；运行状态与未发送草稿已保留。
- Final screenshot matching geometry: error rect {"bottom":171.51094436645508,"height":20.919574737548828,"left":23.994678497314453,"right":863.0544319152832,"top":150.59136962890625,"width":839.0597534179688,"x":23.994678497314453,"y":150.59136962890625}; message-container rect {"bottom":195.2173309326172,"height":87.38912200927734,"left":0,"right":902.1880493164062,"top":107.82820892333984,"width":902.1880493164062,"x":0,"y":107.82820892333984}.
- clientHeight=87, scrollHeight=1267, scrollTop=1178.9473876953125; final text-line bottom=169.98817443847656 <= visible container bottom=195.2173309326172; viewport 917×567. All text-line rectangles are in w1-measurements.json.
- First pass pending text “正在请求停止…” observed, disabled=true; after the controlled 503, Stop enabled=true. Recapture pending isEnabled=false, after failure enabled=true.
- 思考推演中… remains: {"rect":{"bottom":138.59403228759766,"height":44.91425323486328,"left":63.52750015258789,"right":157.57687759399414,"top":93.67977905273438,"width":94.04937744140624,"x":63.52750015258789,"y":93.67977905273438},"text":"思考推演中… "}. Initial exact whole-string isVisible returned false for that whole-string locator; the separate thinking-text geometry and screenshot establish the visible thinking text.
- Manual upward wheel: scrollTop 1178.9473876953125 → 545.0029907226562; after a 1.6s wait plus tool latency: 545.0029907226562. No rebound. This measurement is from the first successful W1 injection; final recapture repeats the same held-request interaction.
- Only the paused interrupt POST was fulfilled with HTTP 503 / {"error":"fixture_stop_failed","message":"Controlled fixture Stop failure"}. Fetch.enable({patterns:[]}) cleared interception after each injection and at cleanup.
- Evidence: w1-stop-failed-917x567.png, w1-measurements.json.

### W2

- Provider configured through normal UI (custom compatible endpoint, keyless): fixture / fixture-model, http://127.0.0.1:57340/v1. Both sessions and prompts were created/sent through UI; no HTTP session creation fallback. Permission: workspace-write.
- Inspector → 变更 → 代码补丁: fixture.txt, +2, −0, @@ -0,0 +1,2 @@, +before, +second all visible. Accessible patch button list: ["收起差异"]; no apply/accept/discard/reject/revert control. Global inspector close and tab selectors are outside the patch controls.
- Final positive turn has Write tool/call=1 and tool/result=1; negative turn separately has 1/1. Raw matching events and sequence IDs: disk-and-journal.json. No extra write within either turn.
- Disk before negative=6265666f72650a7365636f6e640a; after=6265666f72650a7365636f6e640a; exact UTF-8 content before\nsecond\n, 14 bytes. Unchanged=true.
- Negative control: widget count 1 → 1; added=0; completed Write cards=2.
- Final capture was repeated after saving the first capture file intact as C:\work\AppData\Local\Temp\vessel-iab-run5-QGhkps/fixture-first-capture.txt, leaving fixture.txt absent again. No permanent deletion.
- A reopened older session did not restore the transient diff widget after restart; this was outside the run-5 requested gates and is recorded as an observation, not a new diagnosis. Final evidence uses a fresh live Write.
- Evidence: w2-new-file-diff-917x567.png, w2-measurements.json, disk-and-journal.json.

### Screenshot encoding

- Final images came from tab.screenshot({fullPage:false}), JPEG magic ffd8ffe000104a46, 917×567. Original .jpg files retained. Pillow decoded each JPEG and saved PNG without resizing/cropping or content changes. Final PNG magic 89504e470d0a1a0a, dimensions 917×567; visually inspected from disk.
- Initial raw Page.captureScreenshot PNGs had correct file dimensions but zoomed/cropped content; retained as w1-raw-cdp-cropped.png and w2-raw-cdp-cropped.png, explicitly excluded from acceptance evidence.
- File hashes and signatures: integrity.json.

## 3. Dist freshness

- node node_modules/typescript/bin/tsc -b tsconfig.json → exit 0.
- npm run -w @vessel/web build → exit 0; expands to vite build --emptyOutDir false. No build:clean.
- index.html mtime: 2026-10-28T14:22:05.508Z (UTC; 2026-10-28 07:22:05.508 America/Los_Angeles). Referenced JS: assets/index-CXJPjUxG.js; CSS: assets/index-WPay7jgN.css.
- Vite reported its standard chunk-size warning (>500 kB); build passed.

## 4. Ports, processes and cleanup

- Initial Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue returned no rows (exit 1: no matching listener). Port 5678 selected.
- Serve command: node apps/cli/dist/cli.js serve --port 5678 --workspace C:\work\AppData\Local\Temp\vessel-iab-run5-QGhkps/workspace.
- First wrapper/stub PID 19540, serve PID 3104; SSE stub replacement PID 14184; restarted serve PID 23304. Stopping the first wrapper also stopped its serve child, so serve was restarted with the same isolated environment.
- Final wrapper/stub PID 2276, serve PID 7068. All self-created processes were stopped. Final Get-NetTCPConnection -LocalPort 5678,57340 -State Listen -ErrorAction SilentlyContinue: PORT_5678_57340_LISTENERS=0 (also measured before final recapture).
- Every HOME/USERPROFILE/APPDATA/LOCALAPPDATA and VESSEL_SESSION_ROOT/PROVIDER_ROOT/USAGE_ROOT/MCP_ROOT/SETTINGS_ROOT/DAEMON_ROOT was a separate directory beneath C:\work\AppData\Local\Temp\vessel-iab-run5-QGhkps; VESSEL_TRASH_TTL_DAYS=0. No credentials configured. TEMP fixture retained.
- Viewport override reset; Fetch interception cleared.

## 5. Failures, recovery and exclusions

1. Initial PowerShell rg glob arguments: “文件名、目录名或卷标语法不正确。 (os error 123)” for evidence/sessions/2026-10-27*, evidence/sessions/2026-10-28*, apps/web/src/components/*Provider*; apps/web/src/pages/*: “系统找不到指定的路径。 (os error 3)”. Replaced with rg directory traversal and -g.
2. getByRole('checkbox',{name:'添加供应商',exact:true}).click(): “Error: Playwright selector deadline exceeded”; “no_matches”, matchCount=0. Native AX tab.click(54) succeeded.
3. getByLabel('快捷模板',{exact:true}).selectOption(): “Error: strict mode violation: getByLabel('快捷模板', { exact: true }) resolved to 3 elements”. Unique #provider-preset succeeded.
4. W2 initial stub answered JSON while request stream=true. UI ended “(Interrupted)”, no Write or Diff. TEMP stub corrected to SSE; no product changes.
5. getByRole('textbox').first().fill(): “Error: Playwright selector deadline exceeded”; diagnostics disabled=true. Fresh AX showed “无法连接本地服务，请先运行 vessel serve（127.0.0.1:5678）。” because stopping the fixture wrapper also stopped serve. Serve restarted; UI-created fresh session succeeded.
6. getByRole('region',{name:'代码补丁',exact:true}).innerText(): “Playwright selector deadline exceeded”. DOM snapshot identified tabpanel; getByRole('tabpanel',...) succeeded.
7. Assignment after failed declaration: “w2 is not defined”. Re-declared let w2; capture succeeded.
8. Raw CDP PNG capture visually failed (cropped/zoomed), despite valid magic and dimensions. Recaptured through tab screenshot API; retained raw failures. No second capture-format failure.

No visible-IAB rejection occurred. No consecutive twice-failed operation was continued. No full gates, zoom/IME checks, real provider calls, product/test/script/config/.pdw edits, new card, git add/commit/push/branch, or other Agent CLI calls. The browser API itself used native and Playwright accessibility role mappings differently; each locator recovery followed fresh AX/DOM evidence.

## 6. Changes

Only new evidence/sessions/2026-10-28-iab-run5/ files and append-only additions to tasks/275-ui-final-acceptance.md and tasks/260-browser-runtime-acceptance.md; ignored build output under apps/web/dist and package dist (and compiler-managed ignored build outputs). TEMP-only fixture scripts/state. Existing unrelated working-tree changes preserved. Original task-card byte prefixes checked against pre-run copies. Final git diff --check exit 0 (the old EOF blank line is now interior after append); JPEG-to-PNG decoded RGB pixel equality passed for both images. No whole-card signature or README/status rewrite.

## 7. Evidence paths

evidence/sessions/2026-10-28-iab-run5/disk-and-journal.json; evidence/sessions/2026-10-28-iab-run5/w1-measurements.json; evidence/sessions/2026-10-28-iab-run5/w1-raw-cdp-cropped.png; evidence/sessions/2026-10-28-iab-run5/w1-stop-failed-917x567.jpg; evidence/sessions/2026-10-28-iab-run5/w1-stop-failed-917x567.png; evidence/sessions/2026-10-28-iab-run5/w2-measurements.json; evidence/sessions/2026-10-28-iab-run5/w2-new-file-diff-917x567.jpg; evidence/sessions/2026-10-28-iab-run5/w2-new-file-diff-917x567.png; evidence/sessions/2026-10-28-iab-run5/w2-raw-cdp-cropped.png; evidence/sessions/2026-10-28-iab-run5/integrity.json
