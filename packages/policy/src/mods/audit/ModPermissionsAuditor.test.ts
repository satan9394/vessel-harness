import { expect, it } from 'vitest';
import { ModPermissionsAuditor } from './ModPermissionsAuditor.js';

const manifest = { name: 'demo', version: '1.0.0', entrypoint: 'index.js' };
it('accepts inert source while retaining unsigned and static-limit warnings', () => {
  const result = ModPermissionsAuditor.auditSource('module.exports = { observe() {} };', manifest);
  expect(result.safe).toBe(true);
  expect(result.warnings.join(' ')).toContain('Unsigned');
  expect(result.warnings.join(' ')).toContain('cannot prove');
});
it.each(['require("node:fs")', 'process.env.API_KEY', 'process["env"]', 'eval("x")', 'new Function("x")', 'import fs from "node:fs"', 'sandboxLevel = "danger-full-access"', 'CredentialStore.read()'])('rejects known dangerous source %s', source => {
  expect(ModPermissionsAuditor.auditSource(source, manifest).safe).toBe(false);
});
it.each([
  { ...manifest, rootAuthority: true },
  { ...manifest, entrypoint: '../secret.js' },
  { ...manifest, permissions: { network: true } },
  { ...manifest, permissions: { allowedTools: ['Bash'] } },
  { ...manifest, permissions: { filesystemRead: ['../secrets'] } },
  { ...manifest, permissions: { filesystemWrite: ['C:\\secrets'] } },
])('rejects unsupported or escaping permission declarations', value => {
  expect(ModPermissionsAuditor.auditSource('', value).safe).toBe(false);
});
