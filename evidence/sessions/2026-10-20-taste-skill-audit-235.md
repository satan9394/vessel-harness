# Task 235 — Taste-Skill workbench audit

## Scope and design decision

Source audit: `App.tsx`, `styles.css`, `Rail.tsx`, `Sidebar.tsx`, `TaskComposer.tsx`, `ConversationView.tsx`, and the inspector layout CSS. Basis: Taste-Skill `references/app-screens.md`, especially flat surfaces, restrained chrome, §3 shell, §4 alignment, §8 forms, and §12 responsive layouts. This is a live developer tool, not a marketing page; existing React/CSS and real API data remain authoritative. No dependency or font download is needed.

The screen answers: which project and task should Vessel execute next? Its identity is the existing Vessel mark, project path, execution permissions, model selection, and observable conversation/inspector. Preserve these instead of adding decorative dashboard content. Use neutral charcoal/paper surfaces and existing system typography for long engineering sessions. The user's explicit edge-to-edge direction takes precedence over the skill's optional style lottery.

## Five verified source defects and remedies

1. **Curved islands.** Rail, navigation and main use independent radii, full outlines and shadows; navigation uses the 24px token. TaskComposer adds a 32px outer enclosure around a 20px inner surface. This violates the flat-surface rule. Make shell boundaries square; retain only 4–6px functional control corners and circular status indicators.
2. **Gutters interrupt the frame.** `.app` consumes 24px at its outer edges plus two 12px column gaps; the inspector repeats that gap. At desktop width W, the intended arithmetic is 58 + 232 + (W − 290) = W, including border-box separators. Remove shell gaps and use right borders on the rail/navigation and a left border on the inspector. Make the responsive drawer meet the rail at x=58, y=0 instead of x=82, y=12.
3. **Material overload.** Body radial light fields, translucent glass, 26px blur/saturation and large soft shadows compete with execution evidence. Use opaque #ffffff/#f6f8fa light surfaces and #0d1117/#161b22 dark surfaces. Remove background glow and shell blur. Reserve a small shadow for actual overlays, not static chrome.
4. **Hierarchy competes with the task.** Accent-filled navigation, uppercase tracked group labels, nested composer backgrounds and multiple radii give chrome equal weight to content. Use neutral active navigation, sentence-case group labels, a single outlined task input surface, aligned project/model/permission controls and flat buttons. Keep focus rings and semantic execution/error colours.
5. **Immersion and responsive continuity break.** The main region is bounded like a card, the home has a fixed 960px cap, and the inspector is another detached card. Fill the viewport and the available main width, keep a 48px desktop topbar, and let long content scroll without compressing the existing conversation minimum-height safeguard. On narrow screens retain reachable controls, wrapping and the existing accessible drawer. Do not force conversation `height:100%` alongside module panels: it would overflow the flex parent; use the existing flex allocation with a full-height workbench region.

## Implementation and verification plan

Edit shared tokens and original CSS rules rather than add a competing theme stylesheet. Preserve session deletion, theme persistence, ProviderHub, command palette, Markdown and OpenUI behavior by leaving their handlers/rendering intact. Inspect CSS cascade and responsive rules, run TypeScript build, test typecheck, production Web build with `--emptyOutDir false`, and both Vitest roots. Keep command logs under `2026-10-20-card235/`.

Browser preflight: the built-in browser returned `Browser is not available: iab`; browser inventory is empty. No before screenshot or measured rendered geometry can be claimed. Source evidence is saved as `styles.before.css` and `layout.before.css`; visual and browser interaction acceptance remains pending until a browser surface is available.
