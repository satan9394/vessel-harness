import * as crypto from 'node:crypto';
import type {
  ChatMessage,
  ChatToolDef,
  SessionRecord,
  ToolSpec,
} from '@cah/shared';
import { COMPACTION_THRESHOLD_RATIO, DEFAULT_CONTEXT_WINDOW } from '@cah/shared';
import { Session } from '@cah/core';
import type { Instruction } from '../instructions/Instructions.js';

export interface RequestEnvelope {
  model: string;
  messages: ChatMessage[];
  tools: ChatToolDef[];
  estimateTokens: number;
}

export interface BuilderDeps {
  session: Session;
  model: string;
  /** behavior-compiled stable prompt sections (L2/L3 output), cached per session */
  stableSections: () => string[];
  /** policy Prompt Guidance (soft channel), cached per session */
  policyGuidance: () => string[];
  /** AGENTS.md chain — injected once per session as user messages (可回放可压缩) */
  instructions: () => Instruction[];
  /** Project Memory frozen snapshot — injected once per session as a user message with source='memory' (V0.3-M1) */
  projectMemory?: () => string;
  getVisibleTools: () => ToolSpec[];
  /** volatile layer (skills index / environment / timestamp) */
  volatileText?: () => string;
  contextWindow?: number;
  estimateTokens?: (text: string) => number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function recordToMessage(r: SessionRecord): ChatMessage {
  switch (r.type) {
    case 'user/message':
      return { role: 'user', content: r.content };
    case 'assistant/message':
      return { role: 'assistant', content: r.content };
    case 'assistant/attempt': {
      return {
        role: 'assistant',
        content: r.content,
        toolCalls: r.toolCalls.map((tc) => ({
          id: tc.toolCallId,
          name: tc.name,
          arguments: tc.arguments as Record<string, unknown>,
        })),
      };
    }
    case 'tool/result':
      return {
        role: 'tool',
        content: r.error ? `[${r.error.errorClass}] ${r.error.message}` : (r.content ?? ''),
        name: r.toolName,
        toolCallId: r.toolCallId,
      };
    default:
      return { role: 'user', content: '' };
  }
}

/**
 * context/builder — L4 assembly (ARCHITECTURE §2.4):
 * stable (cached per session, prefix-cache friendly) → project instructions
 * (user messages, source='instruction') → volatile. Model history derives from
 * the session surface projection (模型可见 ⟺ 已记录).
 */
export class ContextBuilder {
  private stableLayer: ChatMessage[] | null = null;
  private injected = false;
  private readonly contextWindow: number;
  private readonly estimate: (t: string) => number;

  constructor(private readonly deps: BuilderDeps) {
    this.contextWindow = deps.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    this.estimate = deps.estimateTokens ?? estimateTokens;
  }

  async assemble(step: number): Promise<RequestEnvelope> {
    const session = this.deps.session;

    // stable layer — assembled once per session, reused across turns (prefix cache)
    if (!this.stableLayer) {
      const stable = [
        '你是 Composable Agent Harness V0.1 的编码代理。',
        ...this.deps.stableSections(),
        ...this.deps.policyGuidance(),
      ].join('\n\n');
      this.stableLayer = [{ role: 'system', content: stable }];
    }

    // project instructions — injected once per session, persisted as user messages
    if (!this.injected) {
      for (const instr of this.deps.instructions()) {
        await session.append({
          type: 'user/message',
          msgId: `m_instr_${crypto.randomBytes(4).toString('hex')}`,
          role: 'user',
          content: `[指令文件 ${instr.sourcePath}]\n${instr.content}`,
          source: 'instruction',
          surface: true,
        });
      }
      // Project Memory frozen snapshot — once per session, source='memory' (可回放可压缩)
      const memSnap = this.deps.projectMemory?.() ?? '';
      if (memSnap) {
        await session.append({
          type: 'user/message',
          msgId: `m_mem_${crypto.randomBytes(4).toString('hex')}`,
          role: 'user',
          content: memSnap,
          source: 'memory',
          surface: true,
        });
      }
      this.injected = true;
    }

    // derived history from surface projection
    const history: ChatMessage[] = session.surface().map(recordToMessage).filter((m) => m.content !== '' || (m.toolCalls?.length ?? 0) > 0);

    // volatile layer
    const volatileText = this.deps.volatileText?.() ?? '';
    const volatileMsg: ChatMessage = volatileText
      ? { role: 'user', content: `[环境] ${volatileText}` }
      : { role: 'user', content: '' };

    const messages: ChatMessage[] = [...this.stableLayer, ...history];
    if (volatileMsg.content) messages.push(volatileMsg);

    // visible tool schemas (denied tools already trimmed by the registry)
    const tools: ChatToolDef[] = this.deps.getVisibleTools().map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as unknown as Record<string, unknown>,
      },
    }));

    const estimateTokens = this.estimate(JSON.stringify(messages)) + this.estimate(JSON.stringify(tools));

    void step;
    return { model: this.deps.model, messages, tools, estimateTokens };
  }

  get pressureRatio(): number {
    return COMPACTION_THRESHOLD_RATIO;
  }

  get window(): number {
    return this.contextWindow;
  }

  /** compaction replaced the log — drop stable cache? No: stable stays; force re-derive history by clearing injected flag is not needed (records are persisted). */
}
