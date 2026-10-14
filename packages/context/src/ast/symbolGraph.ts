import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript-parser';
import type { DependencyRelation, ISymbolGraphService, SymbolEdge, SymbolGraphQuery, SymbolKind, SymbolNode } from './types.js';

interface ReferenceSite {
  fromId: string;
  relation: DependencyRelation;
  node: ts.Node;
  lookupKey: ts.Node | string;
  toId?: string;
  refresh: boolean;
}

/** Explicit-file, transient compiler graph: the compiler host never reads imports from disk. */
export class SymbolGraphService implements ISymbolGraphService {
  private sources = new Map<string, ts.SourceFile>();
  private program?: ts.Program;
  private nodes = new Map<string, SymbolNode>();
  private edges: SymbolEdge[] = [];
  private fileEdges = new Map<string, SymbolEdge[]>();
  private declarationIds = new WeakMap<ts.Node, string>();
  private names = new WeakSet<ts.Node>();
  private referenceSites = new Map<string, ReferenceSite[]>();
  private refreshStats = { traversedFiles: [] as string[], checkerLookups: 0, moduleResolutions: 0 };
  private readonly absolutePaths = new Map<string, string>();
  private readonly relativePaths = new Map<string, string>();
  private readonly moduleResolutions = new Map<string, ts.ResolvedModule | undefined>();
  private compilerOptions: ts.CompilerOptions;
  private resolutionConfiguration: string;
  private readonly compilerHost: ts.CompilerHost;
  private indexing: Promise<void> = Promise.resolve();
  /** Diagnostics for verifying incremental work, without exposing mutable graph/cache state. */
  getRefreshStats(): { traversedFiles: string[]; checkerLookups: number; moduleResolutions: number } {
    return { ...this.refreshStats, traversedFiles: [...this.refreshStats.traversedFiles] };
  }
  constructor(private readonly options: {
    workspaceRoot: string;
    readFile?: (filePath: string) => string | undefined;
    /** Explicit compiler path mappings; resolution remains inside the indexed set. */
    paths?: Record<string, string[]>;
    baseUrl?: string;
  }) {
    this.compilerOptions = { noLib: true, allowJs: true, target: ts.ScriptTarget.Latest,
      moduleResolution: ts.ModuleResolutionKind.Node10, paths: structuredClone(options.paths),
      baseUrl: path.resolve(options.workspaceRoot, options.baseUrl ?? '.') };
    this.resolutionConfiguration = JSON.stringify({ paths: options.paths, baseUrl: options.baseUrl });
    const resolutionHost: ts.ModuleResolutionHost = {
      fileExists: file => this.sources.has(this.absolute(file)),
      readFile: file => this.sources.get(this.absolute(file))?.text,
      directoryExists: directory => [...this.sources.keys()].some(file => file.startsWith(this.absolute(directory) + '/')),
    };
    this.compilerHost = {
      getSourceFile: file => this.sources.get(this.absolute(file)),
      getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => options.workspaceRoot,
      getDirectories: () => [], getCanonicalFileName: file => file, useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n', fileExists: resolutionHost.fileExists, readFile: resolutionHost.readFile,
      resolveModuleNames: (names, containing) => names.map(name => {
        const key = `${containing}\0${name}`;
        if (!this.moduleResolutions.has(key)) {
          this.refreshStats.moduleResolutions++;
          this.moduleResolutions.set(key, ts.resolveModuleName(name, containing, this.compilerOptions, resolutionHost).resolvedModule);
        }
        return this.moduleResolutions.get(key);
      }),
    };
  }

  private absolute(filePath: string): string {
    let absolute = this.absolutePaths.get(filePath);
    if (absolute === undefined) { absolute = path.resolve(this.options.workspaceRoot, filePath).replace(/\\/g, '/'); this.absolutePaths.set(filePath, absolute); }
    return absolute;
  }
  private relative(filePath: string): string {
    let relative = this.relativePaths.get(filePath);
    if (relative === undefined) { relative = path.relative(this.options.workspaceRoot, filePath).replace(/\\/g, '/'); this.relativePaths.set(filePath, relative); }
    return relative;
  }

  indexFiles(filePaths: string[]): Promise<void> {
    const paths = [...filePaths];
    const indexed = this.indexing.then(() => this.indexFilesSerial(paths));
    this.indexing = indexed.catch(() => {});
    return indexed;
  }

  private async indexFilesSerial(filePaths: string[]): Promise<void> {
    const staged = new Map(this.sources);
    const resolutionConfiguration = JSON.stringify({ paths: this.options.paths, baseUrl: this.options.baseUrl });
    let changed = resolutionConfiguration !== this.resolutionConfiguration;
    let fileSetChanged = changed;
    const changedFiles = new Set<string>();
    for (const filePath of filePaths) {
      const absolute = this.absolute(filePath);
      const relative = this.relative(absolute);
      if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('path outside workspace');
      if (!/\.[cm]?[jt]sx?$/.test(absolute)) throw new Error('TypeScript/JavaScript file required');
      let text: string | undefined;
      try { text = this.options.readFile ? this.options.readFile(absolute) : await fs.promises.readFile(absolute, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const old = this.sources.get(absolute);
      if (text === undefined) {
        if (staged.delete(absolute)) { changed = true; fileSetChanged = true; changedFiles.add(relative); }
        continue;
      }
      if (old?.text === text) continue;
      staged.set(absolute, ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true));
      if (!old) fileSetChanged = true;
      changedFiles.add(relative);
      changed = true;
    }
    if (changed) {
      if (resolutionConfiguration !== this.resolutionConfiguration) {
        this.compilerOptions = { ...this.compilerOptions, paths: structuredClone(this.options.paths),
          baseUrl: path.resolve(this.options.workspaceRoot, this.options.baseUrl ?? '.') };
        this.resolutionConfiguration = resolutionConfiguration;
      }
      this.sources = staged; this.rebuild(changedFiles, fileSetChanged);
    }
  }

  private rebuild(changedFiles: Set<string>, fileSetChanged: boolean): void {
    this.refreshStats = { traversedFiles: [...changedFiles].filter(file => this.sources.has(this.absolute(file))), checkerLookups: 0, moduleResolutions: 0 };
    // Re-resolve the entire reverse dependency closure, retaining unrelated AST identities/edges.
    // New/removed files can resolve previously missing imports, so file-set changes refresh all files.
    const affected = fileSetChanged ? new Set([...this.sources.keys()].map(file => this.relative(file))) : new Set(changedFiles);
    if (!fileSetChanged) {
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const edge of this.edges) {
          const from = this.nodes.get(edge.fromId)?.filePath;
          const to = this.nodes.get(edge.toId)?.filePath;
          if (from && to && from !== to && affected.has(to) && !affected.has(from)) { affected.add(from); expanded = true; }
        }
      }
    }
    for (const changed of changedFiles) affected.add(changed);
    // Resolution depends on specifier/location and the explicit file set, not declaration text.
    if (fileSetChanged) this.moduleResolutions.clear();
    const program = ts.createProgram([...this.sources.keys()], this.compilerOptions, this.compilerHost, fileSetChanged ? undefined : this.program);
    this.program = program;
    const checker = program.getTypeChecker();
    const getSymbol = (node: ts.Node) => { this.refreshStats.checkerLookups++; return checker.getSymbolAtLocation(node); };
    for (const [id, node] of this.nodes) if (changedFiles.has(node.filePath)) this.nodes.delete(id);
    const declarationIds = this.declarationIds;
    const names = this.names;
    const moduleId = (source: ts.SourceFile) => `${this.relative(source.fileName)}#module`;
    const kindOf = (node: ts.Node): SymbolKind | undefined => {
      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return 'function';
      if (ts.isClassDeclaration(node)) return 'class';
      if (ts.isInterfaceDeclaration(node)) return 'interface';
      if (ts.isTypeAliasDeclaration(node)) return 'type';
      if (ts.isVariableDeclaration(node) || ts.isParameter(node)) return 'variable';
      return undefined;
    };
    for (const source of this.sources.values()) {
      const filePath = this.relative(source.fileName);
      if (!changedFiles.has(filePath)) continue;
      this.nodes.set(moduleId(source), { id: moduleId(source), name: filePath, kind: 'module', filePath, line: 1, character: 1, exported: false });
      const visit = (node: ts.Node) => {
        const kind = kindOf(node);
        const name = (node as ts.NamedDeclaration).name;
        if (kind && name && ts.isIdentifier(name)) {
          const position = source.getLineAndCharacterOfPosition(name.getStart(source));
          const base = `${filePath}#${name.text}`;
          const id = this.nodes.has(base) ? `${base}@${position.line + 1}:${position.character + 1}` : base;
          this.nodes.set(id, { id, name: name.text, kind, filePath, line: position.line + 1, character: position.character + 1, exported: false });
          declarationIds.set(node, id); names.add(name);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    const resolve = (symbol: ts.Symbol | undefined): string | undefined => {
      if (!symbol) return undefined;
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      for (const declaration of symbol.declarations ?? []) {
        if (ts.isSourceFile(declaration)) return moduleId(declaration);
        const id = declarationIds.get(declaration);
        if (id) return id;
      }
      return undefined;
    };
    for (const filePath of affected) this.fileEdges.delete(filePath);
    for (const filePath of changedFiles) this.referenceSites.delete(filePath);
    for (const source of this.sources.values()) {
      const filePath = this.relative(source.fileName);
      if (!affected.has(filePath)) continue;
      const edges = new Map<string, SymbolEdge>();
      const add = (fromId: string, toId: string | undefined, relation: DependencyRelation) => {
        if (!toId || !this.nodes.has(toId)) return;
        edges.set(`${fromId}\0${toId}\0${relation}`, { fromId, toId, relation });
      };
      const module = moduleId(source);
      const symbol = getSymbol(source);
      if (symbol) for (const exported of checker.getExportsOfModule(symbol)) {
        const id = resolve(exported); add(module, id, 'exports');
      }
      let sites = this.referenceSites.get(filePath);
      if (!sites) {
        sites = [];
        const record = (node: ts.Node, fromId: string, relation: DependencyRelation) => {
          const symbol = getSymbol(node);
          const toId = resolve(symbol);
          let lookupNode = node;
          let lookupKey: ts.Node | string = node;
          const alias = symbol?.flags && symbol.flags & ts.SymbolFlags.Alias ? symbol.declarations?.[0] : undefined;
          if (alias && (ts.isImportSpecifier(alias) || ts.isImportClause(alias) || ts.isNamespaceImport(alias))) {
            lookupNode = alias.name!;
            lookupKey = lookupNode;
          } else if (ts.isIdentifier(node) && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
            // Namespace member paths are lexical bindings, so repeated accesses share one lookup.
            // Type-driven members retain their cached individual sites: narrowing can differ by location.
            let expression: ts.Expression = node.parent;
            const members: string[] = [];
            while (ts.isPropertyAccessExpression(expression)) { members.unshift(expression.name.text); expression = expression.expression; }
            if (ts.isIdentifier(expression)) {
              const rootSymbol = getSymbol(expression);
              const declaration = rootSymbol?.declarations?.[0];
              if (declaration && ts.isNamespaceImport(declaration)) lookupKey = `namespace:${declaration.pos}:${members.join('.')}`;
            }
          }
          sites!.push({ fromId, relation, node: lookupNode, lookupKey, toId,
            refresh: relation === 'imports' || !!alias || !toId || this.nodes.get(toId)?.filePath !== filePath
              || (ts.isIdentifier(node) && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) });
        };
        const visit = (node: ts.Node, owner: string) => {
          owner = declarationIds.get(node) ?? owner;
          if (ts.isImportDeclaration(node)) {
            record(node.moduleSpecifier, module, 'imports');
            const clause = node.importClause;
            if (clause?.name) record(clause.name, module, 'imports');
            if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
              for (const item of clause.namedBindings.elements) record(item.name, module, 'imports');
            return;
          }
          if (ts.isExportDeclaration(node)) {
            if (node.moduleSpecifier) record(node.moduleSpecifier, module, 'imports');
            return;
          }
          if (ts.isIdentifier(node) && !names.has(node)) {
            let relation: DependencyRelation = 'references';
            if (ts.isExpressionWithTypeArguments(node.parent) && ts.isHeritageClause(node.parent.parent)
              && node.parent.parent.token === ts.SyntaxKind.ImplementsKeyword) relation = 'implements';
            record(node, owner, relation);
          }
          ts.forEachChild(node, child => visit(child, owner));
        };
        visit(source, module);
        this.referenceSites.set(filePath, sites);
      } else {
        const refreshed = new Map<ts.Node | string, string | undefined>();
        for (const site of sites) if (site.refresh) {
          if (!refreshed.has(site.lookupKey)) refreshed.set(site.lookupKey, resolve(getSymbol(site.node)));
          site.toId = refreshed.get(site.lookupKey);
        }
      }
      for (const site of sites) add(site.fromId, site.toId, site.relation);
      this.fileEdges.set(filePath, [...edges.values()]);
    }
    this.edges = [...this.fileEdges.values()].flat();
    for (const node of this.nodes.values()) node.exported = false;
    for (const edge of this.edges) if (edge.relation === 'exports') this.nodes.get(edge.toId)!.exported = true;
  }

  async findSymbols(query: Pick<SymbolGraphQuery, 'symbolName' | 'kind' | 'filePath'>): Promise<SymbolNode[]> {
    const file = query.filePath === undefined ? undefined : this.relative(this.absolute(query.filePath));
    return [...this.nodes.values()].filter(node => (query.symbolName === undefined || node.name === query.symbolName)
      && (query.kind === undefined || node.kind === query.kind) && (file === undefined || node.filePath === file)).map(node => ({ ...node }));
  }
  async getIncomingReferences(symbolId: string): Promise<SymbolNode[]> {
    const ids = new Set(this.edges.filter(edge => edge.toId === symbolId && (edge.relation === 'references' || edge.relation === 'implements')).map(edge => edge.fromId));
    return [...ids].map(id => ({ ...this.nodes.get(id)! }));
  }
  async getDependencySubtree(symbolId: string, depth = 1): Promise<{ nodes: SymbolNode[]; edges: SymbolEdge[] }> {
    return this.getGraph(symbolId, { maxDepth: depth, direction: 'outgoing' });
  }
  async getGraph(symbolId: string, query: SymbolGraphQuery & { relations?: DependencyRelation[] } = {}): Promise<{ nodes: SymbolNode[]; edges: SymbolEdge[] }> {
    const depth = query.maxDepth ?? 1;
    if (!Number.isInteger(depth) || depth < 0 || depth > 3) throw new Error('maxDepth must be an integer from 0 to 3');
    if (!this.nodes.has(symbolId)) return { nodes: [], edges: [] };
    const found = new Set([symbolId]); const edges = new Set<SymbolEdge>();
    let frontier = new Set([symbolId]);
    for (let level = 0; level < depth; level++) {
      const next = new Set<string>();
      for (const edge of this.edges) {
        if (query.relation && query.relation !== edge.relation) continue;
        if (query.relations && !query.relations.includes(edge.relation)) continue;
        const direction = query.direction ?? 'outgoing';
        const target = direction !== 'incoming' && frontier.has(edge.fromId) ? edge.toId
          : direction !== 'outgoing' && frontier.has(edge.toId) ? edge.fromId : undefined;
        if (target === undefined) continue;
        edges.add(edge); if (!found.has(target)) next.add(target); found.add(target);
      }
      frontier = next;
    }
    return { nodes: [...found].map(id => ({ ...this.nodes.get(id)! })), edges: [...edges].map(edge => ({ ...edge })) };
  }
}
