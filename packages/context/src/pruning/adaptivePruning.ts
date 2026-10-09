import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript-parser';
import type { ChatMessage } from '@vessel/shared';
import { canonicalJson } from '@vessel/llm';
import type { SymbolGraphService } from '../ast/symbolGraph.js';
import { estimateTokens } from '../builder/Builder.js';
import type { BlastRadius, ContextPruneOptions, IAdaptiveContextPruner, PrunedContextResult } from './types.js';

const execute = promisify(execFile);
/** Git's NUL records preserve spaces and newlines in filenames; no shell or repository mutation. */
export async function gitModifiedFiles(workspaceRoot: string): Promise<string[]> {
  const outputs = await Promise.all([
    ['diff', '--name-only', '-z', '--no-renames'],
    ['diff', '--cached', '--name-only', '-z', '--no-renames'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ].map(args => execute('git', args, { cwd: workspaceRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })));
  return [...new Set(outputs.flatMap(output => output.stdout.split('\0').filter(Boolean)))].sort();
}

/** Parse tool content, never read a second copy from disk or execute it. */
export function sourceSkeleton(file: string, text: string): string | undefined {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  // Read outputs with line-number decoration or malformed syntax must not be presented as a parsed signature.
  if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) return undefined;
  const printer = ts.createPrinter({ removeComments: true });
  const signatures: string[] = [];
  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported && !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    // A syntax-only skeleton cannot invent the inferred return type of an exported callable.
    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(node => node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) && !node.type && !node.initializer.type)) return undefined;
    const transformed = ts.transform<ts.Statement>(statement, [context => root => {
      const visit: ts.Visitor = node => {
        if (ts.isFunctionDeclaration(node)) return context.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, undefined);
        if (ts.isMethodDeclaration(node)) return context.factory.updateMethodDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.questionToken, node.typeParameters, node.parameters, node.type, undefined);
        if (ts.isConstructorDeclaration(node)) return context.factory.updateConstructorDeclaration(node, node.modifiers, node.parameters, undefined);
        if (ts.isGetAccessorDeclaration(node)) return context.factory.updateGetAccessorDeclaration(node, node.modifiers, node.name, node.parameters, node.type, undefined);
        if (ts.isSetAccessorDeclaration(node)) return context.factory.updateSetAccessorDeclaration(node, node.modifiers, node.name, node.parameters, undefined);
        if (ts.isVariableDeclaration(node)) {
          const callable = node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer : undefined;
          const type = node.type ?? (callable?.type ? context.factory.createFunctionTypeNode(callable.typeParameters,
            callable.parameters.map(parameter => context.factory.updateParameterDeclaration(parameter, undefined, parameter.dotDotDotToken,
              parameter.name, parameter.questionToken ?? (parameter.initializer ? context.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined), parameter.type, undefined)), callable.type) : undefined);
          return context.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, type, undefined);
        }
        if (ts.isPropertyDeclaration(node)) return context.factory.updatePropertyDeclaration(node, node.modifiers, node.name, node.questionToken ?? node.exclamationToken, node.type, undefined);
        if (ts.isClassStaticBlockDeclaration(node)) return undefined;
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(root, visit) as ts.Statement;
    }]);
    try { signatures.push(printer.printNode(ts.EmitHint.Unspecified, transformed.transformed[0]!, source)); }
    finally { transformed.dispose(); }
  }
  return signatures.length ? signatures.join('\n') : undefined;
}

export class AdaptiveContextPruner implements IAdaptiveContextPruner {
  private loadedFiles: string[] = [];
  private activeLoadedFiles: string[] = [];
  constructor(private readonly deps: {
    workspaceRoot: string;
    graph: Pick<SymbolGraphService, 'findSymbols' | 'getGraph'>;
    /** Refreshes only explicitly configured files through the shared filesystem guards. */
    refreshGraph: () => Promise<void>;
    modifiedFiles?: () => Promise<string[]>;
    activeFiles?: () => readonly string[];
    estimateTokens?: (text: string) => number;
  }) {}
  private file(file: string): string { return path.relative(this.deps.workspaceRoot, path.resolve(this.deps.workspaceRoot, file)).replace(/\\/g, '/'); }
  async computeBlastRadius(modifiedFiles: string[]): Promise<BlastRadius> {
    await this.deps.refreshGraph();
    const modified = [...new Set(modifiedFiles.map(file => this.file(file)))].sort();
    const dependencies = new Set<string>();
    for (const filePath of modified) {
      for (const symbol of await this.deps.graph.findSymbols({ filePath })) {
        for (const node of (await this.deps.graph.getGraph(symbol.id, { maxDepth: 1, direction: 'both' })).nodes)
          if (!modified.includes(node.filePath)) dependencies.add(node.filePath);
      }
    }
    const directDependencies = [...dependencies].sort();
    const active = new Set([...this.activeLoadedFiles, ...(this.deps.activeFiles?.() ?? []).map(file => this.file(file))]);
    return { modifiedFiles: modified, directDependencies,
      unrelatedFiles: this.loadedFiles.filter(file => !modified.includes(file) && !dependencies.has(file) && !active.has(file)) };
  }
  async prune(messages: ChatMessage[], options: ContextPruneOptions): Promise<{ messages: ChatMessage[]; result: PrunedContextResult }> {
    if (!Number.isFinite(options.tokenThreshold) || options.tokenThreshold < 0 || !Number.isFinite(options.targetTokenBudget)
      || options.targetTokenBudget < 0 || !Number.isInteger(options.preserveRecentTurns) || options.preserveRecentTurns < 3)
      throw new RangeError('Invalid pruning budget or recent turns (minimum 3)');
    const estimate = this.deps.estimateTokens ?? estimateTokens;
    const count = (value: ChatMessage[]) => estimate(canonicalJson(value));
    const calls = new Map<string, { file?: string; read: boolean; diff: boolean; group: number; index: number }>();
    let group = -1;
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index]!;
      if (message.role === 'assistant') group++;
      for (const call of message.toolCalls ?? []) calls.set(call.id, { group, index, read: call.name === 'Read',
        diff: call.name === 'Diff' || (call.name === 'Shell' && typeof call.arguments.command === 'string' && /\bdiff\b/.test(call.arguments.command)),
        file: typeof call.arguments.path === 'string' ? this.file(call.arguments.path) : undefined });
    }
    this.loadedFiles = [...new Set([...calls.values()].flatMap(call => call.file ? [call.file] : []))].sort();
    this.activeLoadedFiles = [...new Set([...calls.entries()].flatMap(([id, call]) => call.file && (call.group > group - options.preserveRecentTurns
      || !messages.some(message => message.role === 'tool' && message.toolCallId === id)) ? [call.file] : []))];
    const blastRadius = await this.computeBlastRadius(await (this.deps.modifiedFiles?.() ?? gitModifiedFiles(this.deps.workspaceRoot)));
    const protectedFiles = new Set([...blastRadius.modifiedFiles, ...blastRadius.directDependencies, ...this.activeLoadedFiles, ...(this.deps.activeFiles?.() ?? []).map(file => this.file(file))]);
    const originalTokenCount = count(messages);
    const result: PrunedContextResult = { originalTokenCount, prunedTokenCount: originalTokenCount, blastRadius, prunedTurnsSummary: [] };
    const output = [...messages];
    const errorGroups = new Set<number>();
    for (const message of messages) if (message.role === 'tool' && (options.protectedToolCallIds?.includes(message.toolCallId ?? '') || /^\[[^\]\n]+\]/.test(message.content))) {
      const call = calls.get(message.toolCallId ?? ''); if (call) errorGroups.add(call.group);
    }
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index]!;
      if (message.role !== 'tool') continue;
      const call = calls.get(message.toolCallId ?? '');
      let action: 'skeletonized' | 'summarized' | 'retained' = 'retained';
      // Only a result belonging to an earlier completed assistant group is eligible.
      const complete = call && (messages[call.index]!.toolCalls ?? []).every(item => messages.some(m => m.role === 'tool' && m.toolCallId === item.id));
      if (originalTokenCount > options.tokenThreshold && result.prunedTokenCount > options.targetTokenBudget && complete
        && call.group <= group - options.preserveRecentTurns && !errorGroups.has(call.group) && !call.diff
        && (!call.file || !protectedFiles.has(call.file))) {
        const hash = createHash('sha256').update(message.content).digest('hex');
        const sourceRead = call.read && call.file && /\.[cm]?[jt]sx?$/.test(call.file);
        const skeleton = sourceRead ? sourceSkeleton(call.file!, message.content) : undefined;
        const content = skeleton ? `[AST skeleton; sha256=${hash}; file=${call.file}]\n${skeleton}`
          : `[Archived tool output; sha256=${hash}; tool=${message.name ?? 'unknown'}; ${message.content.length} characters, ${message.content.split('\n').length} lines captured. Full output remains in session history.]`;
        if ((!sourceRead || skeleton) && estimate(content) < estimate(message.content)) {
          output[index] = { ...message, content }; action = skeleton ? 'skeletonized' : 'summarized';
          result.prunedTokenCount = count(output);
        }
      }
      result.prunedTurnsSummary.push({ turnIndex: index, action });
    }
    return { messages: output, result };
  }
}
