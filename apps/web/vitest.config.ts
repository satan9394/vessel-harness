import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Standalone web test config. The root vitest config deliberately does not
// scan apps/web; run from this package: `npm run -w @vessel/web test` or
// `npx vitest run --root apps/web`. @vitejs/plugin-react gives component
// tests automatic JSX (react-jsx) transform under the node environment.
//
// **隔离口径（这里与根配置不同，故写下来——对抗评审指出"没有任何地方写着"）**：
// 根配置有 `setupFiles: ['./vitest.setup.ts']`，它把默认状态根（`VESSEL_*_ROOT`）
// 指向一次性临时目录，兜住 AGENTS.md §8（"凡构造**默认** ProviderStore/UsageStore 的用例
// 必须显式注入临时根，不得读写真实 `~/.vessel`"）。
// **web 这里不挂它，理由是 web 侧结构性不适用**：`apps/web/src` 不引用任何 `VESSEL_*`
// 或 `process.env`（它是在浏览器/node 里跑的前端代码，store 由 local-server 持有），
// 因此没有"默认状态根会被读到"的路径。
// **若将来 web 侧出现任何 `VESSEL_*` / 真实 store 读取**：必须**要么**在此挂等价的
// setupFiles，**要么**在用例里显式注入临时根——**不要**因为"今天没引用"就默认安全。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 10000,
  },
});
