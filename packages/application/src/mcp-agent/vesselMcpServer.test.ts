import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { createVesselMcpServer, createVesselTaskExecutor, type VesselTaskExecutor } from '../index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');

describe('Vessel MCP agent server', () => {
  let tempRoot: string | undefined;

  afterEach(() => {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it('serves standard tools/list over JSON-RPC stdio without non-protocol output', async () => {
    const server = createVesselMcpServer({
      async execute(args) {
        return { success: true, finalText: args.task, steps: 1, changedFiles: [], totalTokens: 0, sessionId: args.sessionId };
      },
    });
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    let outputText = '';
    let diagnosticText = '';
    output.setEncoding('utf8').on('data', (chunk: string) => { outputText += chunk; });
    diagnostics.setEncoding('utf8').on('data', (chunk: string) => { diagnosticText += chunk; });
    const disconnect = server.connect(input, output, diagnostics);
    try {
      const response = nextJsonRpcLine(output, () => input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`));
      const parsed = JSON.parse(await response) as { id: number; result: { tools: { name: string }[] } };
      expect(parsed.id).toBe(1);
      expect(parsed.result.tools.map((tool) => tool.name)).toEqual([
        'run_vessel_task', 'query_vessel_task_status', 'cancel_vessel_task',
      ]);
      expect(diagnosticText).toBe('');
      expect(outputText.split('\n').filter(Boolean)).toHaveLength(1);
    } finally {
      disconnect();
      server.close();
      input.destroy();
      output.destroy();
      diagnostics.destroy();
    }
  });

  it('runs a multi-step task through the real composition root and returns a compact result contract', async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mcp-agent-'));
    const provider = new MockProvider([
      { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: { path: 'created.txt', content: 'written by mock agent' } }] } },
      { when: /.*/, response: { text: 'Created the requested file.' } },
    ], { model: 'mock-model' });
    const server = createVesselMcpServer(createVesselTaskExecutor({
      provider,
      model: 'mock-model',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
    }));

    const response = await server.handle('tools/call', {
      name: 'run_vessel_task',
      arguments: { task: 'Create created.txt', workspaceRoot: tempRoot, policyProfile: 'workspace-write', maxSteps: 5 },
    }) as { content: { text: string }[] };
    const result = JSON.parse(response.content[0]!.text) as {
      success: boolean; finalText: string; steps: number; changedFiles: string[]; totalTokens: number; sessionId: string;
    };

    expect(fs.readFileSync(path.join(tempRoot, 'created.txt'), 'utf8')).toBe('written by mock agent');
    expect(result).toMatchObject({ success: true, finalText: 'Created the requested file.', steps: 2 });
    expect(result.sessionId).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(result).not.toHaveProperty('history');
    expect(JSON.stringify(result).length).toBeLessThan(20_000);
  });

  it('uses the hard read-only policy profile to reject a write tool call', async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mcp-readonly-'));
    const provider = new MockProvider([
      { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: { path: 'forbidden.txt', content: 'must not be written' } }] } },
      { when: /.*/, response: { text: 'The requested write was blocked.' } },
    ], { model: 'mock-model' });
    const server = createVesselMcpServer(createVesselTaskExecutor({
      provider,
      model: 'mock-model',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
    }));

    await server.handle('tools/call', {
      name: 'run_vessel_task',
      arguments: { task: 'Write forbidden.txt', workspaceRoot: tempRoot, policyProfile: 'read-only' },
    });
    expect(fs.existsSync(path.join(tempRoot, 'forbidden.txt'))).toBe(false);
  });

  it('bounds returned text and file lists instead of exposing raw session history', async () => {
    const executor: VesselTaskExecutor = {
      async execute(args) {
        return {
          success: true,
          finalText: 'x'.repeat(300_000),
          steps: 4,
          changedFiles: Array.from({ length: 250 }, (_, index) => `file-${index}.txt`),
          diffSummary: 'd'.repeat(300_000),
          totalTokens: 100,
          sessionId: args.sessionId,
        };
      },
    };
    const server = createVesselMcpServer(executor);
    const response = await server.handle('tools/call', {
      name: 'run_vessel_task', arguments: { task: 'return result', includeDiff: true },
    }) as { content: { text: string }[] };
    const serialized = response.content[0]!.text;
    const result = JSON.parse(serialized) as { finalText: string; changedFiles: string[]; diffSummary: string };

    expect(result.finalText.length).toBeLessThan(16_410);
    expect(result.changedFiles).toHaveLength(100);
    expect(result.diffSummary.length).toBeLessThan(24_600);
    expect(serialized).not.toContain('history');
    expect(serialized.length).toBeLessThan(45_000);
  });

  it('supports non-blocking status and cancellation while a task request is pending', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const executor: VesselTaskExecutor = {
      async execute(args, signal, progress) {
        markStarted();
        progress({ step: 2, summary: 'Running deterministic stub.' });
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        return { success: false, finalText: 'cancelled', steps: 2, changedFiles: [], totalTokens: 0, sessionId: args.sessionId };
      },
    };
    const server = createVesselMcpServer(executor);
    const runRequest = server.handle('tools/call', {
      name: 'run_vessel_task', arguments: { task: 'long task', sessionId: 'job-1' },
    });
    await started;
    const statusResponse = await server.handle('tools/call', {
      name: 'query_vessel_task_status', arguments: { sessionId: 'job-1' },
    }) as { content: { text: string }[] };
    expect(JSON.parse(statusResponse.content[0]!.text)).toMatchObject({ status: 'running', step: 2 });
    const cancelResponse = await server.handle('tools/call', {
      name: 'cancel_vessel_task', arguments: { sessionId: 'job-1' },
    }) as { content: { text: string }[] };
    expect(JSON.parse(cancelResponse.content[0]!.text)).toEqual({ sessionId: 'job-1', cancelled: true });
    await runRequest;
    expect(server.status('job-1')?.status).toBe('cancelled');
    server.close();
  });

  it('rejects session IDs that could escape the session store path', async () => {
    const execute = vi.fn();
    const server = createVesselMcpServer({ execute });
    const response = await server.handle('tools/call', {
      name: 'run_vessel_task', arguments: { task: 'x', sessionId: '../outside' },
    }) as { isError: boolean; content: { text: string }[] };
    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toMatch(/sessionId may contain only/u);
    expect(execute).not.toHaveBeenCalled();
  });
});

function nextJsonRpcLine(output: PassThrough, send: () => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timeout = setTimeout(() => {
      output.off('data', onData);
      reject(new Error('timed out waiting for JSON-RPC response'));
    }, 2_000);
    const onData = (chunk: string | Buffer): void => {
      buffered += String(chunk);
      const newline = buffered.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      output.off('data', onData);
      resolve(buffered.slice(0, newline));
    };
    output.on('data', onData);
    if (!send()) {
      clearTimeout(timeout);
      output.off('data', onData);
      reject(new Error('failed to send JSON-RPC request'));
    }
  });
}
