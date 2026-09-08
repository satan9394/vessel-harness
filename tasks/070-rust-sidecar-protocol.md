# 070 — Rust Sidecar 协议（JSON-RPC/stdio，PoC）

- 状态：待验收
- 优先级：P0（Wave 4 / Milestone F）
- 创建日期：2026-09-08
- 关联：071-073（sandbox backend 会用 sidecar 协议）；069（凭据 sidecar 候选）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md（V1.4 Security：Rust sidecar 协议 JSON-RPC/stdio PoC）
- ⚠️ 本机无 Rust 工具链（cargo/rustc 不可用）——PoC 范围据此调整

## 目标

Rust Sidecar 协议 PoC：定义 sidecar 进程与宿主之间的 **JSON-RPC 2.0 over stdio** 协议（请求/响应/通知/错误
结构、初始化握手、心跳/退出、能力声明），并在 TS 侧实现协议客户端 + 可测的适配器（可对接假 sidecar 进程），
验证协议正确性；Rust 侧二进制作为协议兼容层文档化（协议规范 + 参考实现要点，本机无工具链不做编译产物）。

## 验收标准（执行器逐条勾选）

- [x] 协议规范：JSON-RPC 2.0 over stdio（帧格式：单行 JSON 或长度前缀——选型并说明；方法集：initialize/
      ping/shutdown + 能力声明 + 具体能力方法占位；错误结构；请求 id 对齐响应；并发请求处理语义）
- [x] TS 侧实现：SidecarClient（spawn 子进程、写请求/读响应、超时/异常/退出处理、消息分帧解析）+ 可注入
      transport（假进程/管道模拟）以便单测
- [x] 假 sidecar 适配器：TS 写的 mock sidecar（读行/写 JSON），验证请求→响应 round-trip/错误/通知/并发
- [x] 协议文档：docs/SIDECAR-PROTOCOL.md（规范 + TS 客户端用法 + Rust 参考实现要点——供有工具链时落地）
- [x] 测试 ≥6 例：分帧解析/请求响应/错误/通知/超时/退出/并发；全量 vitest/tsc 绿（650+ 无回归）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做协议 + TS 客户端 + 假 sidecar 验证。Rust 二进制编译产物不做（无工具链）；071-073 的 sandbox 后端
  消费此协议各自成卡；071+ 需要真 Rust 时另计（工具链就绪后按协议文档落地）。

## 涉及文件（指针，执行器自行精化）

- packages/runtime 或新 packages/sidecar（协议 + client + mock transport）
- docs/SIDECAR-PROTOCOL.md
- 测试（client 单测 + mock sidecar e2e）

## 方法

- 定协议（JSON-RPC 2.0 + 分帧选型）；TS client + 可注入 transport；mock sidecar 用 node 子进程或管道模拟
- 协议文档含 Rust 参考实现要点（类型映射/帧编解码/错误）

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 已完成（2026-09-08，执行器：DSH 隔离子代理）

### 改动文件 + diff 摘要

| 文件 | 类型 | 摘要 |
| --- | --- | --- |
| `docs/SIDECAR-PROTOCOL.md` | 新增 | 协议唯一权威规范：传输/进程模型、JSON-RPC 2.0 对齐、分帧选型与理由、方法集（initialize/ping/shutdown + 能力声明 + 占位能力）、错误结构（标准码 + Vessel 域码）、id 对齐与并发语义、TS 客户端用法、Rust 参考实现要点（类型映射/帧编解码/状态机） |
| `packages/runtime/src/sidecar/types.ts` | 新增 | 协议常量与类型：JsonRpcErrorCode/SidecarErrorCode/SIDECAR_PROTOCOL_VERSION/SidecarMethod/InitializeResult/PingResult/ShutdownResult/SidecarCapabilities；isNotification/isResponse/isRequest 判别 |
| `packages/runtime/src/sidecar/framer.ts` | 新增 | 分帧：SidecarFramer（缓冲+按 `\n` 切帧，容忍 `\r\n`，跳过空行，MAX_FRAME_BYTES=16MiB 兜底）；encodeFrame/decodeFrame |
| `packages/runtime/src/sidecar/transport.ts` | 新增 | SidecarTransport 接口（write/onData/onClose/onError/close/pid）+ createTransportPair 内存双端管道（EOF 传播语义：一端 close 另一端收到 close） |
| `packages/runtime/src/sidecar/child-transport.ts` | 新增 | NodeChildProcessTransport：spawn 真 sidecar（stdio pipe/pipe/inherit），生产适配器（071+ 用），单测不依赖 spawn |
| `packages/runtime/src/sidecar/client.ts` | 新增 | SidecarClient：request/notify/initialize/ping/shutdown、id 生成与 pending 表、按 id 对齐响应（与到达顺序无关）、超时、transport 错误/退出处理、onClose/onNotification；错误类型 SidecarRpcError/SidecarTimeoutError/SidecarClosedError |
| `packages/runtime/src/sidecar/mock-sidecar.ts` | 新增 | MockSidecar：进程内 JSON-RPC 应答器（读行/写 JSON），支持 initialize/ping/shutdown/占位方法、能力未声明→CapabilityUnavailable、故障注入 failAll/rejectInitialize、notify 出站通知 |
| `packages/runtime/src/sidecar/index.ts` | 新增 | sidecar 模块统一导出 |
| `packages/runtime/src/index.ts` | 修改 +1 | `export * from './sidecar/index.js';` |
| `packages/runtime/src/sidecar/framer.test.ts` | 新增 | 分帧测试 7 例（chunk 边界/CRLF/空行/超限/编码/解码/常量） |
| `packages/runtime/src/sidecar/client.test.ts` | 新增 | 客户端测试 13 例（round-trip/便捷方法/错误/能力错误/故障注入/超时/退出/onClose/close 丢弃/通知/反向序并发/失败后流不中毒） |

### 新增测试数与命令输出

- 新增测试：**20 例**（framer 7 + client 13），覆盖验收要求的 分帧/请求响应/错误/通知/超时/退出/并发 全部维度。
- sidecar 定向运行（`npx vitest run packages/runtime/src/sidecar`）：
  `Test Files 2 passed (2) / Tests 20 passed (20)` ✅
- 全量（`npx vitest run`，root 工作区）：
  `Test Files 75 passed (75) / Tests 670 passed (670)` ✅（基线 650 + 新增 20，零回归）
- 类型（`npx tsc -b tsconfig.json`）：`TSC_EXIT=0` ✅

### 协议设计选择（分帧/方法集/错误/并发）

1. **分帧：单行 JSON（newline-delimited）**。核心理由：`JSON.stringify` 从不输出裸 `\n`（字符串内换行转义为 `\\n`），故一消息=一物理行，按 `\n` 切分无歧义；可观测性最好（`type` 直接看活会话）；实现最简（TS 一个缓冲循环 / Rust `BufRead::lines` 天然贴合）。长度前缀（LSP 风格）作为 v2 备选记录在案（超大内嵌二进制字段时再升级）。
2. **方法集**：生命周期 initialize/ping/shutdown 必实现（握手/心跳/优雅退出）；能力声明走 `initialize` 返回的 `capabilities.methods` + `enforcement`（对齐 roadmap §13.3）；`process.exec`/`sandbox.confine`/`fs.*` 为占位方法——声明未实现回 `-32601`，未声明被调回 `-32001 CapabilityUnavailable`，071-073 各自落地。
3. **错误结构**：JSON-RPC 标准码（-32700/-32600/-32601/-32602/-32603）原样保留；Vessel 域码分配在服务器错误保留段 -32000..-32099（NotInitialized/CapabilityUnavailable/SidecarTimeout/ShuttingDown/OperationFailed）。host 侧把 sidecar 错误抛 `SidecarRpcError`，自身失败抛 Timeout/Closed 错误，三类可区分。
4. **并发**：host 单调递增数值 id + pending 表，响应按 id 对齐、与到达顺序无关（测试用反向序回复证明）；迟到/未知 id 丢弃；超时只失败单请求不影响在途；sidecar 退出/EOF 统一拒绝未决。

### 踩坑记录（写进文件，供后续卡参考）

1. **测试驱动 mock 不能同步应答**：首版 "close 丢弃 pending" 测试用 `wire()`（client↔MockSidecar 直连），内存 transport 同步交付导致 ping 在 `close()` 前已 resolve——测试永远过不了关闭路径。修正：用无 peer 的裸 hostEnd 制造永不应答的 pending。**教训：内存 transport 是同步的，测试并发/超时/关闭场景要构造"无人应答"端。**
2. **分帧 chunk 边界测试数据错误**：首版把不完整的 JSON 片段拼进一行（`'{"id":1},'`），实际 framer 行为是拼到下一个 `\n` 才出帧——测试断言与实现语义矛盾。修正为"完整一行 + 下一帧头部"的正确拆分样本。
3. **transport EOF 传播必须双向**：首版 MemoryEnd.close() 只触发自身 closeHandlers，sidecar 退出模拟（sidecarEnd.close()）不会通知 hostEnd。补了 peerClose 传播（一端关闭→另一端收到 close），才真实模拟 stdio 管道 EOF。Rust 侧同理：stdin EOF / 进程退出都要让对端感知。
4. **本机无 Rust 工具链**：按范围边界不做编译产物；Rust 侧以协议文档 §8 参考实现要点落地（类型映射/帧编解码/状态机），071+ 有工具链时照文档实现。
5. **环境备注**：本会话 vitest 后台 job 直跑成功（无 EPERM 阻塞）；但测试设计上仍坚持"可注入 transport、不依赖 spawn"（任务卡要求），NodeChildProcessTransport 仅作生产适配器，e2e spawn 验证留待 071 有真 sidecar 二进制时。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
