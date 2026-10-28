# T4 IAB acceptance run 3

Conclusion: **UNVERIFIED** for both W1 and W2. No screenshots were captured. The IAB was unavailable when opening the fixture, including after a runtime reset. No DOM or prior-run evidence is substituted for the requested visual proof.

- W1: no controlled interrupt was issued; viewport, disabled state, and readable failure geometry were not observed.
- W2: no browser session or Write was initiated; patch display, controls, file bytes and write count were not observed in this run. Prior non-browser evidence remains in `../2026-10-27-w2-e2e/PROOF.md`, and does not establish current viewport rendering.

## Attempts and isolation

- `cua.getBrowser({id:'iab'})` initially returned a browser binding and documentation. After fixture launch, `cua.createBrowserTab('iab','http://127.0.0.1:5678',{visible:false})` returned `Browser is not available: iab`. `cua.getState()` returned `browsers: []`. After `cua_repl.js_reset`, the same create call returned the same error. No external browser was used.
- A fresh system-temp workspace and separate USERPROFILE, HOME, VESSEL_PROVIDER_ROOT and VESSEL_USAGE_ROOT were created at `C:\work\AppData\Local\Temp\vessel-iab-run3-oRaxKY`; provider is a keyless loopback stub. No user session was used.
- `Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess`: exit 1, no output, zero listeners before launch.
- Temporary Node fixture runner creation: exit 0. An initial orchestration attempt failed before writing with `ReferenceError: btoa is not defined`; the corrected creation succeeded. `node "$env:TEMP/vessel-iab-run3-runner.cjs"` launched stub PID 29884 on port 53781 and child server PID 9876 on port 5678; server announced its URL. It did not complete naturally before cleanup.
- Attempt to send `stop` through the command session failed: `write_stdin failed: stdin is closed for this session; rerun exec_command with tty=true to keep stdin open`. `Get-CimInstance Win32_Process` confirmed PID 9876 was the child of PID 29884, and their command lines were the fixture server and runner. `Stop-Process -Id 9876,29884`: exit 0.
- `Get-NetTCPConnection -LocalPort 5678,53781 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess`: exit 1, no output, zero listeners after cleanup. `Get-Process -Id 9876,29884 -ErrorAction SilentlyContinue | Select-Object Id,ProcessName`: exit 1, no output; both owned PIDs absent.
- No product or test files changed, no build or full gate run. No command was refused; the browser API reported unavailable as above.

Next step: rerun W1 and W2 in an IAB-enabled session, capture and visually inspect both actual screenshots, and record geometry, button states and fixture write evidence.

## Routing and independent review

- Implementation: `gpt-6.1-terra` / medium; independent read-only review: `gpt-6.1-terra` / medium, as wave 4 section 1 assigns to the evidence-only IAB task. Fast was not enabled, no Ultra or local agent CLI was used.
- Independent review accepted the evidence recording and the explicit unavailable-browser fallback. This is **not visual acceptance**: W1 and W2 remain UNVERIFIED and no screenshots exist.
- The reviewer independently queried listeners on ports 5678/53781 and recorded processes 9876/29884: query exit 0, zero output, zero listeners and neither PID present. It did not restart services or assert historical process ownership beyond the fixture's recorded CIM evidence.
- A later coordinator check still found zero listeners. PID 29884 had since been reused by `chrome.exe` (creation 2026-10-28 01:14:48, parent 11848); this is not the stopped Node fixture runner. It was left untouched. A PID number alone is not continuing ownership evidence.
