import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { composeHarness, type ComposeOptions } from '../compose.js';
import type { VesselTaskExecutor, VesselTaskResultContract } from './vesselMcpServer.js';

export type McpTaskComposeOptions = Pick<ComposeOptions, 'provider' | 'model' | 'policySystemPath' | 'behaviorIRPath'> &
  Partial<Pick<ComposeOptions, 'policyProjectPath' | 'usageStore' | 'usageProvider'>> &
  { defaultWorkspaceRoot?: string };

/** Compose the normal application runtime for each MCP task and expose only the bounded result contract. */
export function createVesselTaskExecutor(base: McpTaskComposeOptions): VesselTaskExecutor {
  return {
    async execute(args, signal, progress): Promise<VesselTaskResultContract> {
      const workspaceRoot = path.resolve(args.workspaceRoot ?? base.defaultWorkspaceRoot ?? process.cwd());
      const composeOptions: ComposeOptions = {
        ...base,
        workspaceRoot,
        provider: base.provider,
        model: base.model,
        policySystemPath: base.policySystemPath,
        behaviorIRPath: base.behaviorIRPath,
        sessionId: args.sessionId,
        maxSteps: args.maxSteps,
        permission: args.policyProfile,
        policyProjectPath: base.policyProjectPath ?? path.join(workspaceRoot, '.harness', 'policy.yaml'),
      };

      const harness = await composeHarness(composeOptions);
      let totalTokens = 0;
      const detachUsage = harness.bus.on('after_model', (payload) => {
        const usage = (payload as { usage?: { inputTokens?: number; outputTokens?: number } }).usage;
        totalTokens += Math.max(0, usage?.inputTokens ?? 0) + Math.max(0, usage?.outputTokens ?? 0);
      }, 'mcp-agent:bounded-usage');
      const detachProgress = harness.bus.on('after_model', (payload) => {
        const step = (payload as { step?: number }).step;
        progress({ step, summary: Number.isInteger(step) ? `Model step ${step} completed.` : 'Model step completed.' });
      }, 'mcp-agent:bounded-progress');
      const abort = (): void => { harness.loop.interrupt(); };
      signal.addEventListener('abort', abort, { once: true });

      try {
        if (signal.aborted) abort();
        const turn = await harness.loop.runTurn(args.task);
        const changedFiles = gitStatusPaths(workspaceRoot);
        const diffSummary = args.includeDiff ? gitDiff(workspaceRoot) : undefined;
        return {
          success: turn.kind === 'success',
          finalText: turn.finalText,
          steps: turn.steps,
          changedFiles,
          ...(diffSummary ? { diffSummary } : {}),
          totalTokens,
          sessionId: harness.session.sessionId,
        };
      } finally {
        signal.removeEventListener('abort', abort);
        detachUsage();
        detachProgress();
        await harness.close();
      }
    },
  };
}

function gitStatusPaths(workspaceRoot: string): string[] {
  try {
    return execFileSync('git', ['status', '--short', '--untracked-files=all'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
      windowsHide: true,
    })
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => line.slice(3).replace(/^"(.*)"$/u, '$1'))
      .slice(0, 100);
  } catch {
    return [];
  }
}

function gitDiff(workspaceRoot: string): string {
  try {
    return execFileSync('git', ['diff', '--no-ext-diff', '--no-color', '--unified=3'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }).slice(0, 24_576);
  } catch {
    return '';
  }
}
