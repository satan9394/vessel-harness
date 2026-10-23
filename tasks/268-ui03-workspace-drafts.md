# 任务卡268：UI-03工作区启动草稿隔离

**状态**：已修并验证，待协调者验收（2026-10-22）

## Goal

第二波UI-03：复用已完成导航收敛，补齐跨工作区任务草稿隔离，保留同工作区返回草稿，成功创建后清空已发送草稿。

## Existing Classification

部分实现：卡238已移除Rail并把四区/主题合入Sidebar；App命令面板保留创建/搜索/最近项目与会话/四区入口；窄屏drawer具备inert、Tab循环、Escape回位。卡265已补首屏焦点，Conversation按session隔离草稿已有测试。缺口：TaskComposer只有单一task状态，改变selectedRoot不会隔离，且导航卸载丢失任务草稿。仅补此缺口。

## Not Doing

不重写导航/创建协议，不改core，不持久化用户草稿到磁盘，不commit/push、不跑test:all，不使用用户工作区执行模型。

## Acceptance

A/B工作区草稿互相隔离、返回恢复、同client重挂载保留，成功创建仅清空当前工作区草稿；失败保留；保留新会话权限和模型选择。定向测试、六项指定门禁、IAB实际切换与真实模型短请求验证无误发。

## Blast Radius

TaskComposer及其测试；已有App导航仅验证，不重写。

## Expected Evidence

测试、六项退出码及浏览器切换/唯一消息JSONL证据，统一修复报告。

## Result

启动草稿按API client/工作区在页内隔离，导航返回保留；成功只清空当前工作区，失败保留。六项指定门禁exit 0，IAB两个系统临时夹具切换与唯一真实模型需求验证通过。完整功能清单、测试与证据见[修复报告](../evidence/sessions/2026-10-23-fix-wave-report.md)。
