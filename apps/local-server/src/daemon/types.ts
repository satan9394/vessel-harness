export interface DaemonInfo {
  pid: number;
  port: number;
  startedAt: string;
  uptimeSeconds: number;
  memoryBytes: number;
  tokenPath: string;
  version: string;
  instanceId: string;
}

export interface DaemonControlContract {
  start(port?: number): Promise<DaemonInfo>;
  stop(): Promise<boolean>;
  status(): Promise<DaemonInfo | null>;
}

export interface DaemonServerControl {
  status(): DaemonInfo;
  stop(): void;
}
