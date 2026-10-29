#!/usr/bin/env bash
set -u
cd /mnt/e/Code_file/Projects/Vessel_Harness || exit 9

WS=$(mktemp -d /tmp/vessel-linux-ws-XXXXXX)
echo "ws=$WS"

node --input-type=module -e '
const ws = process.argv[1];
const m = await import("./packages/tools/dist/execution/sandbox/platformSandbox.js");
const r = new m.PlatformSandboxRunner();
console.log(JSON.stringify({ probe: "isAvailable", value: await r.isAvailable() }));

const run = async (label, cmd, args, opts = {}) => {
  try {
    const out = await r.execute(cmd, args, { cwd: ws, allowedWritePaths: [ws], cpuTimeoutMs: 20000, ...opts });
    console.log(JSON.stringify({ label, exitCode: out.exitCode, sandboxed: out.sandboxed, tier: out.isolationTier, out: out.stdout.slice(0, 120), err: out.stderr.slice(0, 160) }));
    return out;
  } catch (e) {
    console.log(JSON.stringify({ label, threw: String(e.message).slice(0, 240) }));
    return null;
  }
};

await run("write inside", "/bin/sh", ["-c", `echo inside > ${ws}/in.txt && cat ${ws}/in.txt`]);
await run("write outside tmp", "/bin/sh", ["-c", "echo escaped > /tmp/vessel-escape-test.txt"]);
await run("write usr", "/bin/sh", ["-c", "echo x > /usr/local/vessel-escape-test.txt"]);
await run("read root", "/bin/sh", ["-c", "head -c 20 /etc/hostname"]);
await run("escape setsid", "/bin/sh", ["-c", "setsid sh -c \"sleep 4; echo late > /tmp/vessel-escape-late.txt\" >/dev/null 2>&1 & echo spawned"]);
' "$WS"

echo "--- 6s later: did the setsid-escaped child survive and write? ---"
sleep 6
echo "late file exists: $([ -e /tmp/vessel-escape-late.txt ] && echo yes || echo no)"
echo "escape tmp file exists: $([ -e /tmp/vessel-escape-test.txt ] && echo yes || echo no)"
echo "usr file exists: $([ -e /usr/local/vessel-escape-test.txt ] && echo yes || echo no)"
echo "in.txt: $(cat "$WS/in.txt" 2>/dev/null || echo MISSING)"
echo "--- leftover processes named sleep/escaped ---"
ps -eo pid,pgid,sess,sid,cmd | grep -E "vessel-escape|sleep 4" | grep -v grep || echo "(none)"
