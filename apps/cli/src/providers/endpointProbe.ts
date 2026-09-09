import type { ProviderConfig } from './ProviderStore.js';

/**
 * apps/cli/providers/endpointProbe — 端点最小探测 + 建议（task 096）。
 *
 * 设计取舍（对齐任务卡「测速结果只作建议，不自动改默认端点」）：
 *   - **最小探测**：只发一个 `GET {base}/models`（不带任何凭据），拿「是否可达 +
 *     延迟」两件事；不解析响应体、不校验模型清单（那是 `vessel models` 的活）。
 *   - **不发送 apiKey**：探测请求不带凭据——避免把密钥送到「候选端点」这种
 *     用户临时填的地址上。401/403 也算「可达」（网络与 TLS 通了），只是未鉴权。
 *   - **只给建议**：`suggestEndpoint()` 返回最快可达端点；是否应用由调用方显式
 *     决定（CLI 的 `--set-default`），本模块不改任何配置。
 *   - 依赖注入：`fetchImpl` / `now` 可注入，测试用假 fetch 与假时钟，不打真网络。
 */

/** 单端点探测结果。 */
export interface EndpointProbeResult {
  /** 被探测的端点 baseUrl（原样） */
  url: string;
  /** 端点标签（若配置里有） */
  label?: string;
  /** 实际请求的探测 URL（`{base}/models`） */
  probeUrl: string;
  /** 收到任意 HTTP 响应（含 4xx/5xx）即视为可达 */
  reachable: boolean;
  /** 可达且 HTTP < 400（无凭据探测下 401/403 属于正常，不算 ok） */
  ok: boolean;
  /** HTTP 状态码（未收到响应时 undefined） */
  status?: number;
  /** 端到端耗时（毫秒，含连接/DNS/TLS） */
  latencyMs: number;
  /** 不可达原因（超时 / 连接失败等） */
  error?: string;
}

export interface ProbeOptions {
  /** 单端点超时（毫秒，默认 3000） */
  timeoutMs?: number;
  /** fetch 实现（测试注入） */
  fetchImpl?: typeof fetch;
  /** 单调时钟（测试注入；默认 Date.now） */
  now?: () => number;
  /** 探测路径（默认 '/models'） */
  probePath?: string;
}

/** 默认探测超时：够慢网络用，又不至于让 `--all` 卡死。 */
export const DEFAULT_PROBE_TIMEOUT_MS = 3000;

/** 探测 URL 归一：去掉尾部斜杠后拼 `{path}`（默认 /models）。 */
export function probeUrlFor(baseUrl: string, probePath = '/models'): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  const p = probePath.startsWith('/') ? probePath : `/${probePath}`;
  return `${clean}${p}`;
}

function errorMessage(err: unknown, timeoutMs: number): string {
  const e = err as { name?: string; message?: string };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `timeout after ${timeoutMs}ms`;
  return e?.message ?? String(err);
}

/**
 * 探测单个端点（无凭据 GET）。**永不抛**——网络错误折叠成 `reachable:false` +
 * `error`，因为「探测失败」本身就是要报告的结果。
 */
export async function probeEndpoint(
  url: string,
  label: string | undefined,
  opts: ProbeOptions = {},
): Promise<EndpointProbeResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const probeUrl = probeUrlFor(url, opts.probePath);
  const started = now();
  try {
    const resp = await fetchImpl(probeUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = now() - started;
    const base = { url, ...(label !== undefined ? { label } : {}), probeUrl, latencyMs };
    return { ...base, reachable: true, ok: resp.status < 400, status: resp.status };
  } catch (err) {
    return {
      url,
      ...(label !== undefined ? { label } : {}),
      probeUrl,
      reachable: false,
      ok: false,
      latencyMs: now() - started,
      error: errorMessage(err, timeoutMs),
    };
  }
}

/** 排序权重：可达且 2xx/3xx(0) < 可达但需鉴权(1) < 不可达(2)。 */
function rankScore(r: EndpointProbeResult): number {
  if (r.ok) return 0;
  return r.reachable ? 1 : 2;
}

/** 按「可达性优先、同档延迟升序」排序（不改原数组）。 */
export function rankProbes(results: EndpointProbeResult[]): EndpointProbeResult[] {
  return [...results].sort((a, b) => rankScore(a) - rankScore(b) || a.latencyMs - b.latencyMs);
}

/** 最快可达端点（全部不可达 → undefined）。**只作建议**，不改配置。 */
export function suggestEndpoint(results: EndpointProbeResult[]): EndpointProbeResult | undefined {
  const ranked = rankProbes(results);
  return ranked.find((r) => r.reachable);
}

/** 探测某 provider 的全部候选端点（`effectiveEndpoints` 语义：endpoints 或 baseUrl 回退）。 */
export async function probeProviderEndpoints(
  cfg: Pick<ProviderConfig, 'endpoints' | 'baseUrl'>,
  opts: ProbeOptions = {},
): Promise<EndpointProbeResult[]> {
  const pool =
    cfg.endpoints !== undefined && cfg.endpoints.length > 0
      ? cfg.endpoints
      : cfg.baseUrl
        ? [{ url: cfg.baseUrl }]
        : [];
  return Promise.all(pool.map((e) => probeEndpoint(e.url, e.label, opts)));
}
