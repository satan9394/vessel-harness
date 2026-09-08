import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ChatProvider, PolicyArtifacts, ToolSpec } from '@vessel/shared';
import type { EventBus } from '@vessel/core';
import { createFsTools, createSearchTools, type FsPolicyConfig } from '@vessel/tools';
import { createIsolatedRuntime } from '../subagent/IsolatedRuntime.js';
import type { EvaluatorVerdict, EvaluatorVerdictKind } from './Evaluator.js';

export interface EvaluatorAgentOptions {
  workspaceRoot: string;
  cwd?: string;
  provider: ChatProvider;
  model: string;
  policyArtifacts: PolicyArtifacts;
  /** parent bus — optional; evaluator events are visible here (subagent_start/stop mirror) */
  bus?: EventBus;
  /** read-only tool set for evidence inspection (default: Read/Glob/Grep bound to workspace) */
  tools?: ToolSpec[];
  stableSections?: string[];
  policyGuidance?: string[];
  /**
   * Session/record label (task 058): recorded in the isolated session's B10
   * session/created.agentPreset so an Internal Reviewer run is distinguishable
   * from a plain evaluator run. Default: 'evaluator'.
   */
  agentPreset?: string;
}

export interface EvaluationRequest {
  goal: string;
  /** the generator's claimed artifact (final text / transcript tail) — never trusted as proof */
  generatorOutput: string;
  /** acceptance criteria the verdict is judged against */
  acceptance?: string[];
  /** read-only disk evidence paths the evaluator MAY inspect (transcript_and_disk, E49) */
  evidencePaths?: string[];
  delegationDepth?: number;
  /**
   * Internal Review output mode (task 058): when true the brief additionally
   * requires unmet (failed acceptance criteria) + suggestions (feedback for the
   * generator side) and the parser captures them on the returned verdict.
   */
  review?: boolean;
}

/** Default read-only exploration toolset for the evaluator agent (transcript + disk evidence). */
export function createReadOnlyExplorationTools(workspaceRoot: string, fsPolicy?: FsPolicyConfig): ToolSpec[] {
  const policy: FsPolicyConfig = fsPolicy ?? { protected: ['.git', '.git/**'], denyRead: [], allow: [] };
  const [read] = createFsTools({ workspaceRoot, fsPolicy: policy });
  return [read!, ...createSearchTools({ workspaceRoot, fsPolicy: policy })];
}

const VERDICTS: ReadonlySet<string> = new Set(['met', 'not_met', 'impossible', 'error']);

/**
 * Review-mode JSON line (task 058): evaluator emits unmet + suggestions so the
 * Internal Reviewer conclusion carries generator-side feedback, not just a verdict.
 */
export const REVIEW_OUTPUT_SCHEMA =
  '只输出一行 JSON：{"verdict":"met|not_met|impossible|error","evidence":["..."],"reason":"...",' +
  '"unmet":["..."],"suggestions":["..."]}（not_met/impossible 时 unmet=未满足的验收标准、suggestions=给生成方的改进建议）';

function buildReviewBrief(req: EvaluationRequest): string {
  const lines = [
    '你是独立 Evaluator Agent。你的评审对象是 Generator 的产出，由你独立判定，不信任任何自证。',
    `目标：${req.goal}`,
  ];
  if (req.acceptance?.length) lines.push(`验收标准：\n${req.acceptance.map((a) => `- ${a}`).join('\n')}`);
  lines.push('Generator 产出（仅供参考，需用证据核验）：\n' + req.generatorOutput.slice(0, 8000));
  if (req.evidencePaths?.length) {
    lines.push('可用只读证据（可用 Read/Glob/Grep 检查）：\n' + req.evidencePaths.map((p) => `- ${p}`).join('\n'));
  }
  lines.push('');
  lines.push(req.review ? REVIEW_OUTPUT_SCHEMA : '只输出一行 JSON：{"verdict":"met|not_met|impossible|error","evidence":["..."],"reason":"..."}');
  return lines.join('\n');
}

/**
 * 容错解析评审/评估 JSON（单一实现，供 evaluator 会话与 TeamRuntime/InternalReviewer 共用）：
 * 优先整段 JSON，其次抽取文本中的 {…} 对象；verdict 不合法 → verdict 'error'
 * （如实暴露、绝不误判 met，Generator 不得自证完成）。文本前后可有叙述（真实模型常见）。
 * review 模式要求 unmet/suggestions，缺省给空数组（verdict 模式不受影响）。
 */
export function parseVerdict(text: string): EvaluatorVerdict {
  const candidates = [text.trim(), /(\{[\s\S]*\})/.exec(text)?.[1] ?? ''];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed = JSON.parse(c) as { verdict?: string; evidence?: unknown; reason?: unknown; unmet?: unknown; suggestions?: unknown };
      if (parsed.verdict && VERDICTS.has(parsed.verdict)) {
        return {
          verdict: parsed.verdict as EvaluatorVerdictKind,
          evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
          reason: typeof parsed.reason === 'string' ? parsed.reason : 'no reason',
          unmet: Array.isArray(parsed.unmet) ? parsed.unmet.map(String) : [],
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
        };
      }
    } catch {
      // try next candidate
    }
  }
  return { verdict: 'error', evidence: [], reason: `evaluator agent output is not a valid verdict JSON: ${text.slice(0, 200)}`, unmet: [], suggestions: [] };
}

/**
 * Evaluator Agent (ARCHITECTURE §4.10 / D3 decision point 12 / H12) — the
 * independent-review agent FORM of the Evaluator contract.
 *
 * Runs in an ISOLATED session (source='evaluator') with a read-only tool set,
 * reviewing the generator's output + read-only disk evidence. It emits
 * met/not_met/impossible/error + evidence. The generator never self-declares
 * completion: its output is data for this agent to verify, not proof.
 */
export class EvaluatorAgent {
  private readonly tools: ToolSpec[];
  private readonly opts: EvaluatorAgentOptions;

  constructor(opts: EvaluatorAgentOptions) {
    this.opts = opts;
    this.tools = opts.tools ?? createReadOnlyExplorationTools(path.resolve(opts.workspaceRoot));
  }

  get visibleTools(): readonly ToolSpec[] {
    return this.tools;
  }

  async evaluate(req: EvaluationRequest): Promise<EvaluatorVerdict> {
    const runtime = await createIsolatedRuntime({
      workspaceRoot: path.resolve(this.opts.workspaceRoot),
      cwd: this.opts.cwd,
      provider: this.opts.provider,
      model: this.opts.model,
      policyArtifacts: this.opts.policyArtifacts,
      tools: this.tools,
      source: 'evaluator',
      agentPreset: this.opts.agentPreset,
      delegationDepth: req.delegationDepth ?? 0,
      stableSections: this.opts.stableSections,
      policyGuidance: this.opts.policyGuidance,
    });
    try {
      // A23/A24 mirrors: the evaluator child is observable on the parent bus
      if (this.opts.bus) {
        await this.opts.bus.emit('subagent_start', {
          delegateId: `eval_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          childAgentId: `eval_agent_${runtime.session.sessionId}`,
          childSessionId: runtime.session.sessionId,
          preset: this.opts.agentPreset ?? 'evaluator',
          isContinuable: false,
        });
      }
      const turn = await runtime.loop.runTurn(buildReviewBrief(req));
      const verdict = parseVerdict(turn.finalText);
      if (this.opts.bus) {
        await this.opts.bus.emit('subagent_stop', {
          delegateId: `eval_${Date.now()}`,
          childAgentId: `eval_agent_${runtime.session.sessionId}`,
          childSessionId: runtime.session.sessionId,
          result: { output: turn.finalText, stopReason: 'completed' },
          isError: verdict.verdict === 'error',
          durationMs: turn.durationMs,
          delegationDepth: req.delegationDepth ?? 0,
        });
      }
      return verdict;
    } finally {
      await runtime.close();
    }
  }
}
