import fs from 'node:fs';
import path from 'node:path';
import { SymbolGraphService } from '@vessel/context';
import type { ToolSpec } from '@vessel/shared';
import { assertConfined, assertNoNul, assertReadable, assertSizeWithin, canonicalize, type FsPolicyConfig } from '../filesystem/guards.js';

export const SymbolGraphToolDefinition = {
  name: 'code_symbol_graph',
  description: 'Query exact TypeScript/JavaScript symbols and workspace dependency graphs from explicitly indexed files.',
  parameters: {
    type: 'object' as const,
    properties: {
      action: { type: 'string', enum: ['find_symbol', 'get_references', 'get_dependents', 'get_module_graph'] },
      filePath: { type: 'string', description: 'Workspace-relative file path' },
      symbolName: { type: 'string', description: 'Exact symbol name' },
      maxDepth: { type: 'number', description: 'Dependency depth, default 1, maximum 3' },
    },
    required: ['action'],
  },
};

/** The host opts into an explicit file set; imports never trigger filesystem discovery. */
export function createSymbolGraphAccess(options: {
  workspaceRoot: string; fsPolicy: FsPolicyConfig; filePaths: string[];
  paths?: Record<string, string[]>; baseUrl?: string;
}) {
  const root = path.resolve(options.workspaceRoot);
  const guard = (file: string) => {
    const canonical = canonicalize(root, file);
    assertReadable(root, canonical, options.fsPolicy);
    assertConfined(root, canonical, 'read', options.fsPolicy);
    return canonical;
  };
  const graph = new SymbolGraphService({ workspaceRoot: root, paths: options.paths, baseUrl: options.baseUrl, readFile: file => {
    const canonical = guard(file);
    const stat = fs.statSync(canonical);
    if (!stat.isFile()) throw new Error('not a file');
    assertSizeWithin(stat.size);
    const text = fs.readFileSync(canonical, 'utf8'); assertNoNul(text); return text;
  } });
  const refresh = async () => {
    for (const file of options.filePaths) guard(file);
    await graph.indexFiles(options.filePaths);
  };
  const tool: ToolSpec = {
    name: SymbolGraphToolDefinition.name, description: SymbolGraphToolDefinition.description,
    inputSchema: SymbolGraphToolDefinition.parameters, family: 'file_read', requiredPermission: 'read', exclusive: false,
    async execute(args) {
      const actions = ['find_symbol', 'get_references', 'get_dependents', 'get_module_graph'];
      if (typeof args.action !== 'string' || !actions.includes(args.action)
        || (args.filePath !== undefined && (typeof args.filePath !== 'string' || args.filePath.length === 0))
        || (args.symbolName !== undefined && (typeof args.symbolName !== 'string' || args.symbolName.length === 0))
        || (args.maxDepth !== undefined && (typeof args.maxDepth !== 'number' || !Number.isInteger(args.maxDepth) || args.maxDepth < 1 || args.maxDepth > 3)))
        return { content: '', error: { errorClass: 'INVALID_ARGS', message: 'Invalid action, filePath, symbolName or maxDepth (1–3).' }, meta: {} };
      try {
        if (args.filePath) guard(args.filePath as string);
        // Re-check every cached file before querying, even when content is unchanged.
        await refresh();
        const query = { filePath: args.filePath as string | undefined, symbolName: args.symbolName as string | undefined };
        if (args.action === 'find_symbol') {
          const nodes = await graph.findSymbols(query);
          return { content: JSON.stringify({ nodes, ...(nodes.length ? {} : { message: 'No matching symbol in indexed files.' }) }), meta: {} };
        }
        if (args.action === 'get_module_graph' && !args.filePath)
          return { content: '', error: { errorClass: 'INVALID_ARGS', message: 'filePath required for get_module_graph' }, meta: {} };
        const roots = await graph.findSymbols(args.action === 'get_module_graph' ? { filePath: query.filePath, kind: 'module' } : query);
        if (roots.length === 0) return { content: JSON.stringify({ nodes: [], edges: [], message: 'No matching symbol in indexed files.' }), meta: {} };
        const results = await Promise.all(roots.map(node => args.action === 'get_references'
          ? graph.getGraph(node.id, { direction: 'incoming', relations: ['references', 'implements'], maxDepth: (args.maxDepth as number | undefined) ?? 1 })
          : graph.getGraph(node.id, { direction: args.action === 'get_dependents' ? 'incoming' : 'outgoing', maxDepth: (args.maxDepth as number | undefined) ?? 1 })));
        return { content: JSON.stringify({ nodes: [...new Map(results.flatMap(result => result.nodes).map(node => [node.id, node])).values()],
          edges: [...new Map(results.flatMap(result => result.edges).map(edge => [JSON.stringify(edge), edge])).values()] }), meta: {} };
      } catch (error) {
        const err = error as Error & { guard?: string };
        return { content: '', error: { errorClass: err.guard ? 'DENIED' : 'TOOL_FAILURE', message: err.message }, meta: err.guard ? { guard: err.guard } : {} };
      }
    },
  };
  return { graph, refresh, tool };
}

export function createSymbolGraphTool(options: Parameters<typeof createSymbolGraphAccess>[0]): ToolSpec {
  return createSymbolGraphAccess(options).tool;
}
