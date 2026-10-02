/** Credentials live only in page memory, never URL or persistent storage. */
let launchToken: string | undefined;
export function daemonToken(): string | undefined {
  const bootstrap = globalThis as typeof globalThis & { __VESSEL_DAEMON_TOKEN__?: string };
  if (bootstrap.__VESSEL_DAEMON_TOKEN__) {
    launchToken = bootstrap.__VESSEL_DAEMON_TOKEN__;
    delete bootstrap.__VESSEL_DAEMON_TOKEN__;
  }
  return launchToken;
}
export function setDaemonToken(token: string | undefined): void {
  if (token !== undefined && !/^[0-9a-f]{48}$/.test(token)) throw new Error('Invalid launch token');
  launchToken = token;
}
export function bearerHeaders(token = daemonToken()): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
