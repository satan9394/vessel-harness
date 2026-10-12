# Card 210 work proof

- Scope: Web UI internationalization only, preserving session/mesh/patch protocol values and the existing V2.5 implementation.
- Dictionaries: 478 typed messages organized into common, session, model, canvas, patch, reasoning, palette, attention and status interfaces. Both languages expose the same key set; all interpolation contracts are checked (English plural suffixes are optional in Chinese). English dictionary has zero Chinese characters.
- Consumers: NewSessionForm, inspector/cache/AST/patch panels, reasoning widgets, command palette and its App command registry, attention controls, ModelSelector, sidebar/module labels, Team/Goal views, sandbox audits, subagent views, metrics and tool activity all consume the language context. Source scan leaves only Vessel, SHA-256, vessel serve and an arrow symbol as fixed JSX text.
- Accessibility: language changes preserve protocol-backed CSS classes. Permission-card keyboard navigation now uses a stable data attribute, rather than an English aria label. Existing focus, event listener and timer ownership is retained.
- Tests: strengthened dictionary/interpolation coverage and a new controlled rerender test using real context/rendering, proving an explicit language change updates existing consumers and persists. Legacy component tests updated by the parent to provide real language context or the actual English translator in direct-call hook harnesses; their behavior assertions remain.
- No packages/core changes, new dependencies, deletions, commits, push, publishing or external agents were made for this card. Provider-store/model API work belongs to card 211 onward.

Verification after the final dictionary edit:

| Gate | Result | Evidence |
|---|---|---|
| `npx vitest run --root apps/web src/i18n.test.ts src/i18n.context.test.tsx` | PASS, 2 files / 16 tests | `card210-i18n-final.log` |
| `npm run -w @vessel/web typecheck` | PASS, exit 0 | `card210-typecheck-final.log` |
| Full Web regression | PASS, 30 files / 256 tests, exit 0 | `card210-web-accepted-2.log` |
| Dictionary and source audit | 478 aligned messages; no fixed UI prose | `card210-dictionary-audit.json`, `i18n-phrases.json` |

Read-only/source-preserving audit commands:

```powershell
node evidence/sessions/2026-10-11-v2.6/extract-i18n.cjs
node evidence/sessions/2026-10-11-v2.6/audit-i18n-english.cjs
npm run -w @vessel/web typecheck
npx vitest run --root apps/web src/i18n.test.ts src/i18n.context.test.tsx
```

The i18n preparation/application scripts in this evidence folder document one-time implementation mechanics. They are not repeatable verification commands. Provider/common keys reserved by the task contract are intentionally retained for cards 212–213.

Parent browser verification: built with --emptyOutDir false; isolated server on 127.0.0.1:31826; Chinese/English language switching, new-session form, offline session creation and Chinese Inspector observed in actual rendered browser. Screenshot: card210-browser-zh.png. This is UI evidence only, not real provider connectivity.
