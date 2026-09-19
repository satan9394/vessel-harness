import * as os from 'node:os';
import * as path from 'node:path';

/**
 * 用户级 Vessel 状态根：`<home>/.vessel`（`home` 缺省 `os.homedir()`）。
 *
 * **唯一实现**（G-08 轻量收敛）：此前 `path.join(home, '.vessel')` 这个字面在
 * `apps/cli`（migrate / mcp / providers / usage）与 `packages/{application,engine,memory}`
 * 里被复制了约 13 处。复制本身不改行为，但"根目录长什么样"散落多处，改口径时容易漏改。
 *
 * 与 `envRoot` 的分工：`envRoot('VESSEL_X_ROOT')` 回答"环境变量有没有显式覆盖"，
 * `vesselHome()` 只回答"缺省用户级根是什么"。各 store 仍是
 * `envRoot(...) ?? vesselHome()`（或 `vesselHome()` 直接作缺省），**解析语义逐字不变**。
 */
export function vesselHome(home: string = os.homedir()): string {
  return path.join(home, '.vessel');
}
