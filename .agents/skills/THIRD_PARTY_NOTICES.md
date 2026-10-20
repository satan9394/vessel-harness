# Third-party notices — imported design/UI skills

本目录下的设计/UI 技能是从本机星标技能库（`E:\DeepSeek_Harness\workspace\2026_08_25\stars-scan\repos`）
按上游仓库原样复制的第三方内容，用于本项目（Vessel_Harness）内的 UI/UX 设计与评审工作。
每个技能保留其上游 `SKILL.md` 与附带文件；上游许可证全文存放于 `_licenses/`。

引入日期：2026-10-14。任务卡：`tasks/223-web-ui-visual-overhaul-and-design-skills.md`。

## 已引入（均为 MIT 或 Apache-2.0）

| 技能目录 | 上游仓库 | 上游路径 | 许可证 | 版权 |
|---|---|---|---|---|
| `baseline-ui` | ibelick/ui-skills | `skills/baseline-ui` | MIT | Copyright (c) 2026 Julien Thibeaut |
| `improve-ui` | ibelick/ui-skills | `skills/improve-ui` | MIT | Copyright (c) 2026 Julien Thibeaut |
| `create-design-md` | ibelick/ui-skills | `skills/create-design-md` | MIT | Copyright (c) 2026 Julien Thibeaut |
| `fixing-motion-performance` | ibelick/ui-skills | `skills/fixing-motion-performance` | MIT | Copyright (c) 2026 Julien Thibeaut |
| `visual-acceptance` | huiliyi37/Tianshu-harness | `runtime-assets/bundled-skills/visual-acceptance` | Apache-2.0 | Tianshu-harness contributors |
| `design-prototype` | huiliyi37/Tianshu-harness | `plugins/design/skills/design-prototype` | Apache-2.0 | Tianshu-harness contributors |
| `dsh-client-ui-ux` | deepseek-ai/deepseek-harness | `.agents/skills/dsh-client-ui-ux` | MIT | Copyright (c) 2026 DeepSeek |
| `make-interfaces-feel-better` | affaan-m/ECC | `skills/make-interfaces-feel-better` | MIT | Copyright (c) 2026 Affaan Mustafa |
| `visual-design-foundations` | wshobson/agents | `plugins/ui-design/skills/visual-design-foundations` | MIT | Copyright (c) 2024 Seth Hobson |
| `design-system-patterns` | wshobson/agents | `plugins/ui-design/skills/design-system-patterns` | MIT | Copyright (c) 2024 Seth Hobson |
| `high-end-visual-design` | Leonxlnx/taste-skill | `skills/soft-skill` | MIT | Copyright (c) 2026 Leonxlnx |
| `minimalist-ui` | Leonxlnx/taste-skill | `skills/minimalist-skill` | MIT | Copyright (c) 2026 Leonxlnx |
| `gpt-taste` | Leonxlnx/taste-skill | `skills/gpt-tasteskill` | MIT | Copyright (c) 2026 Leonxlnx |
| `redesign-existing-projects` | Leonxlnx/taste-skill | `skills/redesign-skill` | MIT | Copyright (c) 2026 Leonxlnx |
| `impeccable` | pbakaus/impeccable | `.agent/skills/impeccable` | Apache-2.0 | pbakaus/impeccable contributors |
| `emil-design-eng` | emilkowalski/skills | `skills/emil-design-eng` | MIT | Copyright (c) 2026 Emil Kowalski |
| `animate` | emilkowalski/skills | `skills/animate` | MIT | Copyright (c) 2026 Emil Kowalski |
| `extract-design` | Manavarya09/design-extract | `skills/extract-design` | MIT | Copyright (c) 2024 Manavarya Singh |

### 有意裁剪

- `impeccable` 只引入 `SKILL.md` 与 `reference/`（正文指导），省略上游的 `scripts/`（含约 1 MB 的
  `font-index.json` 与浏览器自动化脚本），以控制仓库体积。需要脚本时从上游仓库获取。

## 有意**未**引入（许可证不允许或不明）

本仓库在 GitHub 上为 Public，以下技能**没有**复制进本目录，只在设计/评审时通过本机全局挂载使用：

| 技能 | 上游仓库 | 原因 |
|---|---|---|
| `frontend-design` | anthropics/claude-code | 上游 `LICENSE.md` 为 "Anthropic PBC. All rights reserved."（专有许可），不可再分发 |
| `web-design-guidelines` | vercel-labs/agent-skills | 仓库内找不到任何 LICENSE / COPYING 文件，授权不明，不予复制 |

## 关于本机全局挂载

曾把这 9 个技能（`baseline-ui`、`improve-ui`、`create-design-md`、`visual-acceptance`、`design-prototype`、
`dsh-client-ui-ux`、`make-interfaces-feel-better`、`visual-design-foundations`、`web-design-guidelines`）
通过 `stars-tools/stars.py deploy` 挂到本机 4 个 Agent。**该挂载已按用户要求全部撤销**
（`stars.py undeploy`，四个 Agent 目录残留为 0）。

本目录的副本是这批技能在本项目内的**唯一**存在形式，与任何本机全局配置无关。
