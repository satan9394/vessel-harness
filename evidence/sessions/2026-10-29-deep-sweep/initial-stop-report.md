# Deep sweep — 2026-10-29

Result: **STOPPED at S1; objective remains incomplete.** No whole-card acceptance is claimed.

The handoff says “任一项连续两次失败即停”. The pwsh 7 provisioning command and its immediately following revocation command both exited 1. These were counted conservatively as the two consecutive S1 failures. No further repair or S2–S4 execution followed. Revocation through the working 5.1 path was cleanup only.

## Execution and recovery

- Authoritative instruction: `tasks/prompts/codex-handoff-2026-10-29-deep-sweep.md`.
- Started from clean HEAD `cd0142b3b33986d5ad10f99922c360d2008e51b4`; no earlier deep-sweep evidence or live proof run was found. The interrupted turn supplied no completed gate to reuse; this run produced fresh evidence.
- Main thread only; no subagents or other Agent CLIs, no branch, staging, commit, push, publication, real provider, or credentials used.
- Requested route in the handoff: `gpt-6.1-sol / medium`, Fast off. No routing or tier override was made; this report does not independently attest the host's model/effort/tier.
- Fixtures and execution logs were created under `C:\work\AppData\Local\Temp\vessel-deep-sweep-kYFWsO`. Only the requested durable evidence and card appendices were archived in the repository.

## S1 — 不通过 / FAIL

The proposed edit used static `FileSystemAclExtensions` calls on Core and kept instance calls on Windows PowerShell 5.1, where that extension type was absent. It also changed both SDDL verification reads to the compatibility helper. The attempted diff is preserved in `s1-attempt.patch`.

| Shell / command | exitCode | Self-check / observed state |
| --- | ---: | --- |
| Windows PowerShell 5.1, configure ps5 | 0 | `granted=True`; `low label : True`; SID and Low label present in icacls |
| Windows PowerShell 5.1, revoke ps5 | 0 | `removed=True`; `low label : False`; SID and Low label absent |
| pwsh 7.6.5, configure ps7 | 1 | `You cannot call a method on a null-valued expression.`; SID and Low label had been applied before verification failed |
| pwsh 7.6.5, revoke ps7 | 1 | Same null-valued error; Medium label restored, but sandbox SID remained |
| Cleanup via 5.1, revoke ps7 | 0 | `removed=True`; `low label : False`; final icacls confirms neither sandbox SID nor Low label |

Raw commands, stdout, stderr and exit codes: `s1-results.json`. Exact failed commands:

```text
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File E:\Code_file\Projects\Vessel_Harness\scripts\provision-sandbox.ps1 -Path C:\work\AppData\Local\Temp\vessel-deep-sweep-kYFWsO\ps7
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File E:\Code_file\Projects\Vessel_Harness\scripts\provision-sandbox.ps1 -Path C:\work\AppData\Local\Temp\vessel-deep-sweep-kYFWsO\ps7 -Revoke
```

Both produced exactly:

```text
provision-sandbox.ps1: You cannot call a method on a null-valued expression.
```

A read-only follow-up (`inspection.json`, exit 0) confirmed on the returned ACL:

```json
{ "shellVersion": "7.6.5", "sddlPropertyAvailable": false, "accessPropertyAvailable": false, "accessRulesViaMethod": 5 }
```

Thus replacing DirectoryInfo methods alone is insufficient in a fresh pwsh process: `.Sddl` is null during verification, and `.Access` is absent during rule removal. Native `GetSecurityDescriptorSddlForm(...)` and `GetAccessRules(...)` were observed to work in the read-only inspection. An implementation using those methods was **not** attempted after the stop condition.

The incomplete script edit and its unverified documentation sentence were restored to their original HEAD bytes. `rollback.json` records that rollback. No supported-on-both-shells claim remains in `docs/SANDBOX-WINDOWS.md` from this run.

## S2 — 无法验证 / UNVERIFIED

Not attempted because its explicit S1 prerequisite failed and the stop condition had fired. No helper compilation, token creation, Job Object, runner availability or enforcement claim is made. `PlatformSandboxRunner` was inspected, never executed.

| Required case | exitCode | sandboxed | isolationTier | File existence |
| --- | --- | --- | --- | --- |
| Allowed write | NOT RUN | NOT OBSERVED | NOT OBSERVED | NOT OBSERVED |
| Outside-workspace write | NOT RUN | NOT OBSERVED | NOT OBSERVED | NOT OBSERVED |
| Unprovisioned directory denied | NOT RUN | NOT OBSERVED | NOT OBSERVED | NOT OBSERVED |

## S3 — 无法验证 / UNVERIFIED

- Tray registration: **not inspected**; no NotifyIconSettings before/after exports were taken.
- Visible notification area: **not inspected**; no desktop screenshot was taken.
- Toast: **not triggered or inspected**; no isolated 503 provider or session was started.
- No daemon was started, so no daemon stop command was needed. No tray expansion, mouse/focus action or registry promotion occurred.

## S4 — 无法验证 / UNVERIFIED

Neither the 960×600 nor 720×450 visible-IAB run was attempted after the stop. No viewport metrics, title/model truncation measurements, physical-scale control or screenshots exist in this delivery. The requested `s260-zoom150-960x600.png` and `s260-zoom200-720x450.png` are deliberately absent, not marked passed.

**这是布局等价，不是浏览器菜单缩放**；菜单缩放与 150%/200% 下的真实字形渲染仍属真机。原生中文输入法未做；175/277 视觉签字、跨 harness live、154 release-report、155 字面 3h soak 均未做。

## Closeout and evidence integrity

- Final ACLs: `final-acls.json` includes raw stdout/stderr bytes as base64 and GBK-decoded text. Both icacls commands exited 0. ps5 SID `S-1-5-21-455781120-802476142-2444903493-183` and ps7 SID `S-1-5-21-2327723602-1634786665-4276103583-183` are absent; both directories have Medium, no Low label. Existing inherited ACEs were preserved.
- `inspection.json` records **0 listeners on 5678/5173**, **0 matching CLI daemon processes**, at 2026-10-29T08:59:34.1397727Z. This task launched no daemon, tray, server or persistent child. Fixtures remain in TEMP; nothing was deleted.
- `cleanup.json` also preserves two invalid read-only diagnostic commands: a pwsh `-Command` argument-binding error (empty path, exit 1), and a process-filter regex error (PowerShell emitted errors despite exit 0). Neither output is used as proof. The separate `inspection.json` file uses a saved script and successful error-free execution instead.
- Initial icacls text in `s1-results.json` / `cleanup.json` was decoded as UTF-8 although the system emits GBK; non-ASCII summary text there is garbled. The SID and English label observations are intact. Final cleanup evidence preserves the bytes and correct GBK text in `final-acls.json`.
- No source/test change survives, so no full build/test suite was run. The actual S1 shell gates failed as reported. Final checks cover byte-for-byte source rollback, append-only card updates, unchanged card status lines, allowed paths and whitespace; see `verification.json`.

## Changed paths and next action

Only this evidence directory and appended sections in these five existing cards remain changed:

- `tasks/180-os-native-sandboxing-and-restricted-tokens.md`
- `tasks/183-epic-hardened-runtime-and-cognitive-memory.md`
- `tasks/176-headless-daemon-and-tray-resilience.md`
- `tasks/260-browser-runtime-acceptance.md`
- `tasks/275-ui-final-acceptance.md`

Their status lines and all earlier bytes are preserved. No new task card or README/HANDOFF update was made. `manifest.json` hashes the delivered evidence; `verification.json` records final scope checks.

Resume requires the maintainer to authorize continuing after the handoff's stop condition. The next concrete action is a targeted S1 compatibility repair for ACL rule enumeration and SDDL access, followed by fresh 5.1/7 configure→revoke gates. S2–S4 remain in the original objective and are not waived.

One evidence-authoring command failed to parse before mutation (unescaped Markdown backticks in a JavaScript template). Its command/error and corrected archival outcome are recorded in `authoring-errors.json`; this was not a product or acceptance-gate result.

Read-only Windows PowerShell version/type metadata is preserved in `ps5-metadata.json` (exit 0).
