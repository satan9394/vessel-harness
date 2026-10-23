# Vessel 浏览器验收 — 2026-10-23

实际执行日期：2026-10-22（America/Los_Angeles）；文件名日期按任务指定保留。
环境：IAB，端口 5678，构建 commit 34730cd；夹具 C:\work\AppData\Local\Temp\vessel-audit-e07eb814（保留）。

## Mock / 内置演示模型

结论：审计覆盖已执行，产品验收未全通过。以下均来自 IAB 截图、DOM 或可访问性观测；构建和 HTTP HEAD 仅为环境检查。

| 场景 | 结论 | 关键现象 | 截图 |
|---|---|---|---|
| S1 | 部分通过 | hello 与 (mock) default 渲染；空输入发送禁用；首帧可交互时延未测量，不宣称 <500ms | [03-s1-hello-before-refresh-dark-zh.png](2026-10-23-browser-acceptance/03-s1-hello-before-refresh-dark-zh.png) |
| S2 | 通过 | 刷新后重新打开 hello，用户与助手消息完整重现 | [04-s2-restored-dark-zh.png](2026-10-23-browser-acceptance/04-s2-restored-dark-zh.png) |
| S3 | 不通过 / 部分无法验证 | 自建会话删除失败并恢复索引；刷新仍存在；未发现该分组的组删除入口 | [05-s3-confirm-own-session-dark-zh.png](2026-10-23-browser-acceptance/05-s3-confirm-own-session-dark-zh.png) / [07-s3-failed-delete-persists-dark-zh.png](2026-10-23-browser-acceptance/07-s3-failed-delete-persists-dark-zh.png) |
| S4 | 部分通过 | 三个有回复的夹具会话显示已完成；旧无确认记录显示未确认；running→completed 的 Activity 过程及取消态无法验证 | [08-s4-activity-completed-unconfirmed-dark-zh.png](2026-10-23-browser-acceptance/08-s4-activity-completed-unconfirmed-dark-zh.png) |
| S5 | 无法验证 | Mock 9–21ms 结束，Stop 在点击前已禁用；长任务提示也只返回 (mock) default，无实际取消证据 | [67-s5-long-task-stop-unavailable-light-en.png](2026-10-23-browser-acceptance/67-s5-long-task-stop-unavailable-light-en.png) |
| S6 | 不通过 | 单行 INPUT 吞掉粘贴换行；Enter 和 Shift+Enter 都发送；请求读 README 也未产生工具事件，工具默认折叠无法验证 | [13-s6-shift-enter-submits-dark-zh.png](2026-10-23-browser-acceptance/13-s6-shift-enter-submits-dark-zh.png) |
| S7 | 部分通过 | A 草稿不串到 B，回 A 恢复；刷新首屏 activeElement=BODY，没有自动聚焦 | [11-s7-session-b-draft-dark-zh.png](2026-10-23-browser-acceptance/11-s7-session-b-draft-dark-zh.png) / [12-s7-session-a-restored-draft-dark-zh.png](2026-10-23-browser-acceptance/12-s7-session-a-restored-draft-dark-zh.png) / [68-s7-initial-focus-light-en.png](2026-10-23-browser-acceptance/68-s7-initial-focus-light-en.png) |
| S8 | 部分存在 | Studio 行为有效快照只读展示策略映射；没有找到独立、完整的当前会话生效 Policy 汇总 | [16-s8-policy-mapping-1440-dark-zh.png](2026-10-23-browser-acceptance/16-s8-policy-mapping-1440-dark-zh.png) |
| S9 | 部分通过 | 五宽度×双主题×四页面共40格，另8格英文抽查；无文档横向溢出；真实150%缩放无法验证；英文供应商描述及主题无障碍名称仍含中文 | 见下表 |

## 逐条细节

### Mock 供应商准备
Provider Hub 无已配置供应商；搜索 mock 返回“未找到匹配项”，协议仅 OpenAI Compatible / Anthropic，无法创建指定 id/protocol/model 均为 mock 的预设。使用界面明确标注“不连接真实供应商”的内置演示模型执行可行检查，返回 (mock) default；不把它等同于指定 Mock 预设注册成功。证据：[02-mock-search-no-match-zh.png](2026-10-23-browser-acceptance/02-mock-search-no-match-zh.png)。

### S2 刷新保史
步骤：夹具项目发送 hello → 等待回复 → reload → 导航重新打开 hello。期望：两条消息保留。实际：hello 与 (mock) default 均恢复，无404或持续加载。通过。

### S3 删除端到端
步骤：在同一夹具创建 audit-delete-one、audit-delete-two → 对 audit-delete-one 点删除 → 确认 → 刷新。期望：回收站成功后从列表移除。实际：行内提示“sess_1792665262143_02d24156 : 无法移入回收站；会话索引已恢复，可重试。”，提供重试按钮，刷新仍存在。删除功能本次失败，错误没有伪装成功。删除中禁用态太短，未观察到；没有重试循环。导航中该项目下只有日期分组及逐会话删除按钮，没有可用组删除入口，未对任何历史会话或其它项目执行删除。

### S4 / S5 执行状态与 Stop
正常三会话在 Activity 的“已完成·3”中，与已收到回复一致；既有两条缺确认记录标“未确认”，另有既有失败记录，均只读观察。取消尝试：发送后 Stop 短暂可用，但 click 时已 disabled；长请求同样在9ms结束。不能据此证明取消成功、取消状态正确、错误位置或取消后输入保留。

### S6 多行与工具
步骤一：消息框填入 line one + 换行 + line two，按 Enter。实际用户消息是 line oneline two。步骤二：输入 first，按 Shift+Enter，再输入 second。实际 first 被发送，second 成为新草稿。DOM 确认消息框是 INPUT。期望支持换行；实际两条路径均不支持。读 README 的提示仅获 (mock) default，没有可观察工具调用；不判断工具折叠。

### S7 聚焦与草稿
A=hello，写 AUDIT_DRAFT_A_do_not_send，不发送 → B=audit-delete-two，消息框 value为空 → 回 A，草稿恢复。草稿隔离通过。刷新首屏，DOM activeElement=BODY；通过新建会话入口时焦点仍在导航按钮。首屏自动聚焦不通过。

### S8 生效 Policy
查过 Settings、Studio、Inspector 诊断/认知规则。Settings 是模型表单及视图/语言；Inspector 认知规则是只读反思规则，不等于有效 Policy。Studio“行为有效快照”只读展示 L0–L4、来源、哈希、优先级、执法通道与策略映射，包含 filesystem.protected、shell.deny、filesystem.deny_read 及规则 ID。完整当前会话 Policy 汇总区域：本次查找不存在；已有映射区不应被误报成完全不存在。未编辑候选配置。

### S9 响应式、主题、语言、缩放
全部40格记录DOM innerWidth、documentElement.scrollWidth、body.scrollWidth及 main 内越界元素。下表“横向溢出无”仅证明该次渲染DOM几何，不等于每个按钮都实点验证。截图抽查360双主题、768 Activity、1024 Provider、1440 Settings/Conversation及1920 Provider：未见明显重叠；360页头服务文案省略，属于可观察截断；长页面有纵向滚动。其它格文字逐项和所有按钮可点击性未穷尽验证。

英文导航/主要按钮/空状态翻译正常；供应商卡片如“OpenAI 兼容端点”等描述仍中文，主题按钮 accessible name 仍“切换浅色模式”。

150%：1440视口按三次 Ctrl++，前后 innerWidth=1440、devicePixelRatio约1、visualViewport.scale=1，快捷键未生效；Ctrl+0恢复。没有用960px视口或截图放大冒充浏览器缩放。150%无法验证。证据：[66-s9-1440-zoom-shortcuts-no-effect-light-en.png](2026-10-23-browser-acceptance/66-s9-1440-zoom-shortcuts-no-effect-light-en.png)。

| 页面 | 宽度 | 主题 | 语言 | 横向溢出 | 文字/重叠/按钮 | 截图 |
|---|---:|---|---|---|---|---|
| conversation | 360 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [17-s9-conversation-360-dark-zh.png](2026-10-23-browser-acceptance/17-s9-conversation-360-dark-zh.png) |
| activity | 360 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [18-s9-activity-360-dark-zh.png](2026-10-23-browser-acceptance/18-s9-activity-360-dark-zh.png) |
| settings | 360 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [19-s9-settings-360-dark-zh.png](2026-10-23-browser-acceptance/19-s9-settings-360-dark-zh.png) |
| provider | 360 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [20-s9-provider-360-dark-zh.png](2026-10-23-browser-acceptance/20-s9-provider-360-dark-zh.png) |
| conversation | 768 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [21-s9-conversation-768-dark-zh.png](2026-10-23-browser-acceptance/21-s9-conversation-768-dark-zh.png) |
| activity | 768 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [22-s9-activity-768-dark-zh.png](2026-10-23-browser-acceptance/22-s9-activity-768-dark-zh.png) |
| settings | 768 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [23-s9-settings-768-dark-zh.png](2026-10-23-browser-acceptance/23-s9-settings-768-dark-zh.png) |
| provider | 768 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [24-s9-provider-768-dark-zh.png](2026-10-23-browser-acceptance/24-s9-provider-768-dark-zh.png) |
| conversation | 1024 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [25-s9-conversation-1024-dark-zh.png](2026-10-23-browser-acceptance/25-s9-conversation-1024-dark-zh.png) |
| activity | 1024 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [26-s9-activity-1024-dark-zh.png](2026-10-23-browser-acceptance/26-s9-activity-1024-dark-zh.png) |
| settings | 1024 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [27-s9-settings-1024-dark-zh.png](2026-10-23-browser-acceptance/27-s9-settings-1024-dark-zh.png) |
| provider | 1024 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [28-s9-provider-1024-dark-zh.png](2026-10-23-browser-acceptance/28-s9-provider-1024-dark-zh.png) |
| conversation | 1440 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [29-s9-conversation-1440-dark-zh.png](2026-10-23-browser-acceptance/29-s9-conversation-1440-dark-zh.png) |
| activity | 1440 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [30-s9-activity-1440-dark-zh.png](2026-10-23-browser-acceptance/30-s9-activity-1440-dark-zh.png) |
| settings | 1440 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [31-s9-settings-1440-dark-zh.png](2026-10-23-browser-acceptance/31-s9-settings-1440-dark-zh.png) |
| provider | 1440 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [32-s9-provider-1440-dark-zh.png](2026-10-23-browser-acceptance/32-s9-provider-1440-dark-zh.png) |
| conversation | 1920 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [33-s9-conversation-1920-dark-zh.png](2026-10-23-browser-acceptance/33-s9-conversation-1920-dark-zh.png) |
| activity | 1920 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [34-s9-activity-1920-dark-zh.png](2026-10-23-browser-acceptance/34-s9-activity-1920-dark-zh.png) |
| settings | 1920 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [35-s9-settings-1920-dark-zh.png](2026-10-23-browser-acceptance/35-s9-settings-1920-dark-zh.png) |
| provider | 1920 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [36-s9-provider-1920-dark-zh.png](2026-10-23-browser-acceptance/36-s9-provider-1920-dark-zh.png) |
| conversation | 360 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [37-s9-conversation-360-light-zh.png](2026-10-23-browser-acceptance/37-s9-conversation-360-light-zh.png) |
| activity | 360 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [38-s9-activity-360-light-zh.png](2026-10-23-browser-acceptance/38-s9-activity-360-light-zh.png) |
| settings | 360 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [39-s9-settings-360-light-zh.png](2026-10-23-browser-acceptance/39-s9-settings-360-light-zh.png) |
| provider | 360 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [40-s9-provider-360-light-zh.png](2026-10-23-browser-acceptance/40-s9-provider-360-light-zh.png) |
| conversation | 768 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [41-s9-conversation-768-light-zh.png](2026-10-23-browser-acceptance/41-s9-conversation-768-light-zh.png) |
| activity | 768 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [42-s9-activity-768-light-zh.png](2026-10-23-browser-acceptance/42-s9-activity-768-light-zh.png) |
| settings | 768 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [43-s9-settings-768-light-zh.png](2026-10-23-browser-acceptance/43-s9-settings-768-light-zh.png) |
| provider | 768 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [44-s9-provider-768-light-zh.png](2026-10-23-browser-acceptance/44-s9-provider-768-light-zh.png) |
| conversation | 1024 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [45-s9-conversation-1024-light-zh.png](2026-10-23-browser-acceptance/45-s9-conversation-1024-light-zh.png) |
| activity | 1024 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [46-s9-activity-1024-light-zh.png](2026-10-23-browser-acceptance/46-s9-activity-1024-light-zh.png) |
| settings | 1024 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [47-s9-settings-1024-light-zh.png](2026-10-23-browser-acceptance/47-s9-settings-1024-light-zh.png) |
| provider | 1024 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [48-s9-provider-1024-light-zh.png](2026-10-23-browser-acceptance/48-s9-provider-1024-light-zh.png) |
| conversation | 1440 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [49-s9-conversation-1440-light-zh.png](2026-10-23-browser-acceptance/49-s9-conversation-1440-light-zh.png) |
| activity | 1440 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [50-s9-activity-1440-light-zh.png](2026-10-23-browser-acceptance/50-s9-activity-1440-light-zh.png) |
| settings | 1440 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [51-s9-settings-1440-light-zh.png](2026-10-23-browser-acceptance/51-s9-settings-1440-light-zh.png) |
| provider | 1440 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [52-s9-provider-1440-light-zh.png](2026-10-23-browser-acceptance/52-s9-provider-1440-light-zh.png) |
| conversation | 1920 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [53-s9-conversation-1920-light-zh.png](2026-10-23-browser-acceptance/53-s9-conversation-1920-light-zh.png) |
| activity | 1920 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [54-s9-activity-1920-light-zh.png](2026-10-23-browser-acceptance/54-s9-activity-1920-light-zh.png) |
| settings | 1920 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [55-s9-settings-1920-light-zh.png](2026-10-23-browser-acceptance/55-s9-settings-1920-light-zh.png) |
| provider | 1920 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [56-s9-provider-1920-light-zh.png](2026-10-23-browser-acceptance/56-s9-provider-1920-light-zh.png) |
| settings | 1440 | dark | en | 无 | 截图存证；未逐按钮穷尽 | [58-s9-settings-1440-dark-en.png](2026-10-23-browser-acceptance/58-s9-settings-1440-dark-en.png) |
| activity | 1440 | dark | en | 无 | 截图存证；未逐按钮穷尽 | [59-s9-activity-1440-dark-en.png](2026-10-23-browser-acceptance/59-s9-activity-1440-dark-en.png) |
| conversation | 1440 | dark | en | 无 | 截图存证；未逐按钮穷尽 | [60-s9-conversation-1440-dark-en.png](2026-10-23-browser-acceptance/60-s9-conversation-1440-dark-en.png) |
| provider | 1440 | dark | en | 无 | 截图存证；未逐按钮穷尽 | [61-s9-provider-1440-dark-en.png](2026-10-23-browser-acceptance/61-s9-provider-1440-dark-en.png) |
| conversation | 1440 | light | en | 无 | 截图存证；未逐按钮穷尽 | [62-s9-conversation-1440-light-en.png](2026-10-23-browser-acceptance/62-s9-conversation-1440-light-en.png) |
| activity | 1440 | light | en | 无 | 截图存证；未逐按钮穷尽 | [63-s9-activity-1440-light-en.png](2026-10-23-browser-acceptance/63-s9-activity-1440-light-en.png) |
| settings | 1440 | light | en | 无 | 截图存证；未逐按钮穷尽 | [64-s9-settings-1440-light-en.png](2026-10-23-browser-acceptance/64-s9-settings-1440-light-en.png) |
| provider | 1440 | light | en | 无 | 截图存证；未逐按钮穷尽 | [65-s9-provider-1440-light-en.png](2026-10-23-browser-acceptance/65-s9-provider-1440-light-en.png) |

## Mock 收尾与边界

Web build --emptyOutDir false exit 0（存在大chunk提示）；HEAD / 返回200与text/html。未跑test:all、未改产品源码/测试/配置、未commit/push。首轮服务已Ctrl+C停止，Get-NetTCPConnection确认5678无LISTEN。主题恢复深色、语言恢复中文、视口override已reset。截图69张。浏览器warn/error捕获为空（只证明工具捕获范围，不证明所有网络无错）。

provider/usage/session/settings/daemon/reviews根通过进程环境指向夹具；应用仍列出既有项目和旧Activity记录，不能宣称所有全局状态完全隔离。它们仅只读观察。三个夹具会话保留，删除失败的会话也保留。

审计期间出现未跟踪 scripts/use-env.ps1（本轮未创建/编辑），保留；git diff --stat为空，HEAD仍34730cd。环境准备要求的构建产物与临时夹具是任务明确授权的运行副作用；直接证据写入只在指定截图目录及本报告。


## 真实模型

本节追加于2026-10-22，保留上方 Mock 结论。构建/产品代码未改变，HEAD 34730cd。

环境：同一个IAB、同一报告与截图目录；新夹具 C:\work\AppData\Local\Temp\vessel-audit-real-fe4949f1；端口5678。provider=commandgota-real，protocol=openai-compatible，baseUrl=https://api.commandcode.ai/provider/v1，唯一模型=deepseek/deepseek-v4.1-flash。会话=sess_1792666112365_9fa46f04，标题 Reply exactly REAL_OK.。

先按要求 dot-source scripts/use-env.ps1，凭据存在；POST /api/providers 注册成功，随后 POST /api/providers/test 只传name免输直测成功，latencyMs=2653，指定模型在列表中。没有401/403。没有输出token、掩码、前后缀或长度；注册响应没有原样打印。未测试其它模型。

### 结果

| 检查 | 结论 | 浏览器及磁盘证据 |
|---|---|---|
| 普通问答 | 通过 | 发送 Reply exactly REAL_OK. → 实际 REAL_OK；[70-real-ordinary-1440-dark-zh.png](2026-10-23-browser-acceptance/70-real-ordinary-1440-dark-zh.png)；session.jsonl:5、9、12–14 |
| 写小文件/工具链 | 通过（工具执行）；回合后续被Stop | Write audit-note.txt与Read均完成；磁盘内容trim后恰为AUDIT_TOOL_OK；[72-real-stopped-tools-1440-dark-zh.png](2026-10-23-browser-acceptance/72-real-stopped-tools-1440-dark-zh.png)；session.jsonl:34–35、43–44 |
| 长输出至length | 通过（真实触发） | 最终输出4096 tokens/14438字符；session.jsonl:73、75、76明确finishReason=length；页面显示“内容达到模型长度上限，可继续生成。”，输入仍可用；[77-real-finishreason-length-1440-dark-zh.png](2026-10-23-browser-acceptance/77-real-finishreason-length-1440-dark-zh.png) |
| 中途Stop | 通过（实际停止），Activity文案有差异 | 点击Stop后出现“[已中断]”，turn/end.kind=interrupted，run/state=CANCELLED；Activity归入“失败”，没有假报已完成；[72-real-stopped-tools-1440-dark-zh.png](2026-10-23-browser-acceptance/72-real-stopped-tools-1440-dark-zh.png) / [73-real-cancelled-shown-failed-1440-dark-zh.png](2026-10-23-browser-acceptance/73-real-cancelled-shown-failed-1440-dark-zh.png)；session.jsonl:49–50 |
| 刷新保史 | 部分通过/缺陷 | REAL_OK、工具记录与长正文重现；长度提示消失，取消标记也未恢复；[78-real-refresh-history-1440-dark-zh.png](2026-10-23-browser-acceptance/78-real-refresh-history-1440-dark-zh.png)；session.jsonl:49–50、73、76 |
| 删除自建会话 | 不通过 | 删除→确认→“无法移入回收站；会话索引已恢复，可重试。”；刷新打开导航仍存在；[80-real-delete-result-1440-dark-zh.png](2026-10-23-browser-acceptance/80-real-delete-result-1440-dark-zh.png) / [81-real-delete-failed-after-refresh-dark-zh.png](2026-10-23-browser-acceptance/81-real-delete-failed-after-refresh-dark-zh.png) |

### 调用预算与过程

4次用户提交，实际模型传输尝试共10次（以该会话 model-delegations.jsonl 的10行计，包括自动重试与工具续轮；不是只算UI用量的成功次数）。模型目录连通性探针是GET models，不是生成调用。

1. 普通回复：1次模型请求，成功。
2. 文件工具回合：累计到8次。session.jsonl:23、25、27、29记录4次NETWORK重试；随后Write和Read成功，Stop结束后续调用。不是401/403后的循环重试。
3. 数字长输出：第9次请求，模型以说明性内容自行结束，session.jsonl:59–64，没有length，不能算通过截断验收。
4. 6000词故事短提示：第10次请求，真实命中4096 token上限，session.jsonl:75–77。监控进程在出现后续重试前发interrupt，或终态后退出；本次无需预算中断，最终10次、无第11次。未点“继续生成”。

Activity在长请求运行期间观察到“运行中·1”，[74-real-length-activity-running-1440-dark-zh.png](2026-10-23-browser-acceptance/74-real-length-activity-running-1440-dark-zh.png)。完整终态为turn/end.kind=error、finishReason=length，以及run/state=FAILED；这与会话页友好的长度提示并存，不能把它写成普通成功完成。

### 缺陷与最小复现

#### R1 刷新丢失终止原因提示

- 最小步骤：同一真实模型会话触发length → 观察长度提示 → reload → 打开原会话。
- 期望：正文和截断原因同时恢复，避免把不完整正文当成完整回复。
- 实际：正文恢复，但DOM hasLengthNotice由true变false；取消回合的“[已中断]”也未恢复。
- 日志：[session.jsonl:76](C:/work/AppData/Local/Temp/vessel-audit-real-fe4949f1/.harness/sessions/sess_1792666112365_9fa46f04/session.jsonl:76) 明确finishReason=length；取消证据 [session.jsonl:49](C:/work/AppData/Local/Temp/vessel-audit-real-fe4949f1/.harness/sessions/sess_1792666112365_9fa46f04/session.jsonl:49) 与第50行。不是上游缺少终态。
- 证据：[77-real-finishreason-length-1440-dark-zh.png](2026-10-23-browser-acceptance/77-real-finishreason-length-1440-dark-zh.png) → [78-real-refresh-history-1440-dark-zh.png](2026-10-23-browser-acceptance/78-real-refresh-history-1440-dark-zh.png)。live消息卡片10个、重开后7个；工具动作展示与临时状态卡片口径不同，不把这个数字直接当作三条用户消息丢失。用户提示、普通回复及长正文可观察恢复。

#### R2 删除失败且恢复索引

- 最小步骤：只对本次新建sess_1792666112365_9fa46f04点击删除→确认。
- 期望：目录安全移入回收站，列表删除，刷新不再出现。
- 实际：行内“无法移入回收站；会话索引已恢复，可重试。”，有重试按钮；刷新打开导航仍列出会话。未再次重试，未触碰任何历史会话。
- session.jsonl对应范围：[session.jsonl:76](C:/work/AppData/Local/Temp/vessel-audit-real-fe4949f1/.harness/sessions/sess_1792666112365_9fa46f04/session.jsonl:76)–77是删除前最后终态，删除后文件仍存在且仍77行。**没有删除专属事件行号**，不虚构日志回执；删除失败依据浏览器错误与刷新后的列表。文件被占用曾在独立只读检查中观察到，但本次不将其直接宣布为已证明的回收站根因。
- 证据：[79-real-delete-confirm-1440-dark-zh.png](2026-10-23-browser-acceptance/79-real-delete-confirm-1440-dark-zh.png) / [80-real-delete-result-1440-dark-zh.png](2026-10-23-browser-acceptance/80-real-delete-result-1440-dark-zh.png) / [81-real-delete-failed-after-refresh-dark-zh.png](2026-10-23-browser-acceptance/81-real-delete-failed-after-refresh-dark-zh.png)。

#### R3 取消态在Activity显示为失败（语义差异）

- 最小步骤：真实工具回合运行中点Stop→打开Activity。
- 期望：保留取消/中断语义；至少不能标成已完成。
- 实际：会话页“[已中断]”、日志CANCELLED，但Activity位于“失败·2”并显示“失败 会话 Reply exactly REAL_OK.”，没有独立的取消文字；未观察到单独取消图标。
- 日志：[session.jsonl:49](C:/work/AppData/Local/Temp/vessel-audit-real-fe4949f1/.harness/sessions/sess_1792666112365_9fa46f04/session.jsonl:49)–50。证据：[73-real-cancelled-shown-failed-1440-dark-zh.png](2026-10-23-browser-acceptance/73-real-cancelled-shown-failed-1440-dark-zh.png)。满足“未假报完成”，仍记录文案差异，不把它等同于实际执行失败。

#### R4 工具活动默认未折叠（观察）

- 最小步骤：工具回合执行Write/Read后观察会话。
- 实际：Write/Read卡片直接显示参数JSON；思考卡片有collapsed按钮，但工具卡片没有同类折叠态。若期望工具默认折叠，则本次不满足。
- 日志：[session.jsonl:34](C:/work/AppData/Local/Temp/vessel-audit-real-fe4949f1/.harness/sessions/sess_1792666112365_9fa46f04/session.jsonl:34)–35、43–44；证据：[72-real-stopped-tools-1440-dark-zh.png](2026-10-23-browser-acceptance/72-real-stopped-tools-1440-dark-zh.png)。

### 仍未验证与保留边界

- Stop确实生效，无需再用Mock速度解释；但该次Stop前没有在输入框写新草稿，因此“取消后保留未发送草稿”仍无法验证。最后一次长输出期间输入UNSENT_REAL_DRAFT，正常length终止后保留，不能冒充Stop后的草稿测试。
- 本节没有重复整个视觉矩阵；上方矩阵对应相同构建的Mock页面。150%真实浏览器缩放仍无法验证。
- 本轮未修复产品代码，不宣称上述缺陷已解决；未跑test:all、未commit/push。当前任务继续作为审计交付，没有另开任务。

### 真实模型收尾

服务已Ctrl+C停止，5678无LISTEN；预算监控已退出。夹具、audit-note.txt、会话日志和安全凭据存储保留，便于复核；删除失败的会话保留。真实凭据仅经现有凭据存储处理，providers配置使用secretRef。

收尾对真实夹具内json/jsonl/md/txt/log及本报告扫描token的完整字面值：PLAINTEXT_TOKEN_MATCHES=0，UNREADABLE_FILES=0；只输出布尔/计数，不输出secret。早先活跃日志的独占读检查曾遇文件占用，最终改为共享只读并在停服后复核，未把失败扫描当成功。git check-ignore确认.env.local被忽略。git diff --stat为空；直接产出为本报告和同一目录截图，另有用户提供的未跟踪scripts/use-env.ps1保持原样。
