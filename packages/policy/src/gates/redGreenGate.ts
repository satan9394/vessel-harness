import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Verdict } from '@vessel/shared';

export interface GateCommand { executable: string; args: string[] }
export interface RedGreenGateConfig {
  /** Strings are simple argv, never shell programs. Use structured argv for quoted arguments. */
  reproductionCommand: string | GateCommand;
  fullSuiteCommand?: string | GateCommand;
  cwd: string;
  /** Evaluator-owned test and fixture files: their bytes cannot change after Red. */
  reproductionFiles: string[];
  /** Files repaired by the generator; their Green snapshot must still match at completion. */
  sourceFiles: string[];
  timeoutMs?: number;
  allowBaselineFailureReasons?: string[];
}
export type RedGreenPhase = 'uninitialized' | 'red_verified' | 'green_verified' | 'rejected';
export interface GateExecution {
  command: string; exitCode: number | null; stdout: string; stderr: string; verifiedAt: string;
  failureSummary?: string; error?: string;
}
export interface RedGreenProof {
  id: string; phase: RedGreenPhase; redExecution: GateExecution;
  greenExecution?: GateExecution; regressionExecution?: GateExecution;
  regressionPassed?: boolean; signature: string;
}
export interface IRedGreenGate {
  verifyRedPhase(config: RedGreenGateConfig): Promise<{ success: boolean; proof: RedGreenProof; error?: string }>;
  verifyGreenPhase(proof: RedGreenProof, config: RedGreenGateConfig): Promise<{ success: boolean; proof: RedGreenProof; error?: string }>;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const signature = (proof: RedGreenProof) => hash(JSON.stringify({ ...proof, signature: '' }));
function targetOnlyFailure(execution: GateExecution, config: RedGreenGateConfig): boolean {
  // ponytail: accept one complete uncaught Node assertion; ambiguous runner reports fail closed.
  // A target substring in a whole suite does not prove that every failure is attributable to it.
  const output = execution.stderr.trim();
  // Node 26 moved the uncaught assertion throw site into this internal helper.
  return !execution.stdout.trim() && /^(?:node:assert[:/]|node:internal\/assert\/utils:\d+\r?\n)/.test(output)
    && /\nNode\.js v\d+\.\d+\.\d+$/.test(output)
    && (output.match(/^AssertionError(?: \[ERR_ASSERTION\])?:/gm) ?? []).length === 1
    && !/^(?!AssertionError)[A-Za-z]*Error(?: \[[^\]]+\])?:/m.test(output)
    && config.allowBaselineFailureReasons!.every(reason => output.includes(reason));
}

function command(value: string | GateCommand): GateCommand {
  const parsed = typeof value === 'string' ? (() => {
    if (/["';&|<>`\r\n]/.test(value)) throw new Error('Use structured argv; shell syntax is forbidden');
    const [executable = '', ...args] = value.trim().split(/\s+/);
    return { executable, args };
  })() : value;
  if (!parsed.executable || !Array.isArray(parsed.args) || parsed.args.some(arg => typeof arg !== 'string')
    || /^(?:.*[\\/])?(?:cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|sh|bash)$/i.test(parsed.executable)) {
    throw new Error('A non-shell executable and string argv are required');
  }
  return parsed;
}
function identity(config: RedGreenGateConfig): string {
  if (!config.reproductionFiles?.length || !config.sourceFiles?.length || !config.fullSuiteCommand
    || !config.allowBaselineFailureReasons?.length || config.allowBaselineFailureReasons.some(reason => !reason.trim())) {
    throw new Error('Evaluator must configure reproduction files, source files, full suite and target assertion features');
  }
  if (config.timeoutMs !== undefined && (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)) throw new Error('Invalid timeout');
  return hash(JSON.stringify({ ...config, cwd: resolve(config.cwd), reproductionCommand: command(config.reproductionCommand), fullSuiteCommand: command(config.fullSuiteCommand) }));
}
function files(config: RedGreenGateConfig, names: string[]): string {
  return hash(JSON.stringify(names.map(name => [resolve(config.cwd, name), hash(readFileSync(resolve(config.cwd, name)).toString('base64'))])));
}
async function execute(value: string | GateCommand, config: RedGreenGateConfig): Promise<GateExecution> {
  const argv = command(value);
  const record: GateExecution = { command: JSON.stringify(argv), exitCode: null, stdout: '', stderr: '', verifiedAt: '' };
  return new Promise(resolveResult => {
    const child = spawn(argv.executable, argv.args, { cwd: config.cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    // Bounded output and execution; an infrastructure failure is never a Red assertion.
    let bytes = 0;
    const collect = (field: 'stdout' | 'stderr', data: Buffer) => {
      bytes += data.length;
      if (bytes > 4 * 1024 * 1024) { record.error = 'Output limit exceeded'; child.kill(); }
      else record[field] += data.toString();
    };
    child.stdout.on('data', data => collect('stdout', data));
    child.stderr.on('data', data => collect('stderr', data));
    let killGrace: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      record.error = 'Execution timed out'; child.kill();
      // Descendants can inherit pipes. Never wait indefinitely for their close event.
      killGrace = setTimeout(() => {
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        record.verifiedAt = new Date().toISOString(); resolveResult(record);
      }, 1000);
    }, config.timeoutMs ?? 30000);
    child.on('error', error => { record.error = error.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(killGrace); record.exitCode = code; record.verifiedAt = new Date().toISOString();
      if (signal) record.error ??= `Terminated by ${signal}`;
      resolveResult(record);
    });
  });
}

/** Trusted evaluator state owns authority. A recomputed public SHA-256 alone grants nothing. */
export class RedGreenGate implements IRedGreenGate {
  #active?: { proof: RedGreenProof; config: RedGreenGateConfig; identity: string; tests: string; baselineSources: string; sources?: string };
  #busy = false;

  private publish(proof: RedGreenProof) { proof.signature = signature(proof); return structuredClone(proof); }

  async verifyRedPhase(config: RedGreenGateConfig) {
    if (this.#busy) throw new Error('Evaluator execution already in progress');
    this.#busy = true; this.#active = undefined;
    const proof: RedGreenProof = { id: randomUUID(), phase: 'rejected', redExecution: { command: '', exitCode: null, stdout: '', stderr: '', verifiedAt: '' }, signature: '' };
    try {
      const saved = structuredClone(config); const id = identity(saved); const tests = files(saved, saved.reproductionFiles);
      const baselineSources = files(saved, saved.sourceFiles);
      proof.redExecution = await execute(saved.reproductionCommand, saved);
      if (proof.redExecution.error || proof.redExecution.exitCode === null || proof.redExecution.exitCode === 0 || !targetOnlyFailure(proof.redExecution, saved)
        || files(saved, saved.reproductionFiles) !== tests || files(saved, saved.sourceFiles) !== baselineSources) throw new Error('Red must fail on the configured target assertion with unchanged evaluator tests and baseline sources');
      proof.redExecution.failureSummary = saved.allowBaselineFailureReasons!.join('; ');
      proof.phase = 'red_verified'; this.publish(proof);
      this.#active = { proof, config: saved, identity: id, tests, baselineSources };
      return { success: true, proof: structuredClone(proof) };
    } catch (error) { return { success: false, proof: this.publish(proof), error: String(error) }; }
    finally { this.#busy = false; }
  }

  async verifyGreenPhase(proof: RedGreenProof, config: RedGreenGateConfig) {
    if (this.#busy) throw new Error('Evaluator execution already in progress');
    this.#busy = true;
    const active = this.#active; this.#active = undefined;
    const result = structuredClone(active?.proof ?? proof); result.phase = 'rejected';
    try {
      if (!active || active.proof.phase !== 'red_verified' || JSON.stringify(active.proof) !== JSON.stringify(proof)
        || proof.signature !== signature(proof) || identity(config) !== active.identity
        || files(active.config, active.config.reproductionFiles) !== active.tests) throw new Error('Missing, changed or untrusted Red proof/test identity');
      const sources = files(active.config, active.config.sourceFiles);
      if (sources === active.baselineSources) throw new Error('No source repair since the verified Red baseline');
      result.greenExecution = await execute(active.config.reproductionCommand, active.config);
      if (result.greenExecution.error || result.greenExecution.exitCode !== 0) throw new Error('Reproduction remains Red');
      result.regressionExecution = await execute(active.config.fullSuiteCommand!, active.config);
      if (result.regressionExecution.error || result.regressionExecution.exitCode !== 0) throw new Error('Full regression suite failed');
      if (files(active.config, active.config.reproductionFiles) !== active.tests || files(active.config, active.config.sourceFiles) !== sources) throw new Error('Files changed while evaluator ran');
      result.phase = 'green_verified'; result.regressionPassed = true; this.publish(result);
      this.#active = { ...active, proof: result, sources };
      return { success: true, proof: structuredClone(result) };
    } catch (error) { result.regressionPassed = false; return { success: false, proof: this.publish(result), error: String(error) }; }
    finally { this.#busy = false; }
  }

  completionVerdict(cwd?: string): Verdict | undefined {
    const active = this.#active;
    try {
      if (!this.#busy && active?.proof.phase === 'green_verified' && active.proof.regressionPassed
        && (cwd === undefined || resolve(cwd) === resolve(active.config.cwd))
        && files(active.config, active.config.reproductionFiles) === active.tests && files(active.config, active.config.sourceFiles) === active.sources) return;
    } catch { /* Missing files invalidate completion. */ }
    return { action: 'deny', decisionPath: ['gate:red-green'], ruleRef: 'gate:red-green', reason: '[Policy Deny] Missing valid evaluator Red→Green and full regression evidence' };
  }
}
