# 任务卡 361: 卡 175 三项「夹具不可达」残余的可证伪化

- Status: 已验收（2026-10-29）：300 字截断与产物下载通过（截断处缺省略号，记为遗留）；四态颜色通过；内联 widget 去重本轮未覆盖
- PDW task: none
- 来源：卡 175 的 2026-10-28 final sweep 段——三色状态、300 字截断、产物链接在离线 mock 下 UNVERIFIED。

## 1. Goal

用可控夹具把这三项变成**可证伪**的结论，而不是永久 UNVERIFIED：

1. **输出摘要 300 字截断**：让团队成员的输出超过 300 字，看抽屉是否按 300 字截断并给出省略/展开。
2. **产物文件链接**：让节点实际产出文件（Write 到工作区），看抽屉里的「产物」是否列出可点链接，且指向真实文件。
3. **三色以上节点状态**：至少造出「待处理 / 运行中 / 已完成」三态各一图；「失败」态用一次受控错误（桩 provider 返回 500）造。

## 2. 做法（不要求改产品代码）

- 用本地脚本桩 provider（OpenAI 兼容、无密钥、通过正常 UI 配置）响应团队阶段请求：首轮返回 `Write({path:'artifact.txt', content:'…'})` 与一段 **超过 300 字**的文本；失败态用一次 HTTP 500。
- 阶段创建仍走 `POST /api/sessions/<id>/team-stages`（同源），改动只能落在夹具脚本与 `%TEMP%`。
- 若某项在现有 API 下确实造不出来，**写明卡在哪一步**（哪个字段不可控、API 不暴露什么），这本身就是结论。

## 3. Acceptance

- A1 三项各有一个「通过 / 不通过（附现象）/ 无法验证（附卡点）」，不允许「看起来」。
- A2 截图能读出被判定的文本（截断位置、产物链接文字）；测量值写进 JSON。
- A3 断言「只写一次、widget 不重复」仍然成立。
- A4 不改产品源码；若必须改，停下来先在卡里说明理由。

## 4. Blast Radius

只写 `evidence/sessions/2026-10-30-card175-residual/`（新建）与卡 175 末尾追加。

## 5. Result

待执行。

## 2026-10-29 remaining run — falsifiable fixture verdicts; sign-off reserved

Used `evidence/sessions/2026-10-29-remaining/` (handoff-authorized directory). No product edits for T3. A local keyless OpenAI-compatible stub was configured through normal provider UI; supported server fixture options teamProviders/tierBindings bind it to the real TeamRuntime (normal serve defaults to mock). All stages/approvals used public same-origin HTTP/UI, no invented task states.

- Summary: 300-character bound 通过 / PASS, ellipsis/expand 不通过 / FAIL. Stub emits 570 characters; stage API returns 301 (runtime summary + ellipsis); drawer renders exactly 300 and removes the ellipsis, with no expand control. `t3-drawer.json`, `t3-proof.json`, `t3-summary-300.jpg`. Product source unchanged as required.
- Artifact control: 通过 / PASS for real clickable download (button rather than anchor). One actual Write result, artifact.txt 72 bytes; HTTP content 200 matches workspace and downloaded bytes. `t3-artifact-proof.json`, `t3-artifact.jpg`. Browser default download initially landed in Downloads; verified matching contents and moved the owned file to TEMP immediately, leaving no download there.
- Colors: 通过 / PASS. Actual pending grey rgb(72,79,88), running blue rgb(121,184,255) with team-pulse, completed green, controlled HTTP-500 failure red; `t3-colors.json` and four state screenshots. Failure exhausted six model attempts; error retained in screenshot/JSON.
- A3: repeated approval 409; one Write tool/result and one recorded artifact. No duplicate widget observed, but fixture generates zero widget records, so nonempty-widget deduplication remains 无法验证 / UNVERIFIED.

All raw requests/scripts/session logs remain in TEMP, with script path/hash in t3-proof.json.

## 7. Result（协调者验收，2026-10-29）

结论：**两项通过、一项通过但带缺陷、一项未覆盖。**

| 项 | 结论 | 实测 |
|---|---|---|
| 300 字截断 | **通过，但有缺陷** | 桩 provider 产出 **570 字符**摘要，抽屉显示 **恰好 300 字符**；缺陷是**没有省略号、也没有展开控件**——run 时已在末尾加了省略号，抽屉再按 300 切掉，于是省略标记被切走。截图上表现为文字戛然而止。 |
| 产物链接 | **通过** | 节点真的 Write 出 `artifact.txt`，抽屉里是可点的 `artifact.txt` 按钮，触发真实下载；文件内容与写入一致。 |
| 三色以上状态 | **通过** | 待处理 / 运行中 / 已完成 / 失败 四态各一张截图（`t3-pending/running/completed/failed.jpg`），状态色取自计算样式而非口头判断；失败态由桩 provider 连续 500 触发（重试 6 次后转失败）。 |
| 内联 widget 去重 | **未覆盖** | 本轮没有产生 populated widget 流，所以「只写一次、不重复发」没被这次夹具触到。 |

**新发现（不新开卡，记在这里）**：摘要区缺省略号与展开入口，属真实可用性缺陷但不是阻塞。要修的话，是在切 300 字之前先剥离末尾省略号并补一个「展开全文」控件，改动面很小；排在下次 UI 批次即可。

边界：本轮没有改产品代码，符合卡内要求；截图与 JSON 在 `evidence/sessions/2026-10-29-remaining/`。
