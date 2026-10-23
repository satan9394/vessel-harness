# Vessel 两波修复交付 — 2026-10-23

## 原报告条目清单（原文，不改写）

来源：2026-10-23-browser-acceptance-report.md。包含“不通过”“无法验证”，并保留部分通过项中的未验证边界及确证缺陷。历史 Mock 无法验证项即使在真实模型部分已有补证，也原样保留。

> L12: | S1 | 部分通过 | hello 与 (mock) default 渲染；空输入发送禁用；首帧可交互时延未测量，不宣称 <500ms | [03-s1-hello-before-refresh-dark-zh.png](2026-10-23-browser-acceptance/03-s1-hello-before-refresh-dark-zh.png) |
> L14: | S3 | 不通过 / 部分无法验证 | 自建会话删除失败并恢复索引；刷新仍存在；未发现该分组的组删除入口 | [05-s3-confirm-own-session-dark-zh.png](2026-10-23-browser-acceptance/05-s3-confirm-own-session-dark-zh.png) / [07-s3-failed-delete-persists-dark-zh.png](2026-10-23-browser-acceptance/07-s3-failed-delete-persists-dark-zh.png) |
> L15: | S4 | 部分通过 | 三个有回复的夹具会话显示已完成；旧无确认记录显示未确认；running→completed 的 Activity 过程及取消态无法验证 | [08-s4-activity-completed-unconfirmed-dark-zh.png](2026-10-23-browser-acceptance/08-s4-activity-completed-unconfirmed-dark-zh.png) |
> L16: | S5 | 无法验证 | Mock 9–21ms 结束，Stop 在点击前已禁用；长任务提示也只返回 (mock) default，无实际取消证据 | [67-s5-long-task-stop-unavailable-light-en.png](2026-10-23-browser-acceptance/67-s5-long-task-stop-unavailable-light-en.png) |
> L17: | S6 | 不通过 | 单行 INPUT 吞掉粘贴换行；Enter 和 Shift+Enter 都发送；请求读 README 也未产生工具事件，工具默认折叠无法验证 | [13-s6-shift-enter-submits-dark-zh.png](2026-10-23-browser-acceptance/13-s6-shift-enter-submits-dark-zh.png) |
> L19: | S8 | 部分存在 | Studio 行为有效快照只读展示策略映射；没有找到独立、完整的当前会话生效 Policy 汇总 | [16-s8-policy-mapping-1440-dark-zh.png](2026-10-23-browser-acceptance/16-s8-policy-mapping-1440-dark-zh.png) |
> L20: | S9 | 部分通过 | 五宽度×双主题×四页面共40格，另8格英文抽查；无文档横向溢出；真实150%缩放无法验证；英文供应商描述及主题无障碍名称仍含中文 | 见下表 |
> L31: 步骤：在同一夹具创建 audit-delete-one、audit-delete-two → 对 audit-delete-one 点删除 → 确认 → 刷新。期望：回收站成功后从列表移除。实际：行内提示“sess_1792665262143_02d24156 : 无法移入回收站；会话索引已恢复，可重试。”，提供重试按钮，刷新仍存在。删除功能本次失败，错误没有伪装成功。删除中禁用态太短，未观察到；没有重试循环。导航中该项目下只有日期分组及逐会话删除按钮，没有可用组删除入口，未对任何历史会话或其它项目执行删除。
> L34: 正常三会话在 Activity 的“已完成·3”中，与已收到回复一致；既有两条缺确认记录标“未确认”，另有既有失败记录，均只读观察。取消尝试：发送后 Stop 短暂可用，但 click 时已 disabled；长请求同样在9ms结束。不能据此证明取消成功、取消状态正确、错误位置或取消后输入保留。
> L37: 步骤一：消息框填入 line one + 换行 + line two，按 Enter。实际用户消息是 line oneline two。步骤二：输入 first，按 Shift+Enter，再输入 second。实际 first 被发送，second 成为新草稿。DOM 确认消息框是 INPUT。期望支持换行；实际两条路径均不支持。读 README 的提示仅获 (mock) default，没有可观察工具调用；不判断工具折叠。
> L40: A=hello，写 AUDIT_DRAFT_A_do_not_send，不发送 → B=audit-delete-two，消息框 value为空 → 回 A，草稿恢复。草稿隔离通过。刷新首屏，DOM activeElement=BODY；通过新建会话入口时焦点仍在导航按钮。首屏自动聚焦不通过。
> L43: 查过 Settings、Studio、Inspector 诊断/认知规则。Settings 是模型表单及视图/语言；Inspector 认知规则是只读反思规则，不等于有效 Policy。Studio“行为有效快照”只读展示 L0–L4、来源、哈希、优先级、执法通道与策略映射，包含 filesystem.protected、shell.deny、filesystem.deny_read 及规则 ID。完整当前会话 Policy 汇总区域：本次查找不存在；已有映射区不应被误报成完全不存在。未编辑候选配置。
> L46: 全部40格记录DOM innerWidth、documentElement.scrollWidth、body.scrollWidth及 main 内越界元素。下表“横向溢出无”仅证明该次渲染DOM几何，不等于每个按钮都实点验证。截图抽查360双主题、768 Activity、1024 Provider、1440 Settings/Conversation及1920 Provider：未见明显重叠；360页头服务文案省略，属于可观察截断；长页面有纵向滚动。其它格文字逐项和所有按钮可点击性未穷尽验证。
> L48: 英文导航/主要按钮/空状态翻译正常；供应商卡片如“OpenAI 兼容端点”等描述仍中文，主题按钮 accessible name 仍“切换浅色模式”。
> L50: 150%：1440视口按三次 Ctrl++，前后 innerWidth=1440、devicePixelRatio约1、visualViewport.scale=1，快捷键未生效；Ctrl+0恢复。没有用960px视口或截图放大冒充浏览器缩放。150%无法验证。证据：[66-s9-1440-zoom-shortcuts-no-effect-light-en.png](2026-10-23-browser-acceptance/66-s9-1440-zoom-shortcuts-no-effect-light-en.png)。
> L54: | conversation | 360 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [17-s9-conversation-360-dark-zh.png](2026-10-23-browser-acceptance/17-s9-conversation-360-dark-zh.png) |
> L55: | activity | 360 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [18-s9-activity-360-dark-zh.png](2026-10-23-browser-acceptance/18-s9-activity-360-dark-zh.png) |
> L56: | settings | 360 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [19-s9-settings-360-dark-zh.png](2026-10-23-browser-acceptance/19-s9-settings-360-dark-zh.png) |
> L57: | provider | 360 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [20-s9-provider-360-dark-zh.png](2026-10-23-browser-acceptance/20-s9-provider-360-dark-zh.png) |
> L58: | conversation | 768 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [21-s9-conversation-768-dark-zh.png](2026-10-23-browser-acceptance/21-s9-conversation-768-dark-zh.png) |
> L59: | activity | 768 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [22-s9-activity-768-dark-zh.png](2026-10-23-browser-acceptance/22-s9-activity-768-dark-zh.png) |
> L60: | settings | 768 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [23-s9-settings-768-dark-zh.png](2026-10-23-browser-acceptance/23-s9-settings-768-dark-zh.png) |
> L61: | provider | 768 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [24-s9-provider-768-dark-zh.png](2026-10-23-browser-acceptance/24-s9-provider-768-dark-zh.png) |
> L62: | conversation | 1024 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [25-s9-conversation-1024-dark-zh.png](2026-10-23-browser-acceptance/25-s9-conversation-1024-dark-zh.png) |
> L63: | activity | 1024 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [26-s9-activity-1024-dark-zh.png](2026-10-23-browser-acceptance/26-s9-activity-1024-dark-zh.png) |
> L64: | settings | 1024 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [27-s9-settings-1024-dark-zh.png](2026-10-23-browser-acceptance/27-s9-settings-1024-dark-zh.png) |
> L65: | provider | 1024 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [28-s9-provider-1024-dark-zh.png](2026-10-23-browser-acceptance/28-s9-provider-1024-dark-zh.png) |
> L66: | conversation | 1440 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [29-s9-conversation-1440-dark-zh.png](2026-10-23-browser-acceptance/29-s9-conversation-1440-dark-zh.png) |
> L67: | activity | 1440 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [30-s9-activity-1440-dark-zh.png](2026-10-23-browser-acceptance/30-s9-activity-1440-dark-zh.png) |
> L68: | settings | 1440 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [31-s9-settings-1440-dark-zh.png](2026-10-23-browser-acceptance/31-s9-settings-1440-dark-zh.png) |
> L69: | provider | 1440 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [32-s9-provider-1440-dark-zh.png](2026-10-23-browser-acceptance/32-s9-provider-1440-dark-zh.png) |
> L70: | conversation | 1920 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [33-s9-conversation-1920-dark-zh.png](2026-10-23-browser-acceptance/33-s9-conversation-1920-dark-zh.png) |
> L71: | activity | 1920 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [34-s9-activity-1920-dark-zh.png](2026-10-23-browser-acceptance/34-s9-activity-1920-dark-zh.png) |
> L72: | settings | 1920 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [35-s9-settings-1920-dark-zh.png](2026-10-23-browser-acceptance/35-s9-settings-1920-dark-zh.png) |
> L73: | provider | 1920 | dark | zh | 无 | 截图存证；未逐按钮穷尽 | [36-s9-provider-1920-dark-zh.png](2026-10-23-browser-acceptance/36-s9-provider-1920-dark-zh.png) |
> L74: | conversation | 360 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [37-s9-conversation-360-light-zh.png](2026-10-23-browser-acceptance/37-s9-conversation-360-light-zh.png) |
> L75: | activity | 360 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [38-s9-activity-360-light-zh.png](2026-10-23-browser-acceptance/38-s9-activity-360-light-zh.png) |
> L76: | settings | 360 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [39-s9-settings-360-light-zh.png](2026-10-23-browser-acceptance/39-s9-settings-360-light-zh.png) |
> L77: | provider | 360 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [40-s9-provider-360-light-zh.png](2026-10-23-browser-acceptance/40-s9-provider-360-light-zh.png) |
> L78: | conversation | 768 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [41-s9-conversation-768-light-zh.png](2026-10-23-browser-acceptance/41-s9-conversation-768-light-zh.png) |
> L79: | activity | 768 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [42-s9-activity-768-light-zh.png](2026-10-23-browser-acceptance/42-s9-activity-768-light-zh.png) |
> L80: | settings | 768 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [43-s9-settings-768-light-zh.png](2026-10-23-browser-acceptance/43-s9-settings-768-light-zh.png) |
> L81: | provider | 768 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [44-s9-provider-768-light-zh.png](2026-10-23-browser-acceptance/44-s9-provider-768-light-zh.png) |
> L82: | conversation | 1024 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [45-s9-conversation-1024-light-zh.png](2026-10-23-browser-acceptance/45-s9-conversation-1024-light-zh.png) |
> L83: | activity | 1024 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [46-s9-activity-1024-light-zh.png](2026-10-23-browser-acceptance/46-s9-activity-1024-light-zh.png) |
> L84: | settings | 1024 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [47-s9-settings-1024-light-zh.png](2026-10-23-browser-acceptance/47-s9-settings-1024-light-zh.png) |
> L85: | provider | 1024 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [48-s9-provider-1024-light-zh.png](2026-10-23-browser-acceptance/48-s9-provider-1024-light-zh.png) |
> L86: | conversation | 1440 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [49-s9-conversation-1440-light-zh.png](2026-10-23-browser-acceptance/49-s9-conversation-1440-light-zh.png) |
> L87: | activity | 1440 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [50-s9-activity-1440-light-zh.png](2026-10-23-browser-acceptance/50-s9-activity-1440-light-zh.png) |
> L88: | settings | 1440 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [51-s9-settings-1440-light-zh.png](2026-10-23-browser-acceptance/51-s9-settings-1440-light-zh.png) |
> L89: | provider | 1440 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [52-s9-provider-1440-light-zh.png](2026-10-23-browser-acceptance/52-s9-provider-1440-light-zh.png) |
> L90: | conversation | 1920 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [53-s9-conversation-1920-light-zh.png](2026-10-23-browser-acceptance/53-s9-conversation-1920-light-zh.png) |
> L91: | activity | 1920 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [54-s9-activity-1920-light-zh.png](2026-10-23-browser-acceptance/54-s9-activity-1920-light-zh.png) |
> L92: | settings | 1920 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [55-s9-settings-1920-light-zh.png](2026-10-23-browser-acceptance/55-s9-settings-1920-light-zh.png) |
> L93: | provider | 1920 | light | zh | 无 | 截图存证；未逐按钮穷尽 | [56-s9-provider-1920-light-zh.png](2026-10-23-browser-acceptance/56-s9-provider-1920-light-zh.png) |
> L94: | settings | 1440 | dark | en | 无 | 截图存证；未逐按钮穷尽 | [58-s9-settings-1440-dark-en.png](2026-10-23-browser-acceptance/58-s9-settings-1440-dark-en.png) |
> L95: | activity | 1440 | dark | en | 无 | 截图存证；未逐按钮穷尽 | [59-s9-activity-1440-dark-en.png](2026-10-23-browser-acceptance/59-s9-activity-1440-dark-en.png) |
> L96: | conversation | 1440 | dark | en | 无 | 截图存证；未逐按钮穷尽 | [60-s9-conversation-1440-dark-en.png](2026-10-23-browser-acceptance/60-s9-conversation-1440-dark-en.png) |
> L97: | provider | 1440 | dark | en | 无 | 截图存证；未逐按钮穷尽 | [61-s9-provider-1440-dark-en.png](2026-10-23-browser-acceptance/61-s9-provider-1440-dark-en.png) |
> L98: | conversation | 1440 | light | en | 无 | 截图存证；未逐按钮穷尽 | [62-s9-conversation-1440-light-en.png](2026-10-23-browser-acceptance/62-s9-conversation-1440-light-en.png) |
> L99: | activity | 1440 | light | en | 无 | 截图存证；未逐按钮穷尽 | [63-s9-activity-1440-light-en.png](2026-10-23-browser-acceptance/63-s9-activity-1440-light-en.png) |
> L100: | settings | 1440 | light | en | 无 | 截图存证；未逐按钮穷尽 | [64-s9-settings-1440-light-en.png](2026-10-23-browser-acceptance/64-s9-settings-1440-light-en.png) |
> L101: | provider | 1440 | light | en | 无 | 截图存证；未逐按钮穷尽 | [65-s9-provider-1440-light-en.png](2026-10-23-browser-acceptance/65-s9-provider-1440-light-en.png) |
> L128: | 刷新保史 | 部分通过/缺陷 | REAL_OK、工具记录与长正文重现；长度提示消失，取消标记也未恢复；[78-real-refresh-history-1440-dark-zh.png](2026-10-23-browser-acceptance/78-real-refresh-history-1440-dark-zh.png)；session.jsonl:49–50、73、76 |
> L129: | 删除自建会话 | 不通过 | 删除→确认→“无法移入回收站；会话索引已恢复，可重试。”；刷新打开导航仍存在；[80-real-delete-result-1440-dark-zh.png](2026-10-23-browser-acceptance/80-real-delete-result-1440-dark-zh.png) / [81-real-delete-failed-after-refresh-dark-zh.png](2026-10-23-browser-acceptance/81-real-delete-failed-after-refresh-dark-zh.png) |
> L148: - 实际：正文恢复，但DOM hasLengthNotice由true变false；取消回合的“[已中断]”也未恢复。
> L164: - 实际：会话页“[已中断]”、日志CANCELLED，但Activity位于“失败·2”并显示“失败 会话 Reply exactly REAL_OK.”，没有独立的取消文字；未观察到单独取消图标。
> L165: - 日志：[session.jsonl:49](C:/Users/Satanchen/AppData/Local/Temp/vessel-audit-real-fe4949f1/.harness/sessions/sess_1792666112365_9fa46f04/session.jsonl:49)–50。证据：[73-real-cancelled-shown-failed-1440-dark-zh.png](2026-10-23-browser-acceptance/73-real-cancelled-shown-failed-1440-dark-zh.png)。满足“未假报完成”，仍记录文案差异，不把它等同于实际执行失败。
> L167: #### R4 工具活动默认未折叠（观察）
> L170: - 实际：Write/Read卡片直接显示参数JSON；思考卡片有collapsed按钮，但工具卡片没有同类折叠态。若期望工具默认折叠，则本次不满足。
> L173: ### 仍未验证与保留边界
> L175: - Stop确实生效，无需再用Mock速度解释；但该次Stop前没有在输入框写新草稿，因此“取消后保留未发送草稿”仍无法验证。最后一次长输出期间输入UNSENT_REAL_DRAFT，正常length终止后保留，不能冒充Stop后的草稿测试。
> L176: - 本节没有重复整个视觉矩阵；上方矩阵对应相同构建的Mock页面。150%真实浏览器缩放仍无法验证。
> L177: - 本轮未修复产品代码，不宣称上述缺陷已解决；未跑test:all、未commit/push。当前任务继续作为审计交付，没有另开任务。


原文清单补充（原报告L25，Mock供应商准备，同样属于无法完成项）：

> Provider Hub 无已配置供应商；搜索 mock 返回“未找到匹配项”，协议仅 OpenAI Compatible / Anthropic，无法创建指定 id/protocol/model 均为 mock 的预设。使用界面明确标注“不连接真实供应商”的内置演示模型执行可行检查，返回 (mock) default；不把它等同于指定 Mock 预设注册成功。证据：[02-mock-search-no-match-zh.png](2026-10-23-browser-acceptance/02-mock-search-no-match-zh.png)。

## 已修并验证

### 第一波 1：删除失败 — 已修并验证

根因：Windows 拒绝回收仍由 Node JSONL writer 打开的目录。Red 探针为关闭文件目录1 passed、打开writer目录1 failed，原日志为 `2026-10-23-delete-native-before.log`。原回收路径在回收成功后才关闭controller，顺序相反。

改动：索引持久移除→关闭controller/writer→原有OS回收。回收失败恢复索引并按原ID重开controller；关闭失败不回收、恢复索引并给专用双语错误。SessionController.close即使其它关闭阶段失败也在finally释放writer/lease；空会话同样可重开。未改回收实现、沙箱或packages/core。

新增/修改测试：

- Windows native recycling / recycles a Unicode and apostrophe path through Windows PowerShell
- Windows native recycling / closes the actual session writer before native recycling（真实关闭前失败、关闭后成功）
- SessionController / releases the writer and lease even if harness shutdown fails
- HTTP / waits for recycling before acknowledging deletion, after durably removing the session index（追加关闭writer断言）
- HTTP / reports recycling failure and retains the session for a successful retry（追加重新运行回合）
- HTTP / restores the session without recycling when controller close fails
- HTTP / reports stale index on failed recycle rollback, retains metadata and repairs on retry
- Web API / preserves deletion diagnostics and maps session_controller_close_failed to bilingual copy

最终门禁：tsc -b=0；typecheck:tests=0；web typecheck=0；vitest run apps/local-server=0（22文件/221 passed，含Windows原生回收）；test:web=0（52文件/433 passed）；web build --emptyOutDir false=0。额外定向3文件/55 passed，exit 0。完整命令/退出码见 [六项门禁](2026-10-23-delete-gates.json)，原始日志为同前缀对应log文件。没有跑test:all。git diff --check=0，packages/core diff为空。

真实模型IAB复验：夹具 `C:\Users\SATANC~1\AppData\Local\Temp\vessel-fix-delete-0344b788`，端口5678，commandgota-real / deepseek/deepseek-v4.1-flash。本轮2次真实请求，用户已明确追加“不设上限”。第一条带DELETE_REAL_OK的提示被模型视为未发生删除的确认而拒绝，没有将其当删除证据；第二条中性2+2提示实际回复4。之后由浏览器删除本次新建 `sess_1792678656725_d9652d27`。

- [真实回复](2026-10-23-browser-acceptance/82-fix-delete-real-before.png)
- [删除确认](2026-10-23-browser-acceptance/83-fix-delete-real-confirm.png)
- [成功移除](2026-10-23-browser-acceptance/84-fix-delete-real-removed.png)
- [刷新后仍消失，另一夹具保留](2026-10-23-browser-acceptance/85-fix-delete-real-after-refresh.png)
- [磁盘/回收站证明](2026-10-23-delete-recycle-proof.json)：原目录消失，Windows回收站存在匹配唯一会话ID的元数据1项；未修改回收站任何条目。
- [脱敏日志行号证明](2026-10-23-delete-real-proof.json)：原session.jsonl共28行，保留模型选择与算术回复行号；实际日志随目录进入回收站。

真实OS回收权限本条已验证。其它条目维持原状态，整体目标继续。

### 第一波 2：多行输入 — 已修并验证

改动：ConversationView使用textarea，Shift+Enter保留原生换行，Enter显式发送且阻止默认重复行为；IME/composition/229仍不提交；发送只对空白校验，不裁剪用户首尾换行。输入随多行增高并有200px上限，中英文占位符明确快捷键。

新增测试 `preserves pasted newlines, leaves Shift+Enter to the textarea, and sends once on Enter`（原实现Red：找不到textarea），含运行中再次按Enter不重复提交、未发送草稿保留的断言；修改 `handles explicit Enter submission while protecting IME` 五分支，原草稿/注意力测试适配textarea。定向2文件/32 passed，exit 0。最后测试修改后的六项指定门禁全部exit 0，server 22文件/221 passed，web 52文件/434 passed：[最终退出码](2026-10-23-multiline-final-gates.json)，原始日志同名前缀。未跑test:all。

真实模型：沿用夹具与指定commandgota-real模型；新会话先回复Hello，再通过原生粘贴输入含首尾换行的内容，按Shift+Enter追加一行，按Enter发送。模型回复OK；输入清空。磁盘session.jsonl恰有1条与完整原始字符串逐字相同的user/message，含前导换行与中间空行：[日志行号/原值证明](2026-10-23-multiline-real-proof.json)。

- [粘贴与Shift+Enter后的多行输入](2026-10-23-browser-acceptance/86-fix-multiline-paste-shift-enter.png)
- [Enter发送后的真实模型回复](2026-10-23-browser-acceptance/87-fix-multiline-real-response.png)

### 第一波 3：刷新恢复终止提示 — 已修并验证

改动：后端sessionMessages从已有turn/end投影消息termination，HTTP历史与SSE快照共用；Web将length/interrupted附在对应assistant消息，无正文时保留空状态消息。后续正常回合不会清除旧原因；去除仅驻内存的lengthLimited横幅。未改core、未新增持久化副本。

新增/修改测试：server `restores %s termination on its message from a closed disk session`（length/interrupted，覆盖HTTP与SSE）；MessageList.termination双语状态测试；ConversationView交互测试覆盖HTTP/SSE先后顺序、缺失正文、会话切换与历史恢复。定向backend 2 passed、web 34 passed。最后代码修改后的六项指定门禁全部exit 0，server 22文件/223 passed，web 53文件/436 passed：[最终门禁](2026-10-23-termination-final-gates.json)。未跑test:all。

真实模型复验3次请求：自建会话sess_1792682051988_c9647438，session.jsonl第12、26行finishReason=length，第36行interrupted/CANCELLED。第三次流式输出中Stop，未发送草稿KEEP_UNSENT_AFTER_STOP仍在；刷新重开后两处长度提示与一处中断提示仍对应各自消息。[日志行号证据](2026-10-23-termination-real-proof.json)。截图：[长度前](2026-10-23-browser-acceptance/88-fix-length-before-refresh.png)、[长度刷新后](2026-10-23-browser-acceptance/89-fix-length-after-refresh.png)、[中断前](2026-10-23-browser-acceptance/90-fix-interrupted-before-refresh.png)、[中断刷新后](2026-10-23-browser-acceptance/91-fix-interrupted-after-refresh.png)。

### 第一波 4：Activity取消/中断语义 — 已修并验证

根因：ActivityRoutes将已知interrupted/cancelled结果折叠成failed。修改后两端ActivityStatus同步扩展，session live/event_log保留原结果；team拒绝/取消、subagent取消、goal取消均单独显示已取消，真实失败仍失败，未知仍未知。Web新增独立分组与中英徽标，沿用中性色。

测试：新增 `distinguishes failure, cancellation and interruption from %s`（live/event_log）；修改team/subagent/goal表驱动断言、HTTP终态表；新增Web `keeps failed, interrupted and cancelled activity in separate groups (%s)`（en/zh）。Red为8 failed；Web定向13 passed。旧未完成回合测试按首项断言会受新排序影响，改按本次ID断言，定向通过。最后编辑后的[六项门禁](2026-10-23-activity-accepted-gates.json)全exit 0，server 22文件/225 passed，web 53文件/438 passed。早期失败日志保留，未跑test:all。

复用真实模型Stop会话sess_1792682051988_c9647438，session.jsonl:36（interrupted/CANCELLED）；重启服务、打开Activity显示独立“已中断·1”，刷新重开仍相同，真失败目标留在失败组。无新增模型请求。[修复后](2026-10-23-browser-acceptance/92-fix-activity-interrupted-zh.png)、[刷新后](2026-10-23-browser-acceptance/93-fix-activity-interrupted-after-refresh.png)。本条仅覆盖已知终态分类，ARCH-01其它生命周期差距留第二波核实。

### 第一波 5：首屏输入焦点 — 已修并验证

启动器textarea添加autoFocus；会话输入改由ref在历史快照就绪后聚焦，记录等待前焦点，仅在用户未转移焦点时接管，修复导航抽屉自动回位后仍无法直接输入。无轮询、未改core。

测试：`focuses only an unclaimed input after async history becomes ready (other control focused=%s)`两分支，验证加载中不聚焦、就绪聚焦、等待中主动选择其它按钮不抢焦点、后续render不重复；启动器SSR断言autoFocus。Red 3 failed；定向2文件/24 passed。[最后编辑后的六项门禁](2026-10-23-focus-accepted-gates.json)全exit 0，server 225 passed，web 440 passed。未跑test:all。

IAB刷新进入启动器，AX焦点为taskInput，直接typeText(null)写入FOCUS_LAUNCHER_PROOF；打开本次真实模型历史会话，快照就绪后AX焦点为会话textarea，直接写入FOCUS_HISTORY_PROOF。均未点击/定位输入框，未发出模型请求，随后清除本次测试草稿。[启动器](2026-10-23-browser-acceptance/94-fix-launcher-focus.png)、[历史会话](2026-10-23-browser-acceptance/95-fix-history-focus.png)。

### 第一波 6：Mock预设与协议 — 已修并验证

根因：Web目录快照排除了application已有mock模板，模型选择器也显式过滤Mock。恢复目录完整同步；Mock卡片/下拉可选择，显示只读内置协议与离线使用说明，隐藏URL/key/保存/探测操作；内置保留名不可注册不变。任务模型选择器显式提供Mock，仍优先已有真实模型，未把Mock连接状态伪装成online。可编辑协议仍为openai-compatible/anthropic，与后端严格校验一致。

测试：目录全量parity含Mock；`selects the built-in Mock preset without credential fields or registration`；`can explicitly start with the built-in Mock while real models are configured`；`finds and explicitly chooses the offline Mock model`；`finds and selects the built-in offline Mock preset`；后端 `keeps Mock built in and rejects configurable Mock protocol without network probing`。Red 3 failed，定向4文件/42 passed。[最后编辑后六项门禁](2026-10-23-mock-accepted-gates.json)全exit 0，server 226 passed、web 444 passed；未跑test:all。

IAB搜索mock后选择只读预设；回任务启动器选择本次系统临时夹具、显式选择Mock，新建sess_1792684077121_3483b2b0，返回(mock) mock。session.jsonl第5行唯一需求、第9行回复、第12行success：[日志证明](2026-10-23-mock-preset-proof.json)。截图：[预设](2026-10-23-browser-acceptance/96-fix-mock-preset-visible.png)、[显式选择](2026-10-23-browser-acceptance/97-fix-mock-model-selected.png)、[运行回复](2026-10-23-browser-acceptance/98-fix-mock-model-response.png)。本条是离线预设功能验证，不替代真实模型回归，未新增真实请求。

### 第一波 7：英文残留 — 已修并验证

新增仅用于显示的完整英文预设名称/描述映射，Gallery、预设下拉及onboarding复用；保留与application目录的端点/模型/认证元数据完全一致。主题按钮aria-label/title接入双语字典，已保存凭据占位符同时国际化。无配置迁移或新依赖。

测试：`localizes every English name and description without changing connection metadata`全目录CJK负向检查及中文保留；`renders English display names and descriptions across the catalog`；`localizes the accessible theme action (%s/%s)`中英×深浅四分支。Red 2 failed；定向4文件/39 passed。[最后修改后六项门禁](2026-10-23-english-final-gates.json)全exit 0，server 226 passed、web 450 passed。未跑test:all；React技能复核未引入hooks条件分支、新网络请求或依赖。

IAB切英文，Lark卡片名称/描述正确；主题按钮DOM aria-label/title均为Switch to light theme，切浅色后两者均为Switch to dark theme。随后恢复原中文/深色偏好。[英文预设](2026-10-23-browser-acceptance/99-fix-provider-english.png)、[深色主题动作](2026-10-23-browser-acceptance/100-fix-theme-english-dark.png)、[浅色主题动作](2026-10-23-browser-acceptance/101-fix-theme-english-light.png)。无新增模型请求。

### 第二波 UI-03：导航与工作区草稿 — 已修并验证

分类：部分实现。复核旧卡238和当前源码，Rail已移除，Sidebar保留项目/最近会话/搜索/创建/四区/主题，命令面板保留项目与会话检索、四区及高级权限入口；LanguageSwitcher位于偏好与设置；窄屏抽屉保留inert、Tab循环、Escape回位。卡265已补首次焦点，Conversation按会话恢复草稿已有回归。真正缺口为TaskComposer单一task状态随selectedRoot切换沿用、导航卸载丢失，未重写已有导航。

改动：TaskComposer草稿按API client/工作区保存在页内WeakMap，选工作区派生当前文本，成功创建仅清空当前草稿；失败保留。不会写磁盘/localStorage，刷新后的草稿持久化不在此契约内。权限和真实模型默认选择保持。

测试：`isolates workspace drafts, restores them after navigation and separates API clients`；`clears only the submitted workspace draft after successful creation`；`preserves the current workspace draft when creation fails`。Red 3 failed；定向2文件/19 passed。[六项最终门禁](2026-10-23-ui03-final-gates.json)全部exit 0，server 226 passed、web 453 passed。未跑test:all。

IAB夹具A沿用vessel-fix-delete-0344b788，夹具B新建于系统临时根vessel-ui03-6951f134：A写Reply exactly DRAFT_A_OK.，切B为空；B写Reply exactly DRAFT_B_OK.，切A恢复A；指定真实模型仅发送A并回复DRAFT_A_OK。新会话sess_1792694672837_c9697e87的session.jsonl第5行唯一user需求、第9行回复、第12行success，B字符串出现0次：[日志证明](2026-10-23-ui03-real-proof.json)。返回启动器A空、B草稿仍在；最后清除本次未发送B验证草稿。截图：[B为空](2026-10-23-browser-acceptance/102-ui03-workspace-b-empty.png)、[A恢复](2026-10-23-browser-acceptance/103-ui03-workspace-a-restored.png)、[真实回复](2026-10-23-browser-acceptance/104-ui03-real-a-response.png)、[B保留](2026-10-23-browser-acceptance/105-ui03-workspace-b-draft-retained.png)。本条新增真实模型请求1次，未触及用户会话。

### 第二波 UI-07：当前生效Policy只读汇总 — 已修并验证

分类：部分实现。旧卡242已分清候选验证/未激活，BehaviorInspection已有行为层级；缺少当前生效Policy独立汇总与加载时来源。保留原Composer及行为检查，新增独立EffectivePolicyPanel。

改动：shared增加可选PolicySource与只读快照DTO；PolicyLoader在读取实际编译字节时记录system/project来源及SHA-256，记录真实session覆盖；application追加实际插件规则来源，SessionController副本深拷贝来源。新增GET /api/sessions/:id/policy，沿用会话恢复机制，从实际PolicyArtifacts白名单投影，快照不重读磁盘，不含matcher/命令/凭据。写请求405、跨源403、无会话404。Web分别展示服务权限/审批、运行规则、工具拦截、文件守卫、软性引导条数、未执法声明及原因；只允许刷新，不提供修改/激活。来源缺失明确未知，读取失败有原因与重试提示；切会话不会展示旧结果。

测试：`reads the bound policy and source hashes without activating candidates or rereading changed files`（真实controller，源文件改变/拒绝候选/修改副本均不改快照、405/403/404）；`captures system, project and applied session sources from the exact compiled bytes`；插件集成追加来源断言；Web双语hard/advisory/unenforced、无来源/失败、无会话/加载、GET编码与晚到响应丢弃测试。Red为只读端点404；定向backend/scopes/network 37 passed、application/provenance 11 passed、Web 19 passed。最后代码修改后的[六项门禁](2026-10-23-ui07-final-gates.json)全exit 0，server 23文件/227 passed，web 54文件/459 passed。未跑test:all。

IAB复用真实模型会话sess_1792694672837_c9697e87，无新增模型请求；新服务恢复该会话后API与DOM快照哈希一致，当前workspace-write/system+session来源、16条运行规则、1条未执法网络声明。面板唯一button为刷新。截图：[只读汇总](2026-10-23-browser-acceptance/106-ui07-effective-policy-zh.png)、[加载时来源](2026-10-23-browser-acceptance/107-ui07-policy-sources-zh.png)、[未执法原因](2026-10-23-browser-acceptance/108-ui07-policy-unenforced-zh.png)；[API证明](2026-10-23-ui07-real-session-proof.json)。该快照描述当前运行实例，服务重启恢复会话会重新绑定当时实际配置，不冒充原始历史策略。

兼容/回滚：sources为可选增量字段，原Policy编译和执法语义不变；没有持久化格式迁移。回滚仅撤卡269差异，保留前序卡成果。没有改core或弱化沙箱。

### 第二波 UI-09：工具细节、Stop与真实滚动 — 已修并验证

分类：部分实现。卡246已有IME、底部守卫/回到底部和重连清错；262/263已补多行和终止历史。实际缺口为参数默认展开、工具错误只有状态、历史参数丢失、全折叠可藏错误、Stop吞错/无请求防重。真实工具密集场景还复现每次调用额外打印空助手摘要；窄屏flex:auto让消息区随内容长大，旧滚动单测没有证明真实容器在滚动。

改动：ToolActivityRow参数置于原生details，错误原因留在折叠区外且role=alert；MessageList错误/拒绝卡片不受全折叠隐藏。HTTP/SSE恢复保留argsSummary/errorDetail与DENIED分类，live工具事件同口径；after_model只发送真实阶段正文，不重复工具名助手卡。Stop请求中禁用并防同步重复，失败双语说明“未确认中断”且可重试；实际busy/草稿不改，完成/新回合/换会话后旧Stop响应不污染当前状态。布局去掉窄屏wrapper按内容撑高，dual-surface使用固定flex basis和可用最小高度，附加面板仍可从外层滚动访问，消息区独立滚动，无删除功能。

测试：`folds tool parameters by default while showing failure reasons outside the disclosure`；`keeps %s tool cards visible after a fold command or terminal update`；`reports Stop failures, blocks duplicate Stop requests and retains the active draft for retry`；`ignores a late Stop failure after %s`（换会话/新回合）；server `preserves tool arguments and %s reason in HTTP, hydrated and live SSE`（TOOL_FAILURE/DENIED，含真实阶段正文去重）。Red 2 failed；定向Web 39 passed，backend 2 passed。初次Web类型门禁发现测试Promise resolve类型过宽，已改为TurnResult，保留原日志。最后CSS修改后的[六项门禁](2026-10-23-ui09-accepted3-gates.json)全exit 0，server 23文件/229 passed、Web 54文件/465 passed。未跑test:all。

真实模型：首次21 Read尝试在第3个工具被已有无物理变更守卫正常中断（sess_1792696362049_6f1a51ad，session.jsonl:19 audit/stagnation_break，21 interrupted），符合EVENT-SPEC既有三步约定，不把21个发起调用当21次执行。保留守卫、沙箱和权限，改用21个实际写入文件的正常任务验证密度。

主会话sess_1792696634029_23f3e3c8：主批次实际22工具调用，21个out01–out21内容逐项正确，missing.txt失败原因在session.jsonl:82、主回合success在90；后续两次短写入回合用于最新实时去重和滚动复验，success在113/136，累计24工具。默认24个details均未打开、错误1条保留、工具名空助手卡0；详情可展开读原参数，刷新后仍相同。[日志/数值证明](2026-10-23-ui09-real-proof.json)。

真实滚动：修前消息区clientHeight=scrollHeight=2217（并未内部滚动）；修后clientHeight=158、scrollHeight=2623。运行中新回合手动点回首条历史，完成后scrollTop仍为71.43701934814453；回到底部按钮出现，点击动画结束后距底部约0、按钮消失，消息区与composer不重叠。不能用旧合成滚动测试冒充这项浏览器证据。

当前Stop新实现也在该真实模型会话中验证：长输出运行中Stop，session.jsonl:145请求头、146 RUNNING、147 interrupted、148 CANCELLED；UI09_KEEP_DRAFT仍在，随后清除本次测试草稿。Stop失败/晚到响应由可重复定向故障测试验证，没有伪造真实网络故障。

截图：[密集工具及错误](2026-10-23-browser-acceptance/109-ui09-dense-tools-error-visible.png)、[详情展开](2026-10-23-browser-acceptance/110-ui09-tool-details-expanded.png)、[历史滚动保留](2026-10-23-browser-acceptance/111-ui09-live-history-scroll-preserved.png)、[有界布局与输入器](2026-10-23-browser-acceptance/112-ui09-bounded-transcript-composer.png)、[刷新错误](2026-10-23-browser-acceptance/113-ui09-refreshed-error-and-tools.png)、[真实Stop草稿](2026-10-23-browser-acceptance/114-ui09-real-stop-draft-preserved.png)。本条新增5个真实执行回合；主会话记录7条已完成model/usage与1次中途取消请求，另只读探针1条model/usage。未动用户工作区或用户会话。

### 第二波 ARCH-06：会话事件回放与断线恢复 — 已修并验证

分类：部分实现。已有原生/Bearer重连、首次hydrate、会话代际守卫，但缺cursor/identity/去重，缓存会话重连不读权威历史。新增单生产者会话hub（512帧/2MiB），version/session/epoch/cursor/eventId/可用turnId；Last-Event-ID或cursor查询补帧，再发送权威checkpoint，过期/异epoch直接重建。完整hydrate包含消息/工具/usage/当前审批/运行态/Inspector；纯观察者仅收元数据，不泄露历史用户正文。断开观察者不停止生产，关闭/删除会话才释放。客户端丢重复、拒跨会话，缺口/水位异常从已确认cursor续传；原生临时503受控重试，Bearer保留Last-Event-ID且401/403不重试；权威快照替换缓存、保留草稿、恢复真实busy，避免HTTP迟到补出重复终止消息。事件规范已同步。

新增/修改测试：`replays a disconnected session cursor and checkpoints messages, usage and resolved approvals without cross-session frames`；`keeps one immutable ordered frame for multiple observers and resumes after 30 seconds offline`；`falls back to the authoritative checkpoint for evicted, future and foreign epoch cursors`；`deduplicates two copies, resumes a dropped or reordered frame, rejects foreign sessions and ignores obsolete transports`；`detects a lost final frame from a heartbeat watermark and accepts a new epoch checkpoint`；`resumes the Bearer transport with Last-Event-ID after 30 seconds and stops after auth rejection`；`recreates native transports through temporary HTTP failures for 30 seconds and cancels retries on close`；`reconciles authoritative tools, usage and resolved approval after disconnect without losing draft or duplicating HTTP completion`；`restores active runs and isolates late recovery across three rapid session switches`。Red保留arch06-before.log。最后产品/测试改动后的[六项门禁](2026-10-23-arch06-accepted2-gates.json)全exit0，server24文件/232 passed、web55文件/471 passed；未跑test:all。

真实测试发现并修复两项协议缺陷：①切断SSE并连续返回503达30秒，原生EventSource第一次503后永久关闭，服务端已success而UI停留运行中；JSONL:169为该回合success，[断线草稿截图](2026-10-23-browser-acceptance/115-arch06-disconnected-draft.png)。补原生受控重连。②运行中12次顺序写入期间断线，重连先收到高于已确认cursor的心跳，来不及消费回放就再次重连；期望先回放/checkpoint，实际大量立即重连，[水位失败证明](2026-10-23-arch06-watermark-before.json)，该回合JSONL:323 success。移除连接首个前置心跳，新增首帧transcript断言，保留15秒正常水位。

最终真实回合仍为commandgota-real/deepseek/deepseek-v4.1-flash，同一系统临时夹具会话sess_1792696634029_23f3e3c8。8次顺序Write另加真实Read校验；JSONL:329 turn/start、418 success，arch06/final.txt实读step08。确认active=true时切断SSE，连续503阻断30,002ms（29次失败连接），恢复后一次成功续传cursor45，没有即时重连循环。界面恢复发送/禁用Stop、无连接错误、草稿ARCH06_FINAL_DRAFT保留；48个工具（含原有24个）、1个原有错误、35次usage，255200输入/4879输出/244992缓存读取与服务端一致，需求只出现一次。[服务端和代理证明](2026-10-23-arch06-real-proof.json)、[UI证明](2026-10-23-arch06-ui-proof.json)。

快速切到另外两个自建会话再返回，草稿/48工具/35调用保持、无DRAFT_A_OK串入；主动清除本次草稿后刷新并打开原会话，仍相同计费/48工具/1错误/唯一需求，无无限转圈。[切换证明](2026-10-23-arch06-switch-proof.json)、[刷新证明](2026-10-23-arch06-refresh-proof.json)。截图共用目录：[修后断线](2026-10-23-browser-acceptance/116-arch06-retry-disconnected.png)、[自动恢复草稿](2026-10-23-browser-acceptance/117-arch06-recovered-draft.png)、[最终运行态恢复](2026-10-23-browser-acceptance/118-arch06-active-recovered.png)、[刷新历史](2026-10-23-browser-acceptance/119-arch06-refreshed-history.png)。本条新增4个真实执行回合；审批断线决策通过真实controller/WidgetRoutes集成及UI快照故障测试验证，没有冒充额外真实模型审批场景。

边界：有界窗口是运行实例内存，不冒充持久流日志；进程重启后消息/工具/usage由session日志重建，推理/运行时审批组件不承诺跨进程恢复；全局子代理通知不宣称会话归属保证。原生Browser通过故障代理实测，Bearer故障由可重复流测试验证。未改core或弱化沙箱。

### 第二波 ARCH-01：运行结果证据与取消态剩余 — 已修并验证

分类：部分实现。258已消除team/subagent假完成，264已独立展示cancelled/interrupted/failed，未重写这两项。新增确认的缺口：服务重启后未打开会话没有controller，Activity从registry索引取不到终态；同一真实Stop会话JSONL:36 interrupted，API却unknown/inferred，见[修前冷读](2026-10-23-arch01-cold-before.json)。另有旧成功之后的新turn/start，无终态时原投影直接推断interrupted，缺少权威结束证据。

改动：application共享只读RunObservation供实时日志与SessionRegistry流式历史使用。Session身份与最新runId分开，附observedAt/revision/reasonCode；读取不会加载模型、取得writer租约或改日志。success为completed；error/failure/budget为failed；interrupted/cancelled保留；新start缺终态、身份不匹配、陌生kind或日志缺失/不可读为unknown。实际running/审批优先，实际恢复器生成的interrupted终态仍有效。Web兼容可选字段；HTTP尚未返回时，SSE结束也恢复length/中断标记且幂等，终态后迟到Stop失败不污染已确认状态；HTTP断网仅报告连接问题、不通知执行失败，并保留用户新草稿。

测试：`preserves cold %s run evidence without restoring a controller or rewriting the log`六分支；`does not reuse an older success after a newer unfinished turn`改为unknown；`projects the eight-state contract: %s with separate session/run identity`八分支；`observes terminal %s as %s`七分支；`keeps empty sessions queued, unfinished runs unknown and recovered interrupted events authoritative`；`reads streamed archive run evidence after a registry restart without a writer lease or data mutation`；`keeps unavailable history unknown even if a previous success was streamed before the read failed`；`restores a %s terminal marker when recovery finishes before the HTTP response is available`两分支；`preserves a newer draft and does not announce execution failure when the HTTP connection drops`；`ignores a late Stop failure after an authoritative stream terminal while HTTP is pending`。Red冷读/孤立start共7 failed保留arch01-before.log；定向application/Activity三文件68 passed，最后Web恢复/网络/Stop两文件43 passed。最后源码/测试改动后的[六项门禁](2026-10-23-arch01-accepted4-gates.json)全exit0，server24文件/246 passed、Web55文件/475 passed；未跑test:all。过程中的ES2023 findLastIndex不受Web目标库支持，已改为现有风格循环，未扩大lib或依赖，失败日志保留。

真实证据：重启5678服务后，在打开原会话前GET Activity，sess_1792682051988_c9647438为interrupted/event_log，runId=turn_1792682304473_38e8f7、revision37、reasonCode=turn_interrupted；该真实Stop的session.jsonl:36为权威interrupted、第37行CANCELLED。另有真实成功会话sess_1792694672837_c9697e87仍completed/event_log，未把所有冷会话都降级。[修后冷读](2026-10-23-arch01-cold-after.json)。IAB Activity点击刷新、整页reload后仍显示“已中断”；日志前后SHA256完全相同，[只读/刷新证明](2026-10-23-arch01-real-proof.json)。本项没有新增真实生成调用。

截图：[冷启动中断分组](2026-10-23-browser-acceptance/121-arch01-stop-group.png)、[整页刷新后](2026-10-23-browser-acceptance/122-arch01-refreshed-stop-group.png)、[最终构建直连5678](2026-10-23-browser-acceptance/123-final-direct-activity.png)。HTTP断网与Stop晚到响应由确定性故障测试覆盖；不冒充新增真实模型断网实验。兼容性为可选字段增量，无日志迁移、无core改动。冷Activity对当前最多500条未加载会话流式读历史，未新增缓存；极大历史的延迟没有另做性能基准。

## 已改未验证

（以下状态不包含上方已验证条目。）

无。第一波7项及第二波5项均已修并验证。

## 未开始

第一波：无，七项均已修并验证。

第二波：无。

## 独立的无法验证项

150%真实浏览器缩放：原IAB三次Ctrl++未改变innerWidth/DPR/visualViewport.scale，当前可用视口/页面缩放接口不能证明真实浏览器150%，保留无法验证，不以960px视口或截图放大替代。

首帧可交互<500ms：原报告未做性能计时；本轮为功能修复，没有补做性能基准，仍无该时延结论。原视觉矩阵的逐格全部按钮/文字/语言穷尽验证也未重跑，不能把定向功能截图升级成完整视觉验收。

组删除入口原报告未找到，本轮只修复明示的逐会话安全删除，没有新增组删除功能。真实OS回收权限已由第一波1原生回收及IAB成功删除补证；工具默认折叠、真实Stop、草稿与Policy等原Mock能力边界已在对应修复条目补证。原报告其余观察保留原样，74行摘录与原文逐行核对无差异。

## 当前接续点

第一波1–7、第二波UI-03/UI-07/UI-09/ARCH-06/ARCH-01共12项已完成本地修复与验证，交协调者验收；没有遗留半截实现。本轮不执行协调者负责的test:all。

当前修复真实执行回合累计17个（前序13个、ARCH-06新增4个，ARCH-01复用真实Stop历史），指定模型未变；[请求模型身份](2026-10-23-real-model-identity.json)仅deepseek/deepseek-v4.1-flash。用户已授权后续不设调用上限，不把回合数等同含重试的上游HTTP次数。验证服务5678（exec53059）保留供复核，沿用系统临时隔离夹具；故障代理5679已Ctrl+C关闭。IAB浏览器2/tab1为直连最终构建的Activity验收页，已标交付；测试草稿已清。凭据安全存储保留，未改用户会话。原验收报告保持原样。

本次完整条目边界复核：[最终边界](2026-10-23-final-boundaries.json)记录git diff --check=0、packages/core及依赖文件差异为空；[各条门禁复核](2026-10-23-requirements-gate-audit.json)覆盖12项各6门均0，[原清单逐行复核](2026-10-23-original-list-audit.json)为74行零差异。从用户脚本加载凭据，仅在内存比较当前存在的仓库及夹具文本，明文匹配0；详细文件数/不可读及缺失夹具根见[最终扫描](2026-10-23-final-secret-scan.json)，不输出凭据本身。没有commit/push、test:all、用户数据删除或外部Agent CLI调用。两波指定修复已交证，不把上方独立的无法验证项宣布通过，也不将本轮扩称两份规范全部其它章节已验收。
