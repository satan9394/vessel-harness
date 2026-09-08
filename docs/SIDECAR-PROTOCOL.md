# SIDECAR-PROTOCOL.md — Vessel Rust Sidecar 协议（JSON-RPC 2.0 over stdio）

- **版本**：v1.0
- **日期**：2026-09-08
- **状态**：PoC（task 070）
- **权威来源**：docs/Vessel_后续开发方向与产品化路线_v1.0.md §13.2/§13.3（TS Brain ↔ Rust Runtime 的 JSON-RPC/stdio 边界）
- **下游消费方**：071 Windows sandbox backend、072 process-tree confinement、069 凭据 sidecar 候选
- **TS 实现**：`packages/runtime/src/sidecar/`（client / transport / framer / mock-sidecar / types）

> 一句话：**宿主（Vessel Core, TS）与 sidecar（Vessel Runtime, 未来 Rust 二进制）之间以
> JSON-RPC 2.0 为语义层、以 newline-delimited JSON 为帧层、以 stdin/stdout 为通道；
> 本文件是协议的唯一权威规范，TS 客户端与 Rust 参考实现都必须与它逐条对齐。**

---

## 0. 术语

| 词 | 含义 |
| --- | --- |
| 宿主（host） | Vessel Core，TS 进程，`SidecarClient` 所在侧 |
| sidecar | 未来 Rust 二进制（071+ 的 sandbox/process/fs 后端），读写 stdio |
| 帧（frame） | 一条物理行（`\n` 结尾），恰好是一个 JSON-RPC 消息的序列化 |
| 请求（request） | 带 `id`、期望响应的 JSON-RPC 消息 |
| 通知（notification） | 不带 `id`、不期望响应的 JSON-RPC 消息 |
| 响应（response） | 携带与请求 `id` 相同的返回消息（`result` 或 `error`） |

## 1. 传输与进程模型

- 通道：**stdin（host→sidecar 写）、stdout（sidecar→host 写）**。stderr 保留给 sidecar 的诊断日志（host 侧透传到控制台），**不承载协议消息**。
- 二进制：host 用 `spawn(command, args, { stdio: ['pipe','pipe','inherit'] })` 拉起 sidecar；`windowsHide: true`。
- 生命周期：host 启动 → `initialize` 握手 → 业务请求/通知 → `shutdown` → sidecar 回复后退出；或 host 异常时直接关闭 stdin/杀进程。
- 退出语义：sidecar 进程退出后，host 侧 stdout 收到 EOF → 所有未决请求以 `SidecarClosedError` 拒绝。

## 2. JSON-RPC 2.0 对齐

本协议是 JSON-RPC 2.0（<https://www.jsonrpc.org/specification>）的一个受约束子集：

- 每个消息必须包含 `"jsonrpc":"2.0"`。
- 请求：`{"jsonrpc":"2.0","id":<string|number>,"method":"...","params":{...}?}`。
- 通知：同请求但**无 `id`**。
- 成功响应：`{"jsonrpc":"2.0","id":<同请求>,"result":...}`。
- 错误响应：`{"jsonrpc":"2.0","id":<同请求>,"error":{"code":<number>,"message":"...","data":...?}}`。
- **响应必须携带与请求完全一致的 `id`**（数值按值比较；字符串按值比较）。host 以 `id` 对齐响应，与到达顺序无关。
- 未携带 `id` 的入站消息视为通知；既无 `id` 又无 `method` 的消息视为协议违规（host 以内部错误失败当前批次）。

## 3. 帧格式选型：newline-delimited JSON（单行 JSON）

**选型：一帧 = 一行（`\n` 结尾）。**

理由：

1. `JSON.stringify` 从不输出裸 `0x0A`——字符串值里的换行一律转义为 `\\n`。因此**一个 JSON-RPC 消息序列化后必然是一条不含内嵌换行的物理行**，按 `\n` 切分即可无歧义地恢复消息边界，不需要任何长度字段或消息状态机。
2. 可观测性好：`type sidecar.log` / `tail` 即可肉眼审查一个活会话，帧即行。
3. 实现最简：host 侧 `SidecarFramer` 只维护一个字符串缓冲 + `indexOf('\n')`；Rust 侧 `BufRead::read_line` 一行即一帧，天然贴合 `std::io::BufRead`。

被拒绝的备选与理由：

- **裸 JSON blob（写一次发一个）**：管道是字节流，多个消息拼接后没有边界可分——不可行。
- **长度前缀（LSP/JSON-RPC 1.x 风格，4 字节 LE + payload）**：无歧义但引入二进制信封，live 会话无法直接 `type` 查看；本协议消息有界（host 侧 `MAX_FRAME_BYTES = 16 MiB` 兜底），单行方案不损失什么。**保留为 v2 备选**：若未来某个方法需要传输内嵌裸二进制的超大字段，再升级为长度前缀（此时 Rust 侧 `serde_json` + 手动读 4 字节头即可）。

分帧细则：

- host 侧容忍 `\r\n`（Windows 管道），剥掉 `\r`。
- 空行（仅 `\n`）跳过，不算消息。
- 单帧超过 `MAX_FRAME_BYTES`（16 MiB）视为流损坏：host 失败当前所有未决请求。
- 写入侧：每条消息 `JSON.stringify(msg) + '\n'` 一次性 `write`（Node 管道写入原子性足够，Rust 侧 `write_all` 同理）。

## 4. 方法集（v1.0）

### 4.1 生命周期方法（必须实现）

| 方法 | 方向 | params | result | 说明 |
| --- | --- | --- | --- | --- |
| `initialize` | host→sidecar | `{ "protocolVersion"?: "1.0" }` | `InitializeResult`（见下） | 握手；host 必须先 `initialize` 再发业务请求 |
| `ping` | host→sidecar | `{}` | `PingResult` | 心跳/存活检测；sidecar 记录收到时刻 `receivedAt`（ms）供往返延迟测量 |
| `shutdown` | host→sidecar | `{}` | `ShutdownResult` | 优雅退出：sidecar 回复后关闭 stdout、退出进程 |

`InitializeResult`：

```json
{
  "protocolVersion": "1.0",
  "serverName": "vessel-runtime",
  "serverVersion": "0.1.0",
  "capabilities": {
    "methods": ["initialize", "ping", "shutdown", "process.exec", "sandbox.confine", "fs.readFile", "fs.writeFile", "fs.readDir"],
    "implementation": "rust",
    "enforcement": { "filesystem": "enforced", "process": "enforced", "network": "partial" }
  }
}
```

`capabilities.methods` 是 sidecar 实际支持的**可执行方法子集**（能力声明）；`enforcement` 对齐 roadmap §13.3 的回报结构（`enforced | partial | none`）。

`PingResult`：`{ "pong": true, "protocolVersion": "1.0", "receivedAt": <ms> }`

`ShutdownResult`：`{ "ok": true, "graceMs": <ms> }`（sidecar 承诺在 `graceMs` 内 flush 后退出）

### 4.2 能力方法占位（071-073 落地，本卡只做协议声明）

| 方法 | 目标后端 | 说明 |
| --- | --- | --- |
| `process.exec` | 072 process-tree confinement | 受控进程执行 |
| `sandbox.confine` | 071 Windows sandbox backend | 受限令牌/ACL 约束 |
| `fs.readFile` / `fs.writeFile` / `fs.readDir` | 071 fs confinement | 文件系统受控访问 |

PoC 语义：sidecar 若声明了某方法但尚未实现，回答 JSON-RPC `-32601 Method not found`；
若 host 调用**未声明**的能力，sidecar 回答域错误 `-32001 CapabilityUnavailable`。

### 4.3 通知（无响应）

- host→sidecar：`client.notify(method, params)`，fire-and-forget，如进度上报 `progress`。
- sidecar→host：日志/事件推送，如 `log`、`sandbox.event`。host 通过 `onNotification` 回调消费，**不参与 id 对齐**。

## 5. 错误结构

遵循 JSON-RPC 2.0 §5.1 的 `error` 对象：`{ "code": <number>, "message": "<string>", "data": <any>? }`。

### 5.1 标准错误码（保留，不重定义）

| code | 名称 | 触发 |
| --- | --- | --- |
| -32700 | Parse error | 帧不是合法 JSON |
| -32600 | Invalid Request | 合法 JSON 但不是合法请求/通知对象 |
| -32601 | Method not found | 方法未声明/未实现 |
| -32602 | Invalid params | 参数校验失败 |
| -32603 | Internal error | sidecar 内部异常 |

### 5.2 Vessel 域错误码（-32000 服务器错误保留段内分配）

| code | 名称 | 触发 |
| --- | --- | --- |
| -32000 | NotInitialized | 未 `initialize` 就发业务请求 |
| -32001 | CapabilityUnavailable | 调用未声明的能力 |
| -32002 | SidecarTimeout | sidecar 侧超时 |
| -32003 | ShuttingDown | sidecar 退出中拒绝新工作 |
| -32004 | OperationFailed | 域操作失败（细节进 `message`/`data`） |

host 侧（TS）把响应错误统一抛为 `SidecarRpcError`（携带 `code`/`message`/`data`）；
host 侧自身失败（超时/连接关闭）抛 `SidecarTimeoutError` / `SidecarClosedError`，与 sidecar 错误区分开。

## 6. 请求 id 与并发语义

- host 为每个请求分配**单调递增的数值 id**（从 1 起），并发请求各自独立，互不阻塞。
- 响应可按任意顺序到达——host 以 `id` 查 pending 表对齐，**与到达顺序无关**；迟到/未知 id 丢弃。
- sidecar 可任意交错处理并发请求（多线程/异步），只需保证响应携带正确 `id`。
- 通知无 id、无响应、无顺序承诺（尽力而为）。
- 超时：host 每请求可配超时（默认 30 s），超时后该请求以 `SidecarTimeoutError` 失败，**不影响其他在途请求**。
- 退出：sidecar 退出/管道 EOF 时，host 以 `SidecarClosedError` 拒绝所有未决请求，并触发 `onClose` 回调。

## 7. TS 客户端用法（packages/runtime/src/sidecar）

```ts
import { SidecarClient } from '@vessel/runtime';            // 或 packages/runtime/src/sidecar
import { NodeChildProcessTransport } from '@vessel/runtime';

// 生产：spawn 真 sidecar（Rust 二进制就绪后）
const transport = new NodeChildProcessTransport({
  command: 'vessel-runtime', // 071+ 产物路径
  args: [],
});
const client = new SidecarClient(transport, {
  requestTimeoutMs: 5000,
  onNotification: (n) => console.log('[sidecar notify]', n.method, n.params),
});

const init = await client.initialize({ protocolVersion: '1.0' });
console.log(init.capabilities.methods);
const pong = await client.ping();
const out = await client.request('process.exec', { cmd: ['echo', 'hi'] }); // 071 后可用
await client.shutdown();
client.close();
```

### 7.1 可注入 transport（单测核心）

`SidecarClient` 只依赖 `SidecarTransport` 接口（`write/onData/onClose/onError/close/pid`），
因此测试用内存双端管道把 client 与 `MockSidecar` 在进程内对接，**不 spawn 任何进程**：

```ts
import { SidecarClient, MockSidecar, createTransportPair } from '@vessel/runtime';

const [hostEnd, sidecarEnd] = createTransportPair();
const sidecar = new MockSidecar(sidecarEnd);      // 进程内 JSON-RPC 应答器
const client = new SidecarClient(hostEnd);

await client.initialize();                          // round-trip 走通
client.close();
```

## 8. Rust 参考实现要点（供有工具链时落地；本机无 cargo/rustc，不做编译产物）

> 目标：`vessel-runtime`（071+ 的 sandbox/process/fs 后端）。下列要点是协议文档化的
> Rust 侧落地方案，类型/帧/错误与 §2-§5 逐条对齐；工具链就绪后按此实现。

### 8.1 类型映射

```rust
// 帧即行：serde_json 直接映射 JSON-RPC 消息
#[derive(Deserialize, Serialize)]
#[serde(tag = "jsonrpc", rename_all = "lowercase")]
struct Message { /* ... */ }

#[derive(Deserialize, Serialize)]
struct Request {
    jsonrpc: String,          // 恒为 "2.0"，校验之
    id: RequestId,            // Number(u64) | String(String)
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<serde_json::Value>,
}

#[derive(Deserialize, Serialize)]
struct Notification { jsonrpc: String, method: String, params: Option<serde_json::Value> }

#[derive(Deserialize, Serialize)]
struct Response {
    jsonrpc: String,
    id: RequestId,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorObject>,
}

#[derive(Deserialize, Serialize)]
struct ErrorObject { code: i64, message: String, #[serde(skip_serializing_if = "Option::is_none")] data: Option<serde_json::Value> }

enum RequestId { Number(u64), String(String) }   // 序列化为裸 number/string
```

建议依赖：`serde` + `serde_json`（帧编解码）、`tokio`（异步并发处理）或 `std::thread`（每请求一线程，PoC 够用）。

### 8.2 帧编解码（stdin/stdout 行循环）

```rust
// 解码：一行一帧
use std::io::{BufRead, Write};
let stdin = std::io::stdin();
for line in stdin.lock().lines() {
    let line = line?;                       // BufRead::lines 已剥 \n（及 \r\n 的 \r 需再剥）
    let line = line.strip_suffix('\r').unwrap_or(&line);
    if line.is_empty() { continue; }        // 空行跳过（§3）
    let msg: serde_json::Value = serde_json::from_str(line)
        .map_err(|e| reply_parse_error(e))?; // -32700 Parse error
    dispatch(msg);
}

// 编码：一条消息一行，write_all + flush（stdout 是块缓冲，必须 flush）
fn write_frame(msg: &impl Serialize) {
    let mut buf = serde_json::to_string(msg)?;   // 不含裸 \n（serde_json 转义字符串内换行）
    buf.push('\n');
    std::io::stdout().lock().write_all(buf.as_bytes())?;
    std::io::stdout().lock().flush()?;           // 关键：stdout 行缓冲/块缓冲差异
}
```

注意点：

- stdout 默认对管道是**块缓冲**——不 flush 会一直攒着，宿主等不到响应。每条响应后必须 flush（或用 `BufWriter` + 显式 flush）。
- 单行超长（>16 MiB）视为流损坏，回 `-32700` 或直接报错退出（§3）。
- Windows 上管道文本模式可能把 `\n` 转成 `\r\n`，host 侧已容忍 `\r\n`；Rust 侧读行时剥 `\r` 保持对称。

### 8.3 错误与并发

```rust
// 错误码常量（与 TS SidecarErrorCode / JsonRpcErrorCode 一一对应）
const PARSE_ERROR: i64 = -32700;
const METHOD_NOT_FOUND: i64 = -32601;
const NOT_INITIALIZED: i64 = -32000;      // Vessel 域
const CAPABILITY_UNAVAILABLE: i64 = -32001;
// ...见 §5

// 并发：id → 响应由调用方（方法 handler）构造；sidecar 端按请求顺序 or 异步皆可，
// 唯一硬约束是响应 id 与请求一致（§6）。tokio::spawn 每个方法 handler 即可。
```

### 8.4 状态机

```
NotInitialized ──initialize()──▶ Initialized ──业务请求/通知──▶ (running)
                                   │
                                   ├──shutdown()──▶ reply ShutdownResult ──▶ flush+exit
                                   └──stdin EOF / 异常──▶ exit(非0)
```

未 initialize 的业务请求回 `-32000 NotInitialized`；`shutdown` 后再来的请求回 `-32003 ShuttingDown`。

## 9. 验收对照（task 070）

- [x] 协议规范：JSON-RPC 2.0 over stdio + 分帧选型（§2/§3）+ 方法集（§4）+ 错误结构（§5）+ id 对齐与并发语义（§6）
- [x] TS 客户端：`SidecarClient`（spawn 或注入 transport、写/读/分帧/超时/异常/退出）+ 可注入 transport
- [x] 假 sidecar：`MockSidecar`（读行/写 JSON），验证 round-trip/错误/通知/并发
- [x] 测试 ≥6 例：分帧/请求响应/错误/通知/超时/退出/并发
- [x] Rust 参考实现要点（§8），无编译产物（本机无工具链）

## 10. 变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-09-08 | v1.0 | PoC 定型：单行 JSON 分帧、方法集、错误码表、TS 客户端、Rust 参考要点（task 070） |