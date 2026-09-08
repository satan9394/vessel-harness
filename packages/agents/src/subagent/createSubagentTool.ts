import type { ToolSpec } from '@vessel/shared';
import type { SubagentManager } from './SubagentManager.js';

export interface SubagentToolOptions {
  /** base delegation depth for calls made through this tool (0 for a top-level parent) */
  delegationDepth?: number;
  /** optional default depth limit per delegation */
  depthLimit?: number;
  /** optional default agent preset label attached to delegations (决策点 12: roles are presets) */
  preset?: string;
}

/**
 * agents/subagent — `Subagent` tool (D3 decision point 12 / H11).
 * Registered like any other tool so it flows through the same pipeline:
 * BeforeTool → Policy Engine → Execute → AfterTool. The child runs in an
 * isolated session; only the frozen result contract reaches the model
 * (info hiding — parent never sees the child's intermediate records).
 */
export function createSubagentTool(manager: SubagentManager, opts: SubagentToolOptions = {}): ToolSpec {
  return {
    name: 'Subagent',
    description:
      '派生一个独立上下文/独立会话的子代理执行隔离子任务，完成后回传结果。父 Agent 只见结果摘要，不见子代理中间过程。可选 preset 标记执行者角色（developer/explorer/reviewer/planner 等，决策点 12：角色=预设配置）。',
    family: 'other',
    requiredPermission: 'workspace-write',
    exclusive: false,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '子代理任务说明（必须自包含，不依赖父上下文）' },
        preset: { type: 'string', description: '执行者角色预设标签（可选：developer/explorer/reviewer/planner 等）' },
        tool_filter: { type: 'array', items: { type: 'string' }, description: '只允许子代理使用的工具名（只能收窄）' },
        output_schema: { type: 'object', description: '期望的结构化输出 JSON schema（可选；输出为 JSON 时自动捕获）' },
        depth_limit: { type: 'number', description: '本次委派深度上限覆盖（默认由管理器决定）' },
      },
      required: ['prompt'],
    },
    async execute(args, ctx) {
      const prompt = String(args.prompt ?? '');
      if (!prompt.trim()) {
        return {
          content: '',
          error: { errorClass: 'INVALID_ARGS', message: 'Subagent: prompt is required' },
          meta: {},
        };
      }
      const preset = args.preset != null ? String(args.preset) : opts.preset;
      const toolFilter = Array.isArray(args.tool_filter) ? args.tool_filter.map(String) : undefined;
      const depthLimit = args.depth_limit != null ? Number(args.depth_limit) : opts.depthLimit;
      const request = {
        prompt,
        delegationDepth: opts.delegationDepth ?? 0,
        preset,
        toolFilter,
        outputSchema: args.output_schema as Record<string, unknown> | undefined,
        depthLimit,
      };
      // task 050: forward the parent turn's signal — an interrupt aborts the
      // child turn. When no turn signal is present the call keeps its legacy
      // single-argument shape.
      const result = ctx?.signal ? await manager.delegate(request, { signal: ctx.signal }) : await manager.delegate(request);

      if (result.stopReason === 'denied') {
        return {
          content: '',
          error: { errorClass: 'DENIED', message: `Subagent 委派被拒：${result.diagnostic ?? ''}` },
          meta: { subagent: { stopReason: result.stopReason } },
        };
      }
      if (result.isError) {
        return {
          content: '',
          error: { errorClass: 'TOOL_FAILURE', message: `Subagent ${result.stopReason}: ${result.diagnostic ?? result.output}` },
          meta: { subagent: { stopReason: result.stopReason, childSessionId: result.childSessionId } },
        };
      }
      return {
        content: result.output,
        meta: {
          subagent: {
            stopReason: result.stopReason,
            childSessionId: result.childSessionId,
            delegationDepth: result.delegationDepth,
            durationMs: result.durationMs,
            preset,
          },
        },
      };
    },
  };
}
