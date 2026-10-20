The user wants a detailed audit report for the Sidebar and TaskComposer components against the Claude Design System (CDS), with concrete code refactoring proposals. Let me produce a thorough, actionable report.

Let me structure it:

1. Executive summary
2. Sidebar audit - current issues, CDS target, concrete code
3. TaskComposer audit - current issues, CDS target, concrete code
4. CSS token cleanup
5. Motion physics
6. Implementation plan / rollout

I need to be specific with code. Let me think about the CSS variable cleanup — the file uses `--panel2`, `--row-line`, `--border`, `--hover`, `--dim`, `--text-soft` as aliases. The task says to eliminate `--panel2`, `--row-line` and converge on `--panel`, `--panel-2`, `--ring`, `--ring-hairline`.

Let me write out concrete code.

### Sidebar changes

**Period grouping**: Currently `groupSessionsByDateAndTopic` groups by topic and assigns each topic to a period based on latest activity, but then in the `periods` useMemo, they flatten `period.topics` and lose the period key — so the date grouping is destroyed and everything just falls under the workspace name. Need to keep the period as a real section with labels: Today / Last 7 Days / Earlier.

Actually the current code does: `periods = [...roots].map(root => ({ root, topics: groupSessionsByDateAndTopic(...).flatMap(period => period.topics) }))`. So the periods are computed then flattened — the date headers are gone. So we should return nested: root -> periods -> topics.

New i18n keys needed: `topicToday`, `topicLastSevenDays`, `topicEarlier` already exist as keys in TopicPeriodKey. Good.

Also add "Yesterday" — the task mentions Today / Yesterday / Previous 7 Days / Older. Let me add `topicYesterday` as a new key. Hmm, but adding i18n keys requires touching LanguageProvider. I should note that. I could keep it to the three existing keys to minimize risk, but the task explicitly asks for "Today / Yesterday / Previous 7 Days / Older". I'll propose adding `topicYesterday` and note the i18n dictionary addition.

**Model for period grouping**: Should be per-root AND per-period. Let me restructure so that `groupSessionsByDateAndTopic` returns periods with nested topics, and the sidebar renders `<section className="topic-period">` with `<div className="side-label">` for the period label.

Also, make the period grouping pure & testable. Add `perPeriod` limit? Maybe cap earlier periods via "show more". Keep it simple — maybe add a collapse for `topicEarlier`.

**Row structure**: Change topic-group from `border-bottom` to spacing + hover-revealed actions. Active rail: a left 2px accent bar via `::before` or a pseudo element.

**Actions menu**: Replace `<details>/<summary>` with a hover/focus-revealed inline action group (rename + archive icon buttons) — or a proper popover menu. Simpler and more robust: inline buttons that appear on hover/focus-within, with `opacity: 0` → `1`, plus keyboard access via `:focus-within`. But hidden interactive elements are an a11y problem if `display:none`; use opacity + pointer-events so they remain focusable... actually `opacity: 0` elements are still focusable, which is good for keyboard users; but they're invisible when focused — we handle with `:focus-within` on the parent making them visible. Good.

Actually a nested `<button>` inside a `<button>`? No — `.topic-title` is a button, and the actions are siblings in the heading. Need to keep them siblings. Currently the structure is `.topic-heading > .topic-title` and separately `.topic-actions` below. Let me restructure: `.topic-heading` contains `.topic-title` (button) and `.topic-menu` (button group) as siblings in a flex row.

Careful: `onSelectSession(group.sessions[0]!.id)` on topic title — that's odd; clicking a topic opens the first session. Should be select the topic, expanding it. Let me propose: clicking the topic title toggles expansion (collapsed by default shows latest session), plus keeps backward compat. Hmm, that's a bigger behavioral change. Let me propose: topic title click selects the topic's most recent session (keep behaviour) but add expansion toggle. Actually to keep scope reasonable, I'll propose making the topic group collapsible with a chevron, defaulting to expanded for the selected topic's group and collapsed elsewhere? That's a big change. 

Let me propose a middle ground: keep the click-to-open behavior on the title text, but add a `<button className="topic-disclosure">` chevron on the left that toggles. Or simpler: the entire heading row is a button that toggles collapse, and the sessions list shows. Hmm.

Actually the current UI shows all sessions under a topic anyway. The title button opens the first session. That's confusing. I'll propose: topic heading row = disclosure button (toggles `expandedTopics` set), and when collapsed shows nothing; when expanded shows sessions. Default: expanded. And keep `onSelectSession` on each session row. That's clean and matches CDS session trees. But then clicking a topic title no longer opens a session — behavior change. I'll note it as an intentional UX fix and keep a fallback (`title` selects first session if the topic has exactly one session? no...). Let me just do the disclosure and note the change.

Hmm, but the reviewer role is to give a plan for Codex to implement. Behavior changes are fine if flagged.

Let me keep it safer: heading has a chevron toggle button (left) + title button (selects latest session) + actions. That preserves behavior and adds disclosure. Actually that's three interactive targets in a row — fine, common pattern.

I'll go with: `.topic-heading` is a flex row: `[chevron toggle] [title button (flex:1)] [actions]`.

**Search capsule**: `.topic-search` → make a wrapper `.side-search` with an icon and an input, border-radius `--r-pill` or `--r-md`, hairlines, focus ring. And the archived toggle → a small pill toggle button rather than a bare checkbox, or keep checkbox but restyle with `accent-color: var(--accent)`.

**Active rail**: `.side-item-active` → left accent bar. For session rows inside a topic, use a 2px rail at the left of the row with `border-radius: var(--r-pill)`.

Let me now write CSS.

```css
/* ---------- sidebar (CDS §3.1) ---------- */
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 12px 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
```

Note: `.navigation-shell .sidebar` overrides to transparent bg. Keep that.

Brand:
```css
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px 6px;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
```

New session button: full-width, accent, with `active` scale.

```css
.sidebar .btn-new-session {
  width: 100%;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  border-radius: var(--r-md);
  background: var(--accent-soft);
  color: var(--accent);
  border: var(--ring-hairline) solid var(--ring-2);
  font-size: 13px; font-weight: 600;
  transition: background-color var(--dur-snap) var(--ease), transform var(--dur-fast) var(--ease);
}
.sidebar .btn-new-session:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); }
.sidebar .btn-new-session:active { transform: scale(0.985); }
```

Search:
```css
.side-search {
  position: relative;
  display: flex;
  align-items: center;
  margin-top: 2px;
}
.side-search svg { position: absolute; left: 9px; width: 13px; height: 13px; color: var(--text-3); pointer-events: none; }
.topic-search {
  width: 100%;
  margin: 0;
  padding: 7px 10px 7px 28px;
  border: var(--ring-hairline) solid var(--ring);
  border-radius: var(--r-pill);
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  transition: background-color var(--dur-snap) var(--ease), border-color var(--dur-snap) var(--ease), box-shadow var(--dur-snap) var(--ease);
}
.topic-search::placeholder { color: var(--text-3); }
.topic-search:hover { border-color: var(--ring-2); }
.topic-search:focus-visible, .topic-search:focus {
  outline: none;
  background: var(--panel);
  border-color: var(--ring-2);
  box-shadow: var(--focus-ring);
}
```

Note: `.input` class is also applied to `.topic-search` in the JSX. `.input` may have its own padding/border. Since we're overriding, we should either remove `input` class from the search or override. I'll propose removing `className="input topic-search"` → `className="topic-search"` and adding a wrapper with icon. Let me check `.input` CSS... it's cut off in the provided file. I'll note to drop `.input` and style `.topic-search` standalone.

Archived toggle → pill:
```css
.topic-archived-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  margin: 2px 0 0 2px;
  padding: 3px 9px;
  border: var(--ring-hairline) solid transparent;
  border-radius: var(--r-pill);
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  transition: color var(--dur-snap) var(--ease), background-color var(--dur-snap) var(--ease), border-color var(--dur-snap) var(--ease);
}
.topic-archived-toggle:hover { background: var(--panel-2); color: var(--text-2); }
.topic-archived-toggle:has(input:checked) { background: var(--accent-soft); border-color: var(--ring-2); color: var(--accent); }
.topic-archived-toggle input { accent-color: var(--accent); width: 12px; height: 12px; margin: 0; }
```

`:has()` support — fine in modern browsers; add fallback with a class `is-on` from React state to be safe. I'll propose a data attribute `data-on={showArchived || undefined}`.

Period list & headers:
```css
.topic-period-list { display: flex; flex-direction: column; gap: 2px; max-height: min(58vh, 680px); overflow-y: auto; }
.topic-period { margin: 0; padding: 0; }
.topic-period + .topic-period { margin-top: 10px; }
.side-label.topic-period-label {
  padding: 8px 6px 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--text-3);
}
```

Topics:
```css
.topic-group {
  position: relative;
  margin: 0;
  padding: 2px 0 4px;
  border-bottom: 0;   /* kill Border Prison */
  border-radius: var(--r-md);
  transition: background-color var(--dur-snap) var(--ease);
}
.topic-group::after {  /* subtle hairline only between sibling topics */
  content: '';
  position: absolute;
  left: 8px; right: 8px; bottom: 0;
  height: var(--ring-hairline);
  background: var(--ring);
  opacity: 0.7;
}
.topic-group:last-child::after { display: none; }
```

Hmm — the task says "无生硬横线" (no hard horizontal lines). Maybe use spacing instead of any separator. Let me use only spacing, plus a very faint hairline that fades out. Actually better: use spacing only, and rely on the hover surface for grouping. I'll offer the fading hairline as an option but default to a soft inset hairline with a mask/gradient... The prompt explicitly says remove the border prison. I'll go with: no border, use `gap` + subtle background-on-hover. And for the period boundary, use a `side-label`.

Heading:
```css
.topic-heading {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: 1px 2px 1px 0;
  border-radius: var(--r-sm);
  transition: background-color var(--dur-snap) var(--ease);
}
.topic-heading:hover { background: var(--panel-2); }
.topic-heading:focus-within { background: var(--panel-2); }
```

Disclosure chevron:
```css
.topic-disclosure {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px; height: 18px;
  padding: 0;
  border: 0;
  border-radius: var(--r-0);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.topic-disclosure svg { transition: transform var(--dur-base) var(--ease-swift); }
.topic-disclosure[aria-expanded='false'] svg { transform: rotate(-90deg); }
```

Title:
```css
.topic-title {
  flex: 1;
  min-width: 0;
  padding: 4px 4px 4px 2px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.008em;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  border-radius: var(--r-sm);
}
.topic-title:active { transform: scale(0.99); }
```

Hover-revealed actions:
```css
.topic-actions-inline {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transform: translateX(2px);
  transition: opacity var(--dur-snap) var(--ease), transform var(--dur-snap) var(--ease);
}
.topic-heading:hover .topic-actions-inline,
.topic-heading:focus-within .topic-actions-inline { opacity: 1; transform: none; }
@media (hover: none) { .topic-actions-inline { opacity: 1; transform: none; } }
.topic-action {
  display: grid;
  place-items: center;
  width: 22px; height: 22px;
  padding: 0;
  border: var(--ring-hairline) solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition: background-color var(--dur-snap) var(--ease), color var(--dur-snap) var(--ease), transform var(--dur-fast) var(--ease);
}
.topic-action:hover { background: var(--panel-3); color: var(--text); }
.topic-action:active { transform: scale(0.94); }
.topic-action:focus-visible { outline: none; box-shadow: var(--focus-ring); }
```

Session rows with active rail:
```css
.topic-sessions { display: flex; flex-direction: column; gap: 1px; padding: 2px 0 0 18px; }

.side-item.topic-session {
  position: relative;
  display: block;
  width: 100%;
  padding: 5px 8px 5px 10px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: 11.5px;
  line-height: 1.45;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: background-color var(--dur-snap) var(--ease), color var(--dur-snap) var(--ease), transform var(--dur-fast) var(--ease);
}
.side-item.topic-session::before {
  content: '';
  position: absolute;
  left: 2px; top: 50%;
  width: 2px; height: 0;
  border-radius: var(--r-pill);
  background: var(--accent);
  transform: translateY(-50%);
  transition: height var(--dur-base) var(--ease-swift);
}
.side-item.topic-session:hover { background: var(--panel-2); color: var(--text); }
.side-item.topic-session:active { transform: scale(0.985); }
.side-item.topic-session.side-item-active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.side-item.topic-session.side-item-active::before { height: 14px; }
```

Project items — same treatment; `.project-select` is a `button` inside `li.side-item`. Let me restructure to make the button the row. Actually keep `li.side-item` and style `.project-select`.

```css
.side-list { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.side-item { padding: 0; border-radius: var(--r-sm); color: var(--text-2); }
.side-item:hover { background: transparent; }  /* moved to child */
.project-select {
  position: relative;
  display: block;
  width: 100%;
  padding: 5px 8px 5px 10px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  cursor: pointer;
  transition: ...;
}
```

Hmm, `data-*`? Keep it simple.

Also the JSX currently uses `className={`project-select${...'side-item-active'}`}` — put `side-item-active` on the button and style `.project-select.side-item-active`.

Also rename editing form → style as an inline row with hairlines.

Now, sidebar structure changes in JSX. Let me write the full new Sidebar.tsx:

Key changes:
- `groupSessionsByDateAndTopic` now returns periods (already does), and add `topicYesterday`.
- The derived `periods` becomes `workspaceGroups`: `[{ root, periods: SidebarPeriodGroup[] }]` — no flatMap.
- `expandedTopics` state set.
- icons: inline SVG components for search, chevron, rename (pencil), archive (box), restore.

Let me write the helper:

```tsx
type TopicPeriodKey = 'topicToday' | 'topicYesterday' | 'topicLastSevenDays' | 'topicEarlier';

/** Period boundaries: today / yesterday / previous 7 days / earlier.
 *  A Topic never splits across periods — it is placed by its latest activity. */
export function groupSessionsByDateAndTopic(sessions: SessionMeta[], now = Date.now()): SidebarPeriodGroup[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const day = 24 * 60 * 60 * 1000;
  const yesterdayStart = todayStart - day;
  const lastWeekStart = todayStart - 7 * day;
  ...
  const periodKey: TopicPeriodKey =
    !Number.isFinite(timestamp) || timestamp < lastWeekStart ? 'topicEarlier'
    : timestamp < yesterdayStart ? 'topicLastSevenDays'
    : timestamp < todayStart ? 'topicYesterday'
    : 'topicToday';
```

Wait: careful. If timestamp < lastWeekStart → earlier. If timestamp >= lastWeekStart and < yesterdayStart → last seven days. If >= yesterdayStart and < todayStart → yesterday. Else today. Yes that's right.

But note existing tests exist ("deterministic tests"). Changing this could break tests. I'll flag: update `Sidebar.test.tsx` expectations. Also the ordering of periods: currently the Map insertion order is topicToday, topicLastSevenDays, topicEarlier. Need to include yesterday in order.

Also, delete the weird `groupSessionsByDateAndTopic(...).flatMap(...)` and the derived `periods`.

Now writing Sidebar.tsx fully. Also `filterSessionsByTopic` stays.

Let me also handle: `onRenameTopic?.(group.sessions[0]!.id, title)` — keep.

Rename form inside heading: replace with a compact inline form.

Let me write the JSX:

```tsx
export default function Sidebar({
  projects,
  selectedProjectRoot,
  onSelectProject,
  sessions,
  onNewSession,
  selectedSessionId,
  onSelectSession,
  onRenameTopic,
  onArchiveTopic,
  onCollapse,
}: SidebarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [collapsedTopics, setCollapsedTopics] = useState<ReadonlySet<string>>(() => new Set());

  const workspaceGroups = useMemo(() => {
    const roots = [...new Set([...projects.map(p => p.root), ...sessions.map(s => s.workspaceRoot)])];
    return roots.map(root => ({
      root,
      periods: groupSessionsByDateAndTopic(
        filterSessionsByTopic(sessions.filter(s => s.workspaceRoot === root), query, showArchived),
      ),
    })).filter(group => group.periods.length > 0 || projects.some(p => p.root === group.root));
  }, [projects, sessions, query, showArchived]);
  ...
}
```

Hmm, `periods` could be empty for a project with no sessions. That's fine—render nothing under it. Actually the current code renders a `<section className="topic-period">` per root. If empty, renders just the label. Let's filter to non-empty for the sessions block but keep root rendering... Actually simpler: only render roots that have periods, plus if we want, keep empty. I'll filter empties when a query is present.

Let me simplify: `const workspaceGroups = useMemo(...)` returns roots with periods; render only groups with `periods.length > 0`.

Then:

```tsx
{workspaceGroups.length === 0 ? (
  <div className="side-empty">{t('noSessions')}</div>
) : (
  <div className="topic-period-list">
    {workspaceGroups.map(group => (
      <section className="workspace-group" key={group.root}>
        <div className="side-label workspace-label" title={group.root}>{projectName(group.root)}</div>
        {group.periods.map(period => (
          <section className="topic-period" key={period.key}>
            <div className="side-label topic-period-label">{t(period.key)}</div>
            {period.topics.map(topic => { ... })}
          </section>
        ))}
      </section>
    ))}
  </div>
)}
```

`t(period.key)` — the i18n `t` accepts a key string presumably. Type: `t` may be typed with a union of keys. Add the new key `topicYesterday` to the dictionary. I'll note the required dictionary additions.

Topic rendering:

```tsx
const isCollapsed = collapsedTopics.has(topic.topicId);
<section className="topic-group" key={topic.topicId}>
  {editingTopicId === topic.topicId ? (
    <form className="topic-edit" onSubmit={e => { e.preventDefault(); saveRename(topic); }}>
      <input className="input topic-edit-input" aria-label={t('topicRename')} value={draftTitle} onChange={e => setDraftTitle(e.target.value)} autoFocus
        onKeyDown={e => { if (e.key === 'Escape') setEditingTopicId(null); }} />
      <button type="submit" className="topic-action topic-action-text">{t('topicSave')}</button>
      <button type="button" className="topic-action topic-action-text" onClick={() => setEditingTopicId(null)}>{t('topicCancel')}</button>
    </form>
  ) : (
    <>
      <div className="topic-heading">
        <button type="button" className="topic-disclosure" aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? t('topicExpand') : t('topicCollapse')}
          onClick={() => toggleTopic(topic.topicId)}>
          <ChevronIcon />
        </button>
        <button type="button" className="topic-title" title={topic.title || readableSessionTitle(...)}
          onClick={() => onSelectSession(topic.sessions[0]!.id)}>
          {topic.title || readableSessionTitle(topic.sessions[0]!, t('sessionNew'))}
        </button>
        <span className="topic-actions-inline">
          <button type="button" className="topic-action" aria-label={t('topicRename')} title={t('topicRename')} onClick={() => beginRename(topic)}><PencilIcon /></button>
          <button type="button" className="topic-action" aria-label={topic.isArchived ? t('topicRestore') : t('topicArchive')} title={...} onClick={() => onArchiveTopic?.(topic.sessions[0]!.id, !topic.isArchived)}>
            {topic.isArchived ? <RestoreIcon/> : <ArchiveIcon/>}
          </button>
        </span>
      </div>
      {!isCollapsed && (
        <div className="topic-sessions">
          {topic.sessions.map(session => (
            <button key={session.id} type="button"
              className={`side-item topic-session${session.id === selectedSessionId ? ' side-item-active' : ''}`}
              title={session.workspaceRoot}
              aria-current={session.id === selectedSessionId ? 'page' : undefined}
              onClick={() => onSelectSession(session.id)}>
              {topic.sessions.length > 1 ? readableSessionTitle(session, t('sessionNew')) : formatClock(session.updatedAt ?? session.createdAt)}
            </button>
          ))}
        </div>
      )}
    </>
  )}
  {topic.isArchived && <span className="topic-badge">{t('topicArchivedBadge')}</span>}
</section>
```

Hmm the badge placement is awkward. Put it in the heading. Let me put an archived pill in the heading, before actions.

Also collapse animation: use `grid-template-rows: 1fr / 0fr` trick or simply conditional render. Conditional render is fine and cheaper; note the reduced-motion consideration.

Now `.topic-edit` styling.

Also add a `topic-count` badge? Optional. Skip.

Also the `hierarchyHint` paragraph — keep, but restyle with smaller padding.

**Sidebar footer**: There's an empty trailing area in the JSX. Fine.

Now — TaskComposer.

### TaskComposer redesign

Current: `<form className="task-composer">` with h2, labels, selects, textarea, `.composer-options` row.

Target: CDS composer — a rounded container `--r-composer: 20px` with a concentric inner textarea, a pills bar at the bottom, a circular send button optically aligned.

Structure:

```tsx
return (
  <form className="task-composer" onSubmit={submit} data-state={busy ? 'busy' : undefined}>
    <header className="composer-head">
      <h2 className="composer-title">{t('taskPrompt')}</h2>
      <span className="composer-hint dim">{t('composerEnterHint')}</span>
    </header>

    <div className="composer-field">
      <label className="sr-only" htmlFor="taskProject">{t('chooseProject')}</label>
      ...
    </div>
  </form>
);
```

Hmm, let me design it more concretely as a "shell":

```
<form class="task-composer">
  <div class="composer-surface">          <- r-composer, focus-within ring, 3-state shadow
    <div class="composer-context">        <- top row: project chip + model chip
      <ProjectPicker/> <ModelPicker/> ... 
    </div>
    <textarea class="task-input" />
    <div class="composer-bar">            <- pills bar
      <div class="composer-pills">
        <ModelPill/> <PermissionPill/>
      </div>
      <div class="composer-cta">
        <button class="btn-icon" advanced/>
        <button class="composer-send" type="submit">↑</button>
      </div>
    </div>
  </div>
  <p class="composer-error" role="alert">...</p>
</form>
```

But the native `<select>` elements are ugly. The task says "表单内多处原生 `<label>` 与突兀原生 `<select>` 下拉框" — replace with capsule selects: keep the native `<select>` for a11y but restyle it as a capsule with `appearance: none`, custom chevron, `--r-pill`, transparent background, hover/focus surface. That's the pragmatic path (no custom listbox implementation). Good — recommend a `<CapsuleSelect>` wrapper.

Let me write a small internal component:

```tsx
function CapsuleSelect({ label, value, disabled, onChange, children }: {...}) {
  return (
    <label className="capsule-select">
      <span className="capsule-select-label">{label}</span>
      <select className="capsule-select-input" value={value} disabled={disabled} onChange={onChange}>
        {children}
      </select>
      <ChevronDown className="capsule-select-chevron" aria-hidden />
    </label>
  );
}
```

Hmm, but the label text inside the capsule adds width. CDS-style: the capsule just shows the value with a chevron; the accessible name comes from `aria-label`. Let's do:

```tsx
<span className="capsule capsule-select">
  <span className="capsule-k">{t('modelLabelShort')}</span>
  <span className="capsule-v">{displayValue}</span>
  <ChevronDown/>
  <select aria-label={...} ... className="capsule-hit" />
</span>
```
with the `select` absolutely positioned & transparent covering the capsule — a common accessible pattern. That keeps native semantics + custom visuals. But the native dropdown list will render at the select's position; since it's `opacity: 0` covering the capsule, the menu opens in the right place. Good.

Let me write that:

```tsx
function CapsuleSelect({
  ariaLabel, keyLabel, valueLabel, value, disabled, onChange, children, width,
}: {
  ariaLabel: string; keyLabel: string; valueLabel: string; value: string;
  disabled?: boolean; onChange: (value: string) => void; children: React.ReactNode;
}) {
  return (
    <span className="capsule capsule-select" data-disabled={disabled || undefined}>
      <span className="capsule-k">{keyLabel}</span>
      <span className="capsule-v" title={valueLabel}>{valueLabel}</span>
      <ChevronDownIcon aria-hidden className="capsule-chevron" />
      <select
        className="capsule-native"
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
      >
        {children}
      </select>
    </span>
  );
}
```

CSS:
```css
.capsule-select { position: relative; padding-right: 8px; }
.capsule-native {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  margin: 0; padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
  appearance: none;
  font: inherit;
}
.capsule-select:has(.capsule-native:focus-visible) { box-shadow: var(--focus-ring); }
.capsule-select[data-disabled] { opacity: 0.5; }
```

OK.

Now the main composer CSS:

```css
/* ---------- TaskComposer (CDS §3.2 / §3.4) ---------- */
.task-composer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 0;
}

.composer-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 0 4px;
}
.composer-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.012em;
  color: var(--text);
}
.composer-hint { font-size: 11px; color: var(--text-3); }

/* 同心圆角容器：外 20px，内 14px（20 - 6 padding） */
.composer-surface {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 8px;
  border: var(--ring-hairline) solid var(--ring);
  border-radius: var(--r-composer);
  background: var(--panel-2);
  box-shadow: var(--shadow-1);
  transition:
    border-color var(--dur-base) var(--ease),
    background-color var(--dur-base) var(--ease),
    box-shadow var(--dur-base) var(--ease),
    transform var(--dur-base) var(--ease);
}
.composer-surface:hover { border-color: var(--ring-2); background: var(--panel); }
.composer-surface:focus-within {
  background: var(--panel);
  border-color: var(--ring-2);
  box-shadow: var(--shadow-2), 0 0 0 3px var(--accent-soft);
  transform: translateY(-1px);
}
.composer-surface[data-busy] { opacity: 0.7; pointer-events: none; }
```

Note `--shadow-2` is huge (40px 90px). Maybe define a dedicated `--shadow-composer`. I'll add tokens:

```css
.tokens {
  --shadow-rest: var(--shadow-1);
  --shadow-hover: 0 1px 2px rgba(38,44,80,.06), 0 8px 24px -12px rgba(38,44,80,.28);
  --shadow-focus: 0 1px 2px rgba(38,44,80,.05), 0 12px 32px -14px rgba(38,44,80,.34);
}
```
with dark overrides. Good — "三态柔和投影".

Textarea:
```css
.task-input {
  width: 100%;
  min-height: 84px;
  max-height: 40vh;
  padding: 6px 6px 2px;
  border: 0;
  border-radius: var(--r-1);   /* 14px, concentric with 20px outer - 6px pad */
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  line-height: 1.