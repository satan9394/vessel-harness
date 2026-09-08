/**
 * demo — Policy DENY demonstration (acceptance criterion 3):
 * a destructive shell command (rm -rf) is intercepted by the Policy Engine
 * (hard enforcement, not just prompt guidance) and audited via audit/denial.
 *
 * Run: npx tsx scripts/demo-policy-deny.ts
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockProvider } from '@vessel/llm';
import { composeHarness } from '../apps/cli/src/compose.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function main(): Promise<number> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-deny-demo-'));
  fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), '// precious', 'utf8');

  const provider = new MockProvider(
    [
      { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Shell', arguments: { command: 'rm -rf ./node_modules' } }] } },
      { when: /.*/, minToolResults: 1, response: { text: '命令已被策略引擎拒绝（不会真正删除任何文件）。' } },
    ],
    { model: 'mock', vars: { cwd: dir } },
  );

  const h = await composeHarness({
    workspaceRoot: dir,
    provider,
    model: 'mock',
    policySystemPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
    behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
  });

  console.log('=== 输入：删除 node_modules ===');
  const result = await h.loop.runTurn('删除 node_modules');
  console.log('\n=== 最终回复 ===');
  console.log(result.finalText);

  const denials = h.session.replay().filter((r) => r.type === 'audit/denial');
  console.log(`\n=== audit/denial × ${denials.length}（Policy 硬执法证据）===`);
  for (const d of denials) {
    console.log(`  tool=${(d as { toolName: string }).toolName} ref=${(d as { ruleRef?: string }).ruleRef} reason=${(d as { reason: string }).reason}`);
  }
  const nodeModulesStillThere = fs.existsSync(path.join(dir, 'node_modules', 'pkg', 'index.js'));
  console.log(`\n=== 破坏未发生：node_modules/pkg/index.js 仍存在 = ${nodeModulesStillThere} ===`);
  console.log(`会话日志: ${h.session.logPath}`);
  await h.close();
  return denials.length >= 1 && nodeModulesStillThere ? 0 : 1;
}

main().then((code) => process.exit(code));
