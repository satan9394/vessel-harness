import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadPolicyArtifacts } from './PolicyLoader.js';

describe('loaded Policy provenance', () => {
  it('captures system, project and applied session sources from the exact compiled bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-policy-sources-'));
    const systemPath = path.join(root, 'system.yaml'), projectPath = path.join(root, 'project.yaml');
    const system = 'policy:\n  version: "0.1"\n  profile: workspace-write\n  approval: never\n  tools:\n    deny: [Write]\n';
    const project = 'policy:\n  version: "0.1"\n  profile: danger-full-access\n  approval: never\n  tools:\n    deny: [Shell]\n';
    try {
      fs.writeFileSync(systemPath, system); fs.writeFileSync(projectPath, project);
      const artifacts = loadPolicyArtifacts({ systemPath, projectPath, sessionOverrides: { profile: 'read-only' } });
      expect(artifacts.sources).toEqual([
        { kind: 'system', ref: systemPath, hash: createHash('sha256').update(system).digest('hex') },
        { kind: 'project', ref: projectPath, hash: createHash('sha256').update(project).digest('hex') },
        { kind: 'session', ref: 'session overrides', overrides: { profile: 'read-only' } },
      ]);
      expect(artifacts.profile).toBe('read-only'); expect(artifacts.deniedTools).toEqual(['Write', 'Shell']);
      fs.writeFileSync(systemPath, system + '# later edit\n');
      expect(artifacts.sources![0]!.hash).toBe(createHash('sha256').update(system).digest('hex'));
      expect(loadPolicyArtifacts({ systemPath }).sources![0]!.hash).not.toBe(artifacts.sources![0]!.hash);
      expect(loadPolicyArtifacts({ systemPath, projectPath: path.join(root, 'missing.yaml') }).sources).toHaveLength(1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
