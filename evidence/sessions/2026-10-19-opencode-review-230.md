Let me carefully review this diff as an adversarial reviewer. I need to check:

1. Sidebar.tsx & CSS: Border Prison removal, date segmentation, inline hover actions + keyboard access, active rail highlight
2. TaskComposer.tsx & CSS: concentric radius, three-state shadow, capsule select, IME guard preservation
3. Style variable cleanup: --panel2 → --panel-2
4. Tests: Sidebar.test.tsx coverage

Let me look for bugs and issues.

### JSX Structure Bug in Sidebar.tsx

Looking at the diff carefully:

```jsx
<div className="topic-period-list">
  {workspaceGroups.map((workspace) => (
    <section className="topic-period" key={workspace.root}>
      <div className="side-label">{projectName(workspace.root)}</div>
      {workspace.periods.map(period => (
        <section className="topic-period" key={period.key}>
          <div className="side-label topic-period-label">{t(period.key)}</div>
          {period.topics.map((group) => (
            <section className="topic-group" key={group.topicId}>
              <div className="topic-heading">
                ...
              </div>
              {group.sessions.map((session) => (
                <button ... >
                  ...
                </button>
              ))}

        </section>
      ))}
        </section>
      ))}
        </section>
  ))}
</div>
```

Wait, let me count the closing tags. The indentation is weird but let me trace:

- `<div className="topic-period-list">` opens
- `{workspaceGroups.map((workspace) => (` 
  - `<section className="topic-period" key={workspace.root}>` opens (workspace section)
  - `{workspace.periods.map(period => (`
    - `<section className="topic-period" key={period.key}>` opens (period section)
    - `{period.topics.map((group) => (`
      - `<section className="topic-group" key={group.topicId}>` opens (group section)
      - `<div className="topic-heading">...</div>`
      - `{group.sessions.map((session) => (<button>...</button>))}`
      - then blank line then `</section>` — this closes group section (with 24 spaces indentation)
    - `))}` — closes period.topics.map
    - `</section>` — closes period section (with 20 spaces)
  - `))}` — closes workspace.periods.map
  - `</section>` — closes workspace section
- `))}` — closes workspaceGroups.map
- `</div>` — ?

Hmm, wait. Let me recount from the diff text:

```
+              {workspaceGroups.map((workspace) => (
+                <section className="topic-period" key={workspace.root}>
+                  <div className="side-label">{projectName(workspace.root)}</div>
+                  {workspace.periods.map(period => (
+                    <section className="topic-period" key={period.key}>
+                      <div className="side-label topic-period-label">{t(period.key)}</div>
+                      {period.topics.map((group) => (
+                        <section className="topic-group" key={group.topicId}>
+                          <div className="topic-heading">
...
+                          </div>
+                          {group.sessions.map((session) => (
+                            <button ...>
+                              ...
+                            </button>
+                          ))}
+
+                    </section>
+                  ))}
                     </section>
                   ))}
                 </section>
               ))}
             </div>
```

So we have:
- `{workspaceGroups.map((workspace) => (` → `<section className="topic-period" key={workspace.root}>` ... 
  - `{workspace.periods.map(period => (` → `<section className="topic-period" key={period.key}>`
    - `{period.topics.map((group) => (` → `<section className="topic-group" key={group.topicId}>`
      - `<div className="topic-heading">...</div>`
      - `{group.sessions.map((session) => (<button>...</button>))}`
      - `</section>` (this closes the group section) — indented 20 spaces
    - `))}` (closes period.topics.map)
    - `</section>` (indented 20 spaces — this closes... hmm)
  - `))}` (closes workspace.periods.map)
  - `</section>` (indented 16)
- `))}` (closes workspaceGroups.map)
- `</div>`

Wait, there's an extra `</section>`! Let me reproduce exactly:

```
+                          {group.sessions.map((session) => (
+                            <button
+                              key={session.id}
+                              type="button"
+                              className={`side-item topic-session${session.id === selectedSessionId ? ' side-item-active' : ''}`}
+                              title={session.workspaceRoot}
+                              onClick={() => onSelectSession(session.id)}
+                            >
+                              {group.sessions.length > 1 ? readableSessionTitle(session, t('sessionNew')) : formatClock(session.updatedAt ?? session.createdAt)}
+                            </button>
+                          ))}
+
+                    </section>
+                  ))}
                     </section>
                   ))}
                 </section>
               ))}
             </div>
```

OK so after `))}` closing the sessions.map:
- `</section>` — this is a closing tag with 20 spaces of indent (in the diff: `+                    </section>`) 
- `))}` — closes the `period.topics.map`
- `</section>` — 20 spaces indent
- `))}` — closes `workspace.periods.map`
- `</section>` — 16 spaces indent
- `))}` — closes `workspaceGroups.map`
- `</div>`

Hmm let me count opening sections:
1. workspace section: `<section className="topic-period" key={workspace.root}>`
2. period section: `<section className="topic-period" key={period.key}>`
3. group section: `<section className="topic-group" key={group.topicId}>`

And closing sections available:
1. `</section>` (after sessions map, 20sp)
2. `</section>` (20sp)
3. `</section>` (16sp)

That's 3 closing sections for 3 opening sections. And the map closing brackets: after first `</section>` we have `))}` which closes the `period.topics.map`. Then another `</section>` then `))}` closes `workspace.periods.map`. Then `</section>` then `))}` closes `workspaceGroups.map`. 

Hmm wait that's actually structurally consistent if odd. Let me re-trace:

```
workspaceGroups.map((workspace) => (          // map1 open
  <section key={workspace.root}>              // section W
    <div>{projectName}</div>
    workspace.periods.map(period => (         // map2 open
      <section key={period.key}>              // section P
        <div>{t(period.key)}</div>
        period.topics.map((group) => (        // map3 open
          <section key={group.topicId}>       // section G
            <div className="topic-heading">...</div>
            group.sessions.map((session) => ( // map4 open
              <button>...</button>
            ))}                               // map4 close
          </section>                          // section G close (20sp)
        ))}                                   // map3 close
      </section>                              // section P close (20sp)
    ))}                                       // map2 close
  </section>                                  // section W close (16sp)
))}                                           // map1 close
</div>
```

Hmm, but the indentation in the diff shows the first `</section>` with 20 spaces, and it's followed by `))}`. Let me look at the raw diff lines again with exact leading whitespace:

```
+                          {group.sessions.map((session) => (
+                            <button
...
+                            </button>
+                          ))}
+
+                    </section>
+                  ))}
                     </section>
                   ))}
                 </section>
               ))}
             </div>
```

Note: the line `+                    </section>` has `+` then 20 spaces. The line `+                  ))}` has `+` then 18 spaces. The line `                     </section>` (no `+`! it's a context line) has 21 spaces. Wait — `                     </section>` — this line has no `+` prefix, meaning it's unchanged context from the original. Then `+                  ))}` has 18 spaces.

Hmm, this is important. The line `                     </section>` (context, unchanged) — in the original code that was the closing of the workspace section (`<section className="topic-period" key={period.root}>`). Then `+                  ))}` closes workspaceGroups.map. Then `+                </section>` (16 spaces) closes... hmm.

Wait, the original code was:

```jsx
{periods.map((period) => (
  <section className="topic-period" key={period.root}>
    <div className="side-label">{projectName(period.root)}</div>
    {period.topics.map((group) => (
      <section className="topic-group" key={group.topicId}>
        ...
      </section>
    ))}
    {editingTopicId !== group.topicId && (
      <details>...</details>
    )}
  </section>
))}
</div>
```

The diff removed the details block and replaced the inner content. Hmm, this is getting complex. The key question: is the JSX balanced?

Let me try to reconstruct the full new JSX from the diff. Actually, let me carefully write out the new version line by line based on diff hunks.

The diff hunk starts at `@@ -150,83 +162,89 @@` and shows:

```
         <section>
           <div className="side-label">{t('recentSessions')}</div>
-          <input ... />
+          <div className="side-search">
+            <svg ...>...</svg>
+            <input type="search" className="topic-search" ... />
+          </div>
           <label className="topic-archived-toggle">...</label>
           {sessions.length === 0 ? (
             <div className="side-empty">{t('noSessions')}</div>
-          ) : periods.length === 0 ? (
+          ) : workspaceGroups.every(group => group.periods.length === 0) ? (
             <div className="side-empty">{t('noSessions')}</div>
           ) : (
             <div className="topic-period-list">
-              {periods.map((period) => (
-                <section className="topic-period" key={period.root}>
-                  <div className="side-label">{projectName(period.root)}</div>
-                  {period.topics.map((group) => (
-                    <section className="topic-group" key={group.topicId}>
-                      <div className="topic-heading">
-                        {editingTopicId === group.topicId ? (
-                          <form ...>
-                            ...
-                          </form>
-                        ) : (
-                          <button className="topic-title" ...>...</button>
-                        )}
-                      </div>
-                      {group.sessions.map((session) => (
-                        <button ...>...</button>
-                      ))}
-                      {editingTopicId !== group.topicId && (
-                        <details className="topic-actions">...</details>
-                      )}
+              {workspaceGroups.map((workspace) => (
+                <section className="topic-period" key={workspace.root}>
+                  <div className="side-label">{projectName(workspace.root)}</div>
+                  {workspace.periods.map(period => (
+                    <section className="topic-period" key={period.key}>
+                      <div className="side-label topic-period-label">{t(period.key)}</div>
+                      {period.topics.map((group) => (
+                        <section className="topic-group" key={group.topicId}>
+                          <div className="topic-heading">
+                            {editingTopicId === group.topicId ? (
+                              <form ...>...</form>
+                            ) : (
+                              <button className="topic-title" ...>...</button>
+                            )}
+                            {editingTopicId !== group.topicId && (
+                              <div className="topic-actions-inline">
+                                ... buttons ...
+                              </div>
+                            )}
+                          </div>
+                          {group.sessions.map((session) => (
+                            <button ...>...</button>
+                          ))}
+
+                    </section>
+                  ))}
                     </section>
                   ))}
                 </section>
               ))}
             </div>
```

Now, original code had (removed lines):
```
-                <section className="topic-period" key={period.root}>       // section A
-                  <div className="side-label">{projectName(period.root)}</div>
-                  {period.topics.map((group) => (                             // map A
-                    <section className="topic-group" key={group.topicId}>    // section B
...
-                      {group.sessions.map((session) => (                      // map B
-                        <button ...>...</button>
-                      ))}                                                     // close map B
-                      {editingTopicId !== group.topicId && (
-                        <details ...>...</details>
-                      )}
+                      ...new content...
+                    </section>                                                // close section? 
```

Hmm wait, in the original we had:
```
-                    </section>
-                  ))}
+...new...
                     </section>
                   ))}
                 </section>
               ))}
             </div>
```

The removed lines `-                    </section>` and `-                  ))}` correspond to closing section B and closing map A? No wait.

Original:
```
{periods.map((period) => (           // map
  <section className="topic-period" key={period.root}>     // section A
    <div className="side-label">...</div>
    {period.topics.map((group) => (    // map A
      <section className="topic-group" key={group.topicId}>   // section B
        <div className="topic-heading">...</div>
        {group.sessions.map(...)}       // map B
        {editingTopicId !== group.topicId && <details>...</details>}
      </section>                        // close section B  ← this line was removed? 
    ))}                                 // close map A
  </section>                            // close section A  ← context line
))}                                     // close map
</div>
```

Yes! In the original:
```
-                      {editingTopicId !== group.topicId && (
-                        <details className="topic-actions"><summary ...>···</summary>
-                          ...
-                        </details>
-                      )}
+                      ...new stuff...
+                    </section>
+                  ))}
                     </section>      ← context (unchanged) = close section A
                   ))}                ← context = close map
                 </section>          ← context = close section A ... 

Hmm wait, this doesn't add up. Let me look at the exact context lines at the end:

```
+                    </section>
+                  ))}
                     </section>
                   ))}
                 </section>
               ))}
             </div>
```

Context lines (no +/-):
1. `                     </section>` (21 spaces)
2. `                   ))}` (19 spaces)
3. `                 </section>` (17 spaces)
4. `               ))}` (15 spaces)
5. `             </div>` (13 spaces)

These 5 context lines existed in the original. In the original:
- `</section>` (21sp) closes section A? Let's figure out the original structure's indentation.

Original (from the pre-diff code shown):
```
              {periods.map((period) => (               // 14 spaces
                <section className="topic-period" ...>  // 16
                  <div className="side-label">...       // 18
                  {period.topics.map((group) => (       // 18
                    <section className="topic-group" ...>  // 20
                      <div className="topic-heading">    // 22
                        {editingTopicId === ... ? (
                          <form ...>                     // 26
                            ...
                          </form>
                        ) : (
                          <button ...>...</button>
                        )}
                      </div>
                      {group.sessions.map((session) => (
                        <button ...>
                          ...
                        </button>
                      ))}
                      {editingTopicId !== group.topicId && (
                        <details className="topic-actions"><summary ...>···</summary>
                          ...
                        </details>
                      )}
                    </section>       // 20 spaces - closes section B (topic-group)
                  ))}                 // 18 spaces - closes map A
                </section>            // 16 spaces - closes section A
              ))}                     // 14 spaces - closes periods.map
            </div>                    // 12 spaces
```

Hmm, but the context lines show 21, 19, 17, 15, 13 spaces. Hmm, my count may be off by one. Let me just count the actual characters in the diff.

From the diff:
```
+                    </section>
+                  ))}
                     </section>
                   ))}
                 </section>
               ))}
             </div>
```

Line 1: `+` + 20 spaces + `</section>`
Line 2: `+` + 18 spaces + `))}`
Line 3: 21 spaces + `</section>`
Line 4: 19 spaces + `))}`
Line 5: 17 spaces + `</section>`
Line 6: 15 spaces + `))}`
Line 7: 13 spaces + `</div>`

Hmm, the context lines have one more space than the removed/added lines. This suggests the context lines were originally at indentation 20/18/16/14/12 and the diff added one space... no, that doesn't make sense; diff doesn't change indentation of context lines.

Actually I bet the raw diff has the `+` lines with content starting at the same column as the corresponding context lines. So added `</section>` at 20 spaces corresponds to a position where the context `</section>` is at 21 spaces? That's odd. Actually diff context lines have a leading space character as the diff marker. So a context line that is ` </section>` with marker space = ` ` + content. So content starts at position after the marker.

So for context line `                     </section>`: the first char is the diff marker (space), then 20 spaces, then `</section>`. Oh wait, no. Let me count: `                     </section>` — I count 21 spaces before `</section>`. One of those is the diff marker. So content indentation is 20 spaces.

For added line `+                    </section>`: `+` then 20 spaces then content. So content indentation is 20 spaces.

OK so they match. Good, my mistake. So:

Added line 1: 20 spaces `</section>`
Added line 2: 18 spaces `))}`
Context line 3: 20 spaces `</section>`
Context line 4: 18 spaces `))}`
Context line 5: 16 spaces `</section>`
Context line 6: 14 spaces `))}`
Context line 7: 12 spaces `</div>`

Hmm, wait: context line 3 = 21 chars of space total including marker → 20 spaces content. Context line 5 = 17 spaces including marker → 16 spaces content. Hmm, I said line 5 has 17 spaces. Let me recount from the raw text.

Ugh, this manual counting is error-prone. Let me think about it differently: is the JSX valid React?

New structure:
```jsx
<div className="topic-period-list">
  {workspaceGroups.map((workspace) => (
    <section className="topic-period" key={workspace.root}>
      <div className="side-label">{projectName(workspace.root)}</div>
      {workspace.periods.map(period => (
        <section className="topic-period" key={period.key}>
          <div className="side-label topic-period-label">{t(period.key)}</div>
          {period.topics.map((group) => (
            <section className="topic-group" key={group.topicId}>
              <div className="topic-heading">
                ...
              </div>
              {group.sessions.map((session) => (
                <button>...</button>
              ))}
            </section>       // added, 20 spaces
          ))}                 // added, 18 spaces
        </section>            // context, 20 spaces → closes period section
      ))}                     // context, 18 spaces → closes workspace.periods.map
    </section>                // context, 16 spaces → closes workspace section
  ))}                         // context, 14 spaces → closes workspaceGroups.map
</div>                        // 12 spaces
```

Hmm wait, but the closing `</section>` for the group section is added line 1 (20sp). Then `))}` (18sp) closes `period.topics.map`. Then context `</section>` (20sp) closes the period section. Then context `))}` (18sp) closes `workspace.periods.map`. Then context `</section>` (16sp) closes workspace section. Then `))}` closes workspaceGroups.map. Then `</div>`.

Total opening tags in new content:
1. `<div className="topic-period-list">`
2. `{workspaceGroups.map((workspace) => (` → `<section>` (workspace)
3. `<div className="side-label">...</div>`
4. `{workspace.periods.map(period => (` → `<section>` (period)
5. `<div className="side-label topic-period-label">...</div>`
6. `{period.topics.map((group) => (` → `<section>` (group)
7. `<div className="topic-heading">...</div>`
8. `{group.sessions.map((session) => (<button>...</button>))}`

Closings: group section, then map3, then period section, then map2, then workspace section, then map1, then div. That's consistent: 3 sections opened, 3 sections closed.

Wait, but is that right? We have 3 `</section>` closings and 3 `<section>` openings? Let's see: added `</section>` (1), context `</section>` (2), context `</section>` (3). Yes 3. And openings: workspace (1), period (2), group (3). Yes 3. 

But hold on. The structure implies: the `period.topics.map` closes AFTER the group section closes, and the period section closes after that. Measurement:
- group section closes: `</section>`
- then `))}` closes `period.topics.map` 
- then `</section>` closes period section
- then `))}` closes `workspace.periods.map`
- then `</section>` closes workspace section

Yes that's balanced. OK so JSX is likely valid. Although the indentation is atrocious and confusing. Actually hmm, wait. Let me double check: `{period.topics.map((group) => ( <section>...</section> ))}`. The map callback returns a single `<section>` element. The closing `</section>` for that is added line 1 at 20 spaces. Then `))}` at 18 spaces. OK.

Then `{workspace.periods.map(period => ( <section>...</section> ))}`. The inner content includes the `<div className="side-label topic-period-label">` and the topics map. Its closing `</section>` is context line 3 (20 spaces). Then `))}` context line 4 closes workspace.periods.map.

Hmm, but the indentation: period section opens at... in the added lines, `<section className="topic-period" key={period.key}>` is at 20 spaces indentation. Its closing should be at 20 spaces. Context line 3 at 20 spaces. ✓.

Workspace section opens at 16 spaces (`<section className="topic-period" key={workspace.root}>` at 16 spaces). Its closing at 16 spaces = context line 5. ✓.

Great, so JSX seems balanced. But wait — one issue: the group section `<section className="topic-group">` opens at 26 spaces but closes at 20 spaces. Indentation inconsistent but valid.

Hmm, actually, hold on. Let me re-examine. Is there a duplicate `section className="topic-period"`? Yes: both workspace section and period section use `className="topic-period"`. That's a CSS semantic issue — the period section will get `margin-top: 12px` from `.topic-period`, and it's nested inside another `.topic-period`. Also `.topic-period-list` scroll is on the outer. Nested `.topic-period` both have margin-top: 12px. Minor visual issue, plus it means the workspace heading and period label both get `.topic-period` class — semantic misuse. Not a functional break.

Hmm, but wait: the test asserts `expect(html.match(/topic-period-label/g)).toHaveLength(3);`. With sessions: today (workspace E:/workspace), yesterday (E:/workspace), other (E:/other). So workspace E:/workspace has periods Today, Yesterday → 2 labels; E:/other has Today → 1 label. Total 3. OK that matches.

Hmm, but the test expects `expect(html).toContain('topic-session side-item-active')`. The class is `side-item topic-session${active ? ' side-item-active' : ''}` → "side-item topic-session side-item-active". The test contains 'topic-session side-item-active' ✓.

Also `expect(html).toContain('aria-label="Rename session"')` — need i18n key topicRename = "Rename session" in en. Probably yes.

Now the test asserts `expect(html).not.toContain('<details')` — the new code removed details. ✓

Now, the big question: does the test's date boundary check align with the implementation? Let's verify.

Implementation:
```js
const today = new Date(now);
today.setHours(0, 0, 0, 0);
const todayStart = today.getTime();
const day = 24 * 60 * 60 * 1000;
const yesterdayStart = todayStart - day;
const lastWeekStart = todayStart - 7 * day;
```

Period assignment:
```js
!Number.isFinite(timestamp) || timestamp < lastWeekStart ? 'topicEarlier'
: timestamp < yesterdayStart ? 'topicLastSevenDays'
: timestamp < todayStart ? 'topicYesterday'
: 'topicToday';
```

Test:
```js
const now = new Date(2026, 9, 19, 12).getTime();  // Oct 19, 2026 local noon
const midnight = new Date(2026, 9, 19).getTime(); // Oct 19 00:00 local
const day = 24*60*60*1000;
input = [
  session('old', midnight - 7*day - 1),
  session('week', midnight - 7*day),
  session('yesterday', midnight - day),
  session('today', midnight),
  session('last-night', midnight - 1)
];
```

- today midnight = todayStart. 'today' at todayStart → not < lastWeekStart, not < yesterdayStart, not < todayStart → topicToday ✓
- 'last-night' midnight - 1ms → < todayStart, not < yesterdayStart (yesterdayStart = todayStart - day; midnight-1 > todayStart-day) → topicYesterday ✓
- 'yesterday' midnight - day = yesterdayStart → not < yesterdayStart → so falls to... wait: `timestamp < yesterdayStart ? 'topicLastSevenDays' : ...`. timestamp === yesterdayStart, so not less → goes to next: `timestamp < todayStart ? 'topicYesterday'`. yesterdayStart < todayStart → true → topicYesterday ✓. Good, boundary inclusive of yesterdayStart.
- 'week' midnight - 7*day = lastWeekStart → not < lastWeekStart → next: lastWeekStart < yesterdayStart → topicLastSevenDays ✓
- 'old' midnight - 7*day - 1 → < lastWeekStart → topicEarlier ✓

Expected: ['topicToday', 'topicYesterday', 'topicLastSevenDays', 'topicEarlier'] and sessions [['today'], ['last-night','yesterday'], ['week'], ['old']]. Wait: in Yesterday period, order is 'last-night' then 'yesterday'. Sessions are sorted descending by updatedAt/createdAt. 'last-night' = midnight-1 (Oct 18 23:59:59.999), 'yesterday' = midnight-day (Oct 18 00:00). So last-night > yesterday → ordering ✓.

But hold on: the grouping is by topic; each session has topicId = id by default, so each is its own group. The period ordering: 'topicToday' first. Since groups are pushed in order... The `periods` Map has keys in order today, yesterday, lastSevenDays, earlier. Then flattened. Within a period, topics are ordered by insertion, which follows the sorted sessions order (descending). So Yesterday has last-night then yesterday ✓.

Now the invalid date test:
```js
expect(groupSessionsByDateAndTopic([{ ...session('bad', now), createdAt: 'invalid' }], now)[0]!.key).toBe('topicEarlier');
```
session('bad', now) creates `createdAt: new Date(now).toISOString()`, topic {createdAt: now, updatedAt: now}. Then override createdAt: 'invalid'. The grouping computes `latest = group.sessions[0]` presumably sorted, `timestamp = Date.parse(latest.updatedAt ?? latest.createdAt)`. The session's `updatedAt` is undefined (session() doesn't set updatedAt), and topic has updatedAt: now. Hmm — what does the implementation use for latest? Let me think: the diff doesn't show that part, but from context:

```js
const latest = ...;
const timestamp = latest ? Date.parse(latest.updatedAt ?? latest.createdAt) : Number.NaN;
if (!Number.isFinite(timestamp) || timestamp < lastWeekStart) → topicEarlier
```

We don't see how `latest` is computed in the diff (it's in unchanged code). Presumably `const latest = group.sessions[0]` after sorting. Sorting is `(b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)` on strings. For 'invalid' createdAt... localeCompare works on strings, fine.

Then `Date.parse('invalid')` = NaN → !Number.isFinite → topicEarlier ✓. But wait — does the group's session have updatedAt? session() returns {id, workspaceRoot, createdAt, topic}. No updatedAt field. The topic object has updatedAt. So `latest.updatedAt` is undefined → `latest.createdAt` = 'invalid' → NaN ✓.

Hmm, but actually, does the implementation use session.updatedAt ?? session.createdAt? The sort says yes. OK.

Now the second test: "keeps a topic together using its latest updated activity":
```js
const older = session('older', midnight - 10*day, 'shared');
const newer = { ...session('newer', midnight - 9*day, 'shared'), updatedAt: new Date(now).toISOString() };
```
Wait, midnight - 10*day is Oct 9, which is < lastWeekStart (Oct 12) → would be Earlier. newer created Oct 10 but updatedAt = now (Oct 19) → Today. Both share topicId 'shared'. The group's topic timestamp = latest session's updatedAt = now → topicToday. Expects 1 group, key topicToday, sessions ['newer','older'].

Hmm — but does the grouping actually merge by topicId across periods? Yes, implementation builds `topics` Map by topicId first, then assigns each group to a period based on its latest session. So both sessions in one group, and group goes to Today. ✓ Test expectation matches.

Hmm, but wait: does 'older' with updatedAt undefined sort after 'newer'? Sort by (b.updatedAt ?? b.createdAt) vs (a...). newer: now (Oct 19). older: Oct 9. So newer first ✓.

Now let me look at the more subtle issue: the test uses `vi.useFakeTimers(); vi.setSystemTime(now);` then renders. But `formatClock` uses... hmm, `formatClock` from '../utils/timeFormat' — not provided in the diff! Is that a missing file? The diff imports `import { formatClock } from '../utils/timeFormat';` but no creation of `apps/web/src/utils/timeFormat.ts` appears in the diff. That's a potentially critical issue: if the file doesn't exist, the build breaks. But the reviewer only sees the diff for these files; the task says "检查新增的 Sidebar.test.tsx". Hmm. The diff provided is presumably complete for the task's changed files. If `utils/timeFormat` is new, it should appear. It doesn't. Either it already existed (used elsewhere) or the diff is incomplete. This is worth flagging as a risk/verification point. Let me note: "formatClock" — is it used elsewhere? Possibly in Home/workbench. Not shown.

Actually, the i18n additions include `homeUpdated: '更新于 {time}'` and lots of workbench stuff (workbenchWelcome, quickStart, starterReview...) which are NOT used by the diff's Sidebar/TaskComposer. So the diff includes unrelated changes (i18n keys for other features like plan checklist, home workbench, composer library, rail nav, collapsed sidebar). That means the diff is a superset — a bundle. The presence of unrelated i18n keys suggests this diff spans multiple tasks. That itself is a review finding: scope creep / unrelated changes mixed in, and `formatClock` likely comes from another change.

Hmm, but the review's job: evaluate whether the DoD is met. Let me focus and enumerate concrete findings.

### Finding 1: `formatClock` replaces `toLocaleDateString()` — locale/regression

Original: `new Date(session.updatedAt ?? session.createdAt).toLocaleDateString()` for single-session groups. New: `formatClock(session.updatedAt ?? session.createdAt)`. This is a behavior change; the DoD didn't ask for it. Also, if formatClock expects a string or number — unknown signature. Importing an unverified module. Also the test doesn't cover formatClock output (except indirectly? no). Actually the test renders and checks html contains... it doesn't check time text. But it does render "today"/"yesterday" sessions with now. If formatClock returns relative time like "12:00" fine.

Risk: `formatClock` may be undefined/unimplemented → runtime crash on render (TypeError). This is a hard REJECT-worthy risk unless the file exists. As adversarial reviewer I must call it out: the diff provides no implementation or evidence. At minimum it's an unverified dependency.

Hmm, also: The test file mocks './LanguageProvider' but not '../utils/timeFormat'. The test uses `translate('en')` — does `translate` exist in i18n and does it return a function? The test calls `translate('en')` returning `t`, then uses `t: translate('en')`. Then t('topicToday') etc. If translate's signature is `translate(lang)` returning a MessageTemplate lookup function, fine. But the i18n diff doesn't show `translate` export. It presumably exists (used elsewhere in tests). But also, is `translate('en')` returning a function that takes `key` and optional params? In the rendered HTML, `{t(period.key)}` — with `t` from useI18n. OK.

However, there's a subtlety: `translate` might be `(lang) => (key, params) => string`. Fine.

### Finding 2: Test asserts `expect(input[0]!.id).toBe('old')` — no-op assertion (tautology)

That assertion just checks the array literal wasn't mutated... it's weak but harmless. Adversarial note: it's a filler assertion providing no coverage.

### Finding 3: Grouping boundary — `lastWeekStart = todayStart - 7*day` and "Previous 7 Days" semantics

DoD says periods: Today / Yesterday / Previous 7 Days / Earlier. Yesterday is [todayStart - 1d, todayStart). Last 7 days is [todayStart - 7d, todayStart - 1d). So "Previous 7 days" covers days -2..-7 (6 days) plus... hmm: [todayStart-7d, todayStart-1d) = days from 7 days ago 00:00 through yesterday's 23:59:59.999... wait no, yesterdayStart = todayStart - 1d, so last 7 days = [todayStart-7d, yesterdayStart) = D-7 00:00 to D-1 00:00 = D-7, D-6, D