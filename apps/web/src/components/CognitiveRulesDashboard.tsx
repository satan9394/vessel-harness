import { useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient, type ApiClient } from '../api';
import { pollDashboard, type ReflectiveRuleView, type RuleCategory, type RulesSnapshot } from '../dashboard';
import './dashboard.css';

export function filterCognitiveRules(rules: ReflectiveRuleView[], category: RuleCategory | '', query: string) {
  const keyword = query.trim().toLocaleLowerCase();
  return rules.filter((rule) => (!category || rule.category === category) &&
    [rule.id, rule.category, rule.triggerCondition, rule.lesson, rule.recommendedAction].some((text) => text.toLocaleLowerCase().includes(keyword)));
}

export function CognitiveRulesList({ rules }: { rules: ReflectiveRuleView[] }) {
  return rules.length === 0 ? <p className="dashboard-empty">No matching reflective rules.</p> :
    <ul className="dashboard-cards" aria-label="Reflective rules">{rules.map((rule) => <li className="cognitive-rule" key={rule.id}>
      <span className="dashboard-tag">{rule.category}</span><small className="dashboard-meta">{rule.id}</small>
      <dl><dt>Trigger</dt><dd>{rule.triggerCondition}</dd><dt>Lesson</dt><dd>{rule.lesson}</dd><dt>Recommended action</dt><dd>{rule.recommendedAction}</dd>
        <dt>Hits</dt><dd>{rule.frequency}</dd><dt>Updated</dt><dd><time dateTime={new Date(rule.updatedAt).toISOString()}>{new Date(rule.updatedAt).toLocaleString()}</time></dd>
        {rule.confidence !== undefined && <><dt>Confidence</dt><dd>{Math.round(rule.confidence * 100)}%</dd></>}
      </dl>
    </li>)}</ul>;
}

export function CognitiveRulesFilters({ category, query, onCategory, onQuery }: {
  category: RuleCategory | ''; query: string; onCategory: (value: RuleCategory | '') => void; onQuery: (value: string) => void;
}) {
  return <div className="dashboard-filters"><label>Category <select aria-label="Category" value={category} onChange={(event) => onCategory(event.target.value as RuleCategory | '')}>
    <option value="">All categories</option><option value="policy_denial">policy_denial</option><option value="tool_failure">tool_failure</option><option value="architecture_constraint">architecture_constraint</option>
  </select></label><label>Search rules <input type="search" value={query} placeholder="Trigger, lesson or action" onChange={(event) => onQuery(event.target.value)} /></label></div>;
}

export function CognitiveRulesDashboard({ api: suppliedApi, refreshMs = 10000 }: { api?: Pick<ApiClient, 'cognitiveRules'>; refreshMs?: number }) {
  const api = useMemo(() => suppliedApi ?? createApiClient(), [suppliedApi]);
  const [snapshot, setSnapshot] = useState<RulesSnapshot | null>(null);
  const [category, setCategory] = useState<RuleCategory | ''>('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const refresh = useRef<() => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    setSnapshot(null);
    setError('');
    const poll = pollDashboard(() => api.cognitiveRules(), (value) => { setSnapshot(value); setError(''); }, setError, refreshMs, setBusy);
    refresh.current = poll.refresh;
    return () => { poll.close(); refresh.current = () => Promise.resolve(); };
  }, [api, refreshMs]);
  const rules = filterCognitiveRules(snapshot?.rules ?? [], category, query);
  return <section className="dashboard-panel" aria-label="Cognitive rules" aria-busy={busy}>
    <header className="dashboard-heading"><h2>Cognitive rules</h2><button className="btn" disabled={busy} onClick={() => { void refresh.current(); }}>{error ? 'Retry' : 'Refresh'}</button></header>
    <CognitiveRulesFilters category={category} query={query} onCategory={setCategory} onQuery={setQuery} />
    {error && <p role="alert" className="error-text">{error}</p>}
    {!snapshot && busy && <p role="status">Loading reflective rules…</p>}
    {snapshot && (!snapshot.available ? <p className="dashboard-empty">Cognitive memory is unavailable.</p> : <>
      <p className="dashboard-meta" role="status">{rules.length} of {snapshot.rules.length} rules · Read-only · Latest 1,000 rules</p>
      <CognitiveRulesList rules={rules} />
    </>)}
  </section>;
}
export default CognitiveRulesDashboard;
