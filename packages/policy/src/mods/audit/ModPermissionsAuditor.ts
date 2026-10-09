import path from 'node:path';
import { validateModManifest } from '../manifest.js';

export interface ModAuditResult {
  modName: string;
  safe: boolean;
  violations: string[];
  warnings: string[];
  declaredPermissions: Record<string, unknown>;
}

/** Advisory source scan; the Worker permission boundary remains authoritative. */
export class ModPermissionsAuditor {
  static auditSource(sourceCode: string, manifest: Record<string, unknown>): ModAuditResult {
    const violations: string[] = [];
    const warnings = ['Unsigned Mod: sandbox required; disabled until explicit opt-in.', 'Static scanning cannot prove source safety or sandbox integrity.'];
    let declaredPermissions: Record<string, unknown> = {};
    let modName = 'invalid';
    try {
      const valid = validateModManifest(manifest);
      modName = valid.name;
      declaredPermissions = { ...valid.permissions };
      const confined = (value: string) => !path.isAbsolute(value) && !path.win32.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
      if (!confined(valid.entrypoint)) violations.push('Entrypoint escapes Mod root.');
      for (const grant of [...valid.permissions?.filesystemRead ?? [], ...valid.permissions?.filesystemWrite ?? []]) {
        if (!confined(grant)) violations.push('Filesystem grant escapes Mod root.');
      }
      if (valid.permissions?.network) violations.push('Network permissions are unsupported by the Worker sandbox.');
      if (valid.permissions?.allowedTools?.some(tool => !['Read', 'Write', 'Edit'].includes(tool))) violations.push('Unsupported tool permission.');
    } catch { violations.push('Invalid Mod manifest schema.'); }
    const patterns: [RegExp, string][] = [
      [/\brequire\s*\(/, 'Direct require is forbidden.'],
      [/\bprocess\s*(?:\.\s*env|\[\s*['"]env['"]\s*\])/, 'Process environment access is forbidden.'],
      [/\b(?:eval|Function)\s*\(/, 'Dynamic code evaluation is forbidden.'],
      [/\bimport\s*(?:\(|.*?\bfrom\s*)['"](?:node:|fs|child_process|worker_threads|vm|module|net|http|https)/, 'Native module import is forbidden.'],
      [/\b(?:CredentialStore|credentialStore|sandboxLevel|sandboxMode|danger-full-access|corePolicy|policyEngine)\b/, 'Host credentials or policy authority access is forbidden.'],
    ];
    for (const [pattern, message] of patterns) if (pattern.test(sourceCode)) violations.push(message);
    return { modName, safe: violations.length === 0, violations, warnings, declaredPermissions };
  }
}
