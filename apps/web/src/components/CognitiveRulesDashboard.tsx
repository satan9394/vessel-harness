import { localizedValue } from '../i18n';
import { useI18n } from './LanguageProvider';
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
  const { t } = useI18n();
  return rules.length === 0 ? <p className="dashboard-empty">{t('uiNoMatchingReflectiveRules')}</p> :
    <ul className="dashboard-cards" aria-label={t('uiReflectiveRules')}>{rules.map((rule) => <li className="cognitive-rule" key={rule.id}>
      <span className="dashboard-tag">{localizedValue(rule.category, t)}</span><small className="dashboard-meta">{rule.id}</small>
      <dl><dt>{t('uiTrigger')}</dt><dd>{rule.triggerCondition}</dd><dt>{t('uiLesson')}</dt><dd>{rule.lesson}</dd><dt>{t('uiRecommendedAction')}</dt><dd>{rule.recommendedAction}</dd>
        <dt>{t('uiHits')}</dt><dd>{rule.frequency}</dd><dt>{t('uiUpdated')}</dt><dd><time dateTime={new Date(rule.updatedAt).toISOString()}>{new Date(rule.updatedAt).toLocaleString()}</time></dd>
        {rule.confidence !== undefined && <><dt>{t('uiConfidence')}</dt><dd>{Math.round(rule.confidence * 100)}%</dd></>}
      </dl>
    </li>)}</ul>;
}

export function CognitiveRulesFilters({ category, query, onCategory, onQuery }: {
  category: RuleCategory | ''; query: string; onCategory: (value: RuleCategory | '') => void; onQuery: (value: string) => void;
}) {
  const { t } = useI18n();
  return <div className="dashboard-filters"><label>{t('uiCategory')} <select aria-label={t('uiCategory')} value={category} onChange={(event) => onCategory(event.target.value as RuleCategory | '')}>
    <option value="">{t('uiAllCategories')}</option><option value="policy_denial">{t('uiPolicyDenial')}</option><option value="tool_failure">{t('uiToolFailure')}</option><option value="architecture_constraint">{t('uiArchitectureConstraint')}</option>
  </select></label><label>{t('uiSearchRules')} <input type="search" value={query} placeholder={t('uiTriggerLessonOrAction')} onChange={(event) => onQuery(event.target.value)} /></label></div>;
}

export function CognitiveRulesDashboard({ api: suppliedApi, refreshMs = 10000 }: { api?: Pick<ApiClient, 'cognitiveRules'>; refreshMs?: number }) {
  const { t } = useI18n();
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
  return <section className="dashboard-panel" aria-label={t('uiCognitiveRules')} aria-busy={busy}>
    <header className="dashboard-heading"><h2>{t('uiCognitiveRules')}</h2><button className="btn" disabled={busy} onClick={() => { void refresh.current(); }}>{error ? t('retry') : t('uiRefresh')}</button></header>
    <CognitiveRulesFilters category={category} query={query} onCategory={setCategory} onQuery={setQuery} />
    {error && <p role="alert" className="error-text">{error}</p>}
    {!snapshot && busy && <p role="status">{t('uiLoadingReflectiveRules')}</p>}
    {snapshot && (!snapshot.available ? <p className="dashboard-empty">{t('uiCognitiveMemoryIsUnavailable')}</p> : <>
      <p className="dashboard-meta" role="status">{rules.length}  {t('uiOf')} {snapshot.rules.length}  {t('uiRulesReadOnlyLatest1000Rules')}</p>
      <CognitiveRulesList rules={rules} />
    </>)}
  </section>;
}
export default CognitiveRulesDashboard;
