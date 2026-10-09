export interface ClaudeModManifest {
  name: string;
  version: string;
  entrypoint: string;
  priority?: number;
  permissions?: { network?: boolean; filesystemRead?: string[]; filesystemWrite?: string[]; allowedTools?: string[] };
  systemPromptContribution?: string;
}

/** Pure schema validation; filesystem confinement is enforced at the runtime boundary. */
export function validateModManifest(value: unknown): ClaudeModManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Mod manifest');
  const data = value as Record<string, unknown>;
  const keys = ['name', 'version', 'entrypoint', 'priority', 'permissions', 'systemPromptContribution'];
  if (Object.keys(data).some(key => !keys.includes(key))) throw new TypeError('Unknown Mod manifest field');
  if (typeof data.name !== 'string' || !/^[\w.-]+$/.test(data.name) || typeof data.version !== 'string' || !data.version || typeof data.entrypoint !== 'string' || !data.entrypoint) throw new TypeError('Invalid Mod identity or entrypoint');
  if (data.priority !== undefined && (typeof data.priority !== 'number' || !Number.isFinite(data.priority))) throw new TypeError('Invalid Mod priority');
  if (data.systemPromptContribution !== undefined && typeof data.systemPromptContribution !== 'string') throw new TypeError('Invalid Mod prompt');
  if (data.permissions !== undefined) {
    if (!data.permissions || typeof data.permissions !== 'object' || Array.isArray(data.permissions)) throw new TypeError('Invalid Mod permissions');
    for (const [key, permission] of Object.entries(data.permissions)) {
      if (key === 'network') { if (typeof permission !== 'boolean') throw new TypeError('Invalid network permission'); }
      else if (['filesystemRead', 'filesystemWrite', 'allowedTools'].includes(key)) {
        if (!Array.isArray(permission) || permission.some(item => typeof item !== 'string' || !item)) throw new TypeError('Invalid Mod permission list');
      } else throw new TypeError('Unknown Mod permission');
    }
  }
  return JSON.parse(JSON.stringify(data)) as ClaudeModManifest;
}
