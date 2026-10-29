#!/usr/bin/env bash
set -u
cd /mnt/e/Code_file/Projects/Vessel_Harness || exit 9
WS=$(mktemp -d /tmp/vessel-linux-ws2-XXXXXX)
echo "ws=$WS"

node --input-type=module -e '
const ws = process.argv[1];
const m = await import("./packages/tools/dist/execution/sandbox/platformSandbox.js");
const r = new m.PlatformSandboxRunner();
const out = await r.execute("/bin/sh", ["-c",
  `setsid sh -c "sleep 4; echo survived > ${ws}/late.txt; echo outside > /tmp/late-outside.txt" >/dev/null 2>&1 & echo spawned`
], { cwd: ws, allowedWritePaths: [ws], cpuTimeoutMs: 20000 });
console.log(JSON.stringify({ exitCode: out.exitCode, tier: out.isolationTier, out: out.stdout.trim() }));
' "$WS"

echo "--- waiting 7s ---"
sleep 7
echo "late.txt inside allowed root: $([ -e "$WS/late.txt" ] && echo YES-survived || echo no)"
echo "late-outside.txt in /tmp: $([ -e /tmp/late-outside.txt ] && echo YES-LEAK || echo no)"
cat "$WS/late.txt" 2>/dev/null
echo "--- leftover setsid/sleep processes ---"
ps -eo pid,ppid,pgid,sid,cmd | grep -E "sleep 4|late.txt" | grep -v grep || echo "(none)"
