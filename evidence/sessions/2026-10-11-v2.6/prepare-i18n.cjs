const fs=require('fs');const pairs=`
New Session|新建会话
New session permission (current session unchanged)|新会话权限（不影响当前会话）
Read-only|只读探索权限
Workspace write|工作区读写权限
workspaceRoot|工作区路径
/path/to/project|输入项目的绝对路径
新建会话|新建会话
取消|取消
取消|取消
发送一条消息开始对话。实时增量将通过 SSE 显示在这里。|发送一条消息开始对话，实时响应将在这里显示。
思考中…|思考推演中…
KV Cache economics|缓存效益
Billed cache hit rate|计费缓存命中率
cached /|缓存词元／
prompt tokens ·|输入词元 ·
created|新建缓存词元
Estimated savings $|预计节省费用 $ 
Observed billed cache hit rate history|计费缓存命中率历史
Last|最近
observed model calls in this session.|次会话内模型调用。
Workspace fingerprint|工作区指纹
tracked files ·|个受跟踪文件 ·
uncommitted diff bytes|字节未提交差异
Prompt prefix segments|提示词前缀分段
Stable ·|稳定段 ·
Scoped ·|作用域段 ·
Volatile ·|易变段 ·
bytes|字节
Prefix SHA-256|前缀校验值
No cache usage observed in this session.|本会话暂无缓存用量记录。
No workspace fingerprint observed.|暂无工作区指纹记录。
No prompt prefix segments observed.|暂无提示词前缀分段记录。
AST symbol dependencies|语法符号依赖
AST impact radar|代码影响范围
Observed impact reports for this session.|本会话的代码影响报告。
No AST impact reports observed.|暂无代码影响报告。
Patch workbench|代码补丁审阅
Review text changes one hunk at a time. Revert safely removes a selected applied hunk; reapply restores it.|逐块审阅代码修改。回退可安全撤回已采纳的代码块，重新应用可恢复该块。
No patch proposals observed in this session.|本会话暂无补丁提案。
Toggle Inspector (Ctrl/Cmd+I)|切换画布检视器（Ctrl/Cmd+I）
Session Inspector|会话检视器
Inspector|画布检视器
Close Inspector|关闭检视器
Inspector panels|检视器面板
Interactive patch picker|交互式补丁审阅
Unified view|统一视图
Side-by-side view|并排视图
Accept hunk|采纳此块
Discard hunk|放弃修改
Revert hunk|回退此块
Reapply hunk|重新应用此块
Side-by-side patch|并排补丁
Unified patch|统一补丁
Diff inspector|差异检视器
Collapse diff|收起差异
Unified diff|统一差异
Old line, new line, patch|原行号、新行号与补丁
Matched cognitive rules|命中的认知规则
Rule|规则
Reflection:|反思建议：
Historical guidance; current policy takes precedence.|历史经验仅供参考，以当前策略为准。
Commands|命令
Commands (Ctrl/Cmd+K)|命令（Ctrl/Cmd+K）
Keyboard shortcuts|键盘快捷键
Search commands and sessions|搜索命令与会话
Ctrl/Cmd+K: commands · J/K or ↑/↓: messages · Esc: exit message focus · Space: fold card · Enter: focus approval choices · ?: this guide|Ctrl/Cmd+K：打开命令面板 · J/K 或 ↑/↓：选择消息 · Esc：退出消息焦点 · 空格：折叠卡片 · 回车：选择审批选项 · ?：快捷键帮助
Matching commands|匹配的命令
No matching commands.|没有匹配的命令。
Close|关闭
Attention settings|提醒设置
Mute cues|关闭提示音
Unmute cues|开启提示音
Enable notifications|开启桌面通知
Desktop notifications for background or unfocused tasks. Completion cues require five seconds.|后台或未聚焦任务可发送桌面通知。运行超过五秒才触发完成提醒。
model mode|模型模式
resolved actual model|实际使用的模型
resolve the actual model for this mode|确定当前模式使用的模型
Resolve|确定模型
Pinned · Unpin|已固定 · 取消固定
Pin for this session|为本会话固定模型
unpin — the next auto resolution re-judges|取消固定，下次自动选择时将重新判断
pin this resolution for the session (no automatic re-judge)|为本会话固定当前模型，停止自动重新判断
session|会话
Team|协作团队
Goals|目标任务
Changed Files|变更文件
Cost|费用
Tool Activity|工具活动
Task queue|任务队列
task|任务
tasks|任务
Terminal tasks can't be run — requeue them first (runtime).|已结束的任务无法直接运行，请先重新加入队列。
No tasks yet|暂无任务
Enqueue a goal and run it — each iteration shows the generator output and the evaluator verdict.|添加目标并运行，每次迭代都会显示生成结果与评估结论。
Iterations|迭代记录
No iterations yet|暂无迭代记录
Run this task to produce the first iteration (gen &rarr; eval &rarr; met/not_met).|运行此任务以开始首轮迭代：生成、评估并判断目标是否达成。
Acceptance|验收标准
· after retries|· 重试后达成
Generator|生成者
generator output summary|生成结果摘要
(no generator snapshot)|（暂无生成结果快照）
Evaluator|评估者
(no evaluator snapshot)|（暂无评估结果快照）
Goal… (enqueue into this project's task queue)|输入目标，加入本项目的任务队列…
Run control: Pause suspends, Resume continues; Budget sets maxIterations/maxRetries (§11.1 default 1/1).|暂停可挂起运行，恢复可继续执行；预算用于设置最大迭代数与重试数，默认均为 1。
No matching reflective rules.|没有匹配的反思规则。
Reflective rules|反思规则
Trigger|触发条件
Lesson|经验
Recommended action|建议操作
Hits|命中次数
Updated|更新时间
Confidence|可信度
Category|类别
All categories|全部类别
policy_denial|策略拒绝
tool_failure|工具失败
architecture_constraint|架构约束
Search rules|搜索规则
Trigger, lesson or action|触发条件、经验或建议操作
Cognitive rules|认知规则
Loading reflective rules…|正在加载反思规则…
Cognitive memory is unavailable.|认知记忆不可用。
rules · Read-only · Latest 1,000 rules|条规则 · 只读 · 显示最近 1,000 条
Permission action|权限审批
Permission ·|权限审批 ·
Sending response…|正在提交回应…
Expired|已过期
Response unavailable|无法提交回应
Awaiting your decision|等待您的决定
Impact ·|影响范围 ·
files ·|个文件 ·
callers|个调用者
Modified files|变更文件
Affected callers|受影响的调用者
No affected callers reported.|未报告受影响的调用者。
Subagents|子代理
No active subagents|暂无运行中的子代理
Cancel|取消
ID|标识
Provider|供应商
Status|状态
Worktree|工作树
Started|开始时间
Ended|结束时间
Duration|耗时
Exit code|退出码
Token usage|词元用量
Subagent token usage|子代理词元用量
Execution stages|执行阶段
Local|本机
Endpoint|端点
Roles|角色
Heartbeat RTT|心跳往返延迟
Remote task activity|远端任务活动
Mesh is not configured.|尚未配置代理网络。
Swarm peer connections|代理节点连接
No connected peers.|暂无已连接节点。
Mesh nodes|代理网络节点
Swarm topology|代理网络拓扑
DAG ID|任务图标识
Inspect observed remote tasks|查看已记录的远端任务
Inspect DAG|查看任务图
Loading mesh nodes…|正在加载代理网络节点…
Heartbeat state refreshes every|心跳状态刷新间隔为
seconds.|秒。
active /|运行中／
peers · Observed|个节点 · 记录时间
of|／
observed|已记录
Talking sandbox audits|会话沙箱审计
Unable to load execution audits.|无法加载执行审计。
Loading execution audits…|正在加载执行审计…
No sandbox execution audits recorded.|暂无沙箱执行审计记录。
Execution outcome|执行结果
Isolation tier|隔离级别
Read-only path whitelist|只读路径白名单
Write path whitelist|写入路径白名单
Memory limit|内存限制
Privilege reduction|权限降低
Reason|原因
Sandbox security constraints|沙箱安全约束
Close sandbox details|关闭沙箱详情
Sandbox:|沙箱：
Turn metrics|回合指标
⚡ Cache|⚡ 缓存
read savings $|读取节省费用 $ 
Staged team plans|待审批的团队计划
Team plan task|团队计划任务
Preview a team plan…|预览团队计划…
Stage plan|生成计划预览
Team task… (Auto resolves the roster: small / dev+reviewer / lead+dev+reviewer)|输入团队任务，自动安排精简、开发与评审或完整协作团队…
Team activity streams live from the session SSE; review handoffs live under .vessel/reviews.|团队活动实时更新，评审交接材料保存在 .vessel/reviews 目录。
No team run yet|暂无团队运行记录
Run a task with this session and the 3-agent activity (Lead / Developer / Reviewer) will appear here.|在本会话中运行团队任务后，将显示负责人、开发者与评审者的活动。
live|实时运行
queued…|排队中…
output preview|输出预览
Output|输出
delegate →|委派 →
Close task details|关闭任务详情
View diff|查看差异
Artifact diff|产物差异
Edit staged team plan|编辑待审批的团队计划
Member routes|成员模型配置
Role|角色
Lead|负责人
Model|模型
Reasoning|推理深度
Default|默认
Low|浅度
Medium|中度
High|深度
Temperature|采样温度
Task parameters|任务参数
Title|标题
Assigned role|执行角色
Description|说明
Dependencies (comma separated)|依赖任务（以逗号分隔）
Save revised preview|保存修改后的预览
Edit plan before approval|审批前编辑计划
Team plan awaiting approval|团队计划等待审批
Review team plan ·|审阅团队计划 ·
Approve &amp; Run|批准并运行
Reject|拒绝
Team task dependencies|团队任务依赖
Details|详情
Collapsed|已折叠
card · Space to expand|卡片 · 按空格展开
External Review Required|需要外部评审
Copy Handoff|复制交接材料
copy the handoff.md artifact for the external reviewer|复制交接材料给外部评审者
Open Folder|打开文件夹
open .vessel/reviews/<id> in the OS file manager|在文件管理器中打开评审材料目录
Import Result|导入结果
artifact|产物
Review:|评审：
Status:|状态：
SHA-256:|校验值：
on disk|已落盘
Verification gate|验证门禁
Verification details|验证详情
phase|阶段
calls|次调用
turn|回合
· Choose an option to retry.|· 请选择一个选项重试。
· Executor:|· 执行器：
· exit|· 退出码
· last|· 最近
suggest:|建议：
unmet:|未达成：
Dependencies:|依赖任务：
Adding…|正在添加…
Enqueue|加入队列
Run task|运行任务
Run team|运行团队
Running…|运行中…
Fingerprint changed since the previous observation.|工作区指纹自上次记录后已变化。
Observed workspace fingerprint.|已记录工作区指纹。
Open Inspector|打开检视器
Collapse Inspector|收起检视器
Local node|本机节点
No DAG snapshot observed. Select a DAG to inspect tasks.|暂无任务图快照，请选择任务图查看任务。
No roles advertised|未公布角色
Unavailable|不可用
Not recorded by the execution audit.|执行审计未记录此项。
No explicit read-only roots; host permissions apply.|未指定只读根目录，使用系统权限。
No native memory cap configured.|未配置原生内存上限。
No write paths allowed.|不允许写入任何路径。
Not enforced for this execution.|本次执行未强制应用。
No workspace changes against HEAD.|工作区相对当前提交没有变更。
Red verified|失败验证已确认
Green verified|通过验证已确认
Rejected|已拒绝
Unclaimed|待认领
None|无
RTT unavailable|往返延迟不可用
Retry|重试
Refresh|刷新
Input|输入
Cache read|缓存读取
Cache write|缓存写入
You|您
estimated |估算 
`;
const entries={};for(const line of pairs.trim().split('\n')){const i=line.indexOf('|');if(i>=0)entries[line.slice(0,i)]=line.slice(i+1);}
fs.writeFileSync('evidence/sessions/2026-10-11-v2.6/i18n-translations.json',JSON.stringify(entries,null,2));
