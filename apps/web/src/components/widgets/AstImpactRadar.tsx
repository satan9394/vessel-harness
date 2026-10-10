import type { ImpactRadarWidget } from '@vessel/shared';

export default function AstImpactRadar({ widget }: { widget: ImpactRadarWidget }) {
  const { targetSymbol, blastRadius } = widget.payload;
  return <section className="inline-widget" aria-label="AST impact radar"><header className="widget-head"><strong>Impact · {targetSymbol}</strong><span>{blastRadius.modifiedFiles.length} files · {blastRadius.affectedCallers.length} callers</span></header>
    <h4>Modified files</h4><ul>{blastRadius.modifiedFiles.map(file => <li key={file}><code>{file}</code></li>)}</ul>
    <h4>Affected callers</h4>{blastRadius.affectedCallers.length ? <ul>{blastRadius.affectedCallers.map((caller, index) => <li key={`${caller.filePath}:${caller.symbolName}:${index}`}><code>{caller.symbolName}</code> → <code>{caller.filePath}</code></li>)}</ul> : <p className="dim">No affected callers reported.</p>}
  </section>;
}
