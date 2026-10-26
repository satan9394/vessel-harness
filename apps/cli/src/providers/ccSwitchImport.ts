import * as fs from 'node:fs';
import { PROVIDER_PROTOCOLS, type ProviderConfig, type ProviderStore } from './ProviderStore.js';

/** Safe, actionable diagnostics that contain no input values or backend errors. */
export class CcSwitchImportError extends Error {}

export interface CcSwitchImportOptions {
  /** Preview by default; dryRun takes precedence over yes. */
  yes?: boolean;
  dryRun?: boolean;
  prefix?: string;
}

/** Only safe summary fields are returned; unsupported entries use one-based row numbers. */
export interface CcSwitchImportResult {
  dryRun: boolean;
  written: boolean;
  added: string[];
  skippedExisting: string[];
  unsupported: number[];
  needsKey: string[];
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Import an explicitly supplied JSON export, never an application's database.
 * Aliases are considered left to right; app_type must be a Vessel protocol name.
 * Existing config is read without load(): load can migrate keys even in a preview.
 */
export function importCcSwitch(
  store: ProviderStore,
  text: string,
  options: CcSwitchImportOptions = {},
): CcSwitchImportResult {
  let input: unknown;
  try {
    input = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new CcSwitchImportError('Invalid JSON export. Export valid JSON and retry with --from <file>.');
  }
  const rows = Array.isArray(input) ? input : object(input) ? input.providers : undefined;
  if (!Array.isArray(rows)) {
    throw new CcSwitchImportError('Expected an array or an object with a providers array. Use --from <export.json>.');
  }

  let existing: ProviderConfig[] = [];
  try {
    if (fs.existsSync(store.providersFile)) {
      const raw: unknown = JSON.parse(fs.readFileSync(store.providersFile, 'utf8'));
      if (!Array.isArray(raw) || !raw.every((entry) => object(entry)
        && string(entry.id) && string(entry.name) && string(entry.model)
        && PROVIDER_PROTOCOLS.some((protocol) => protocol === entry.protocol))) {
        throw new Error('Invalid provider configuration');
      }
      existing = raw as ProviderConfig[];
    }
  } catch {
    throw new CcSwitchImportError('Cannot read existing provider configuration. Repair providers.json before importing.');
  }

  const result: CcSwitchImportResult = {
    dryRun: options.dryRun === true || options.yes !== true,
    written: false, added: [], skippedExisting: [], unsupported: [], needsKey: [],
  };
  const ids = new Set(['mock', ...existing.map((entry) => entry.id)]);
  const additions: ProviderConfig[] = [];
  // Redact even when a key has been copied into another field in the export.
  const keys = existing.flatMap((entry) => string(entry.apiKey) ? [entry.apiKey!] : []);
  rows.forEach((row: unknown, index: number) => {
    if (!object(row)) {
      result.unsupported.push(index + 1);
      return;
    }
    for (const value of [row.apiKey, row.key]) {
      if (string(value)) keys.push(value as string);
    }
    const originalId = string(row.id) ?? string(row.name);
    const protocol = row.protocol ?? row.app_type;
    const model = string(row.model) ?? (Array.isArray(row.models) ? string(row.models[0]) : undefined);
    if (!originalId || !model || !PROVIDER_PROTOCOLS.some((name) => name === protocol) || protocol === 'mock') {
      result.unsupported.push(index + 1);
      return;
    }
    const id = (options.prefix ?? '') + originalId;
    if (ids.has(id)) {
      result.skippedExisting.push(id);
      return;
    }
    ids.add(id);
    const settings = object(row.settingsConfig) ? row.settingsConfig : {};
    const apiKey = string(row.apiKey) ?? string(row.key);
    additions.push({
      id, name: string(row.name) ?? originalId,
      protocol: protocol as ProviderConfig['protocol'], model,
      baseUrl: string(row.baseUrl) ?? string(row.base_url) ?? string(settings.base_url),
      ...(apiKey ? { apiKey } : {}),
    });
    result.added.push(id);
    if (!apiKey) result.needsKey.push(id);
  });
  if (!result.dryRun && additions.length > 0) {
    if (!store.credentialsEnabled) throw new CcSwitchImportError('Import requires a CredentialStore. Use the default provider store.');
    try {
      store.save([...existing, ...additions]);
      result.written = true;
    } catch {
      // Store/backend errors may include user-supplied fields or credentials.
      throw new CcSwitchImportError('Could not save imported providers. Check provider configuration and credential storage permissions.');
    }
  }
  const redact = (value: string): string => keys.reduce(
    (safe, key) => safe.split(key).join('[redacted]'), value,
  );
  result.added = result.added.map(redact);
  result.skippedExisting = result.skippedExisting.map(redact);
  result.needsKey = result.needsKey.map(redact);
  return result;
}
