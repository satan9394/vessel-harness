export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'variable' | 'module';
export interface SymbolNode {
  id: string;
  name: string;
  kind: SymbolKind;
  filePath: string;
  line: number;
  character: number;
  exported: boolean;
}
export type DependencyRelation = 'imports' | 'exports' | 'references' | 'implements';
export interface SymbolEdge { fromId: string; toId: string; relation: DependencyRelation }
export interface SymbolGraphQuery {
  filePath?: string;
  symbolName?: string;
  kind?: SymbolKind;
  relation?: DependencyRelation;
  direction?: 'incoming' | 'outgoing' | 'both';
  maxDepth?: number;
}
export interface ISymbolGraphService {
  indexFiles(filePaths: string[]): Promise<void>;
  findSymbols(query: Pick<SymbolGraphQuery, 'symbolName' | 'kind' | 'filePath'>): Promise<SymbolNode[]>;
  getDependencySubtree(symbolId: string, depth?: number): Promise<{ nodes: SymbolNode[]; edges: SymbolEdge[] }>;
  getIncomingReferences(symbolId: string): Promise<SymbolNode[]>;
}
