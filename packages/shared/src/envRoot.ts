/**
 * 读一个「状态根」环境变量（`VESSEL_*_ROOT`），**空/纯空白按未设置处理**。
 *
 * 为什么要有这个函数（消除一处静默的行为分裂）：
 * `mcp/config.ts` 早就把「空/纯空白 ⇒ 未设置」处理对了（否则 `VESSEL_MCP_ROOT=` 会让
 * mcp.json 落到进程 CWD），而其它状态根此前用的是 `process.env.X ?? 默认值` —— 于是
 * `VESSEL_PROVIDER_ROOT=`（shell 里「清空变量」的常见写法）会让 provider 状态落到**进程
 * CWD**，而同一次运行里 mcp.json 仍在 `~/.vessel` ⇒ **同一次运行的状态根被拆成两处**，
 * 且没有任何报错。每个根各实现一遍就是多份口径 ⇒ 收敛为这一份实现。
 *
 * 语义（唯一口径，不得各自改写）：
 *   - `undefined` ⇒ `undefined`
 *   - `''` / `'   '`（纯空白）⇒ `undefined`（按未设置）
 *   - 其余 ⇒ **去掉首尾空白**后的值
 *
 * 位置：实现放在 `@vessel/shared`，因为消费方横跨两层 —— `apps/cli`
 * （ProviderStore 直接构造 / mcp / usage / settings）与 `packages/application`
 * （SessionRegistry）。依赖方向只允许 `apps → packages`，实现留在任一侧都会逼出第二份口径
 * （此前正是如此：`providerStateRoot()` 走本函数、`ProviderStore` 构造函数却自己 `??`）。
 * `apps/cli/src/envRoot.ts` 因此改为**再导出**本函数，既有 `./envRoot.js` 导入点逐字不变。
 */
export function envRoot(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}
