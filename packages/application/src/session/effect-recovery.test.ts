import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { SessionController } from './SessionController.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-effect-process-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it.each(['before_intent', 'after_intent', 'after_effect', 'after_outcome'])(
  'recovers a real policy/executor process exit at %s through SessionController and explicit reconcile', async boundary => {
    const workspaceRoot = path.join(root, 'workspace'); fs.mkdirSync(workspaceRoot);
    const opts = { workspaceRoot, provider: new MockProvider([{ when: /.*/, response: { text: 'recovered' } }]),
      model: 'mock', policySystemPath: path.resolve('configs/policy.default.yaml'), behaviorIRPath: path.resolve('configs/behavior.default.yaml'), permission: 'workspace-write' as const };
    let ctl = await SessionController.create(opts); const sessionId = ctl.sessionId; const journal = path.join(ctl.session.dir, 'execution.jsonl'); await ctl.close();
    const worker = path.join(root, 'worker.mjs'); const count = path.join(root, 'effect-count');
    const url = (relative: string) => JSON.stringify(pathToFileURL(path.resolve(relative)).href);
    fs.writeFileSync(worker, `
      import fs from 'node:fs';
      import { Executor } from ${url('packages/runtime/src/executor/Executor.ts')};
      import { EffectJournal } from ${url('packages/runtime/src/executor/EffectJournal.ts')};
      import { Sandbox } from ${url('packages/runtime/src/sandbox/Sandbox.ts')};
      import { PolicyEngine } from ${url('packages/policy/src/engine/Engine.ts')};
      import { compilePolicyYaml } from ${url('packages/policy/src/risk/Compiler.ts')};
      const [journalFile, counter, boundary, key] = process.argv.slice(2);
      const journal = new EffectJournal(journalFile);
      const policy = new PolicyEngine(compilePolicyYaml('policy:\\n  version: 1\\n  profile: workspace-write\\n  approval: never'));
      const call = {toolCallId:'counter-call',toolName:'Write',arguments:{path:'counter'}};
      const tool = {name:'Write',family:'file_write',requiredPermission:'workspace-write',effects:'non_idempotent',exclusive:true,description:'fixture',inputSchema:{type:'object',properties:{}},
        execute: async()=>{fs.appendFileSync(counter,'effect\\n');if(boundary==='after_effect')process.exit(73);return {content:'done',meta:{}};}};
      const executor = new Executor({permitAuthority:policy.permits,decide:(c,s)=>policy.decide(c,s),
        beforeDispatch:async(c,s,i)=>{if(boundary==='before_intent')process.exit(73);journal.begin(c,s,i,key);if(boundary==='after_intent')process.exit(73);},
        afterDispatch:async(c,r)=>{journal.finish(c,r,key);if(boundary==='after_outcome')process.exit(73);}});
      const result=await executor.runTool(tool,call,{workspaceRoot:${JSON.stringify(workspaceRoot)},cwd:${JSON.stringify(workspaceRoot)},sandbox:new Sandbox(),executionKey:key,
        subject:{sessionId:${JSON.stringify(sessionId)},runId:'fixture-run',agentInstanceId:'fixture'}});
      console.log(JSON.stringify({error:result.error?.message,done:!result.error}));
    `);
    const run = (fault: string, key = 'fixture-run:1') => spawnSync(process.execPath, ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href, worker, journal, count, fault, key], { encoding: 'utf8', timeout: 20_000 });
    const crashed = run(boundary); expect(crashed.stderr).toBe(''); expect(crashed.status).toBe(73);
    ctl = await SessionController.create({ ...opts, sessionId });
    try {
      const pending = ctl.pendingEffects();
      expect(pending).toHaveLength(boundary === 'after_intent' || boundary === 'after_effect' ? 1 : 0);
      if (pending[0]) {
        expect(run('retry').stdout).toContain('OUTCOME_UNKNOWN');
        await expect(ctl.reconcileEffect({ ...pending[0], invocationHash: 'wrong', resolution: 'applied', evidence: 'counter inspected' })).rejects.toThrow('identity');
        const resolution = boundary === 'after_effect' ? 'applied' as const : 'not_applied' as const;
        await ctl.reconcileEffect({ ...pending[0], resolution, evidence: 'counter file inspected by test operator' });
        expect(ctl.pendingEffects()).toEqual([]);
      }
      await ctl.close();
      const retry = run('retry'); expect(retry.status).toBe(0);
      if (boundary !== 'before_intent') expect(retry.stdout).toContain('already observed');
      const countBeforeNext = fs.existsSync(count) ? fs.readFileSync(count, 'utf8').trim().split('\n').length : 0;
      expect(countBeforeNext).toBe(boundary === 'after_intent' ? 0 : 1);
      expect(run('next', 'fixture-run:2').stdout).toContain('"done":true');
      expect(fs.readFileSync(count, 'utf8').trim().split('\n')).toHaveLength(countBeforeNext + 1);
      ctl = await SessionController.create({ ...opts, sessionId });
      // A normal model turn is possible after recovery; it does not redispatch old calls.
      expect((await ctl.runTurn('continue after operator recovery')).kind).toBe('success');
    } finally { await ctl.close(); }
    ctl = await SessionController.create({ ...opts, sessionId });
    expect(ctl.pendingEffects()).toEqual([]); await ctl.close();
  }, 120_000,
);
