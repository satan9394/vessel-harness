import { describe, expect, it } from 'vitest';
import { labelFor, projectLabels, projectName } from './projectLabels';

describe('projectLabels', () => {
  it('returns the bare basename when every root is distinct', () => {
    const roots = ['E:\\Projects\\Vessel_Harness', 'E:\\Code_file\\C_file', 'C:\\work\\alpha'];
    const labels = projectLabels(roots);
    expect([...labels.values()]).toEqual(['Vessel_Harness', 'C_file', 'alpha']);
    expect(labels.get('E:\\Projects\\Vessel_Harness')).toBe('Vessel_Harness');
  });

  it('gives two same-basename roots different labels that still start with the name', () => {
    const roots = ['C:\\Temp\\vessel-geom2-SDP7GI\\ws', 'C:\\Temp\\vessel-uigeom-1e9ilX\\ws'];
    const labels = projectLabels(roots);
    const first = labels.get(roots[0]!)!;
    const second = labels.get(roots[1]!)!;
    expect(first).not.toBe(second);
    expect(first.startsWith('ws')).toBe(true);
    expect(second.startsWith('ws')).toBe(true);
    expect(first).toContain('vessel-geom2-SDP7GI');
    expect(second).toContain('vessel-uigeom-1e9ilX');
    // a single `ws` stays bare when it is the only one in the list
    expect(labelFor(projectLabels([roots[0]!]), roots[0]!)).toBe('ws');
  });

  it('treats different casing as the same name on Windows paths', () => {
    const roots = ['C:\\work\\WS', 'D:\\other\\ws'];
    const labels = projectLabels(roots);
    expect(labels.get(roots[0]!)).not.toBe('WS');
    expect(labels.get(roots[1]!)).not.toBe('ws');
    expect(labels.get(roots[0]!)).not.toBe(labels.get(roots[1]!));
  });

  it('falls back to a short hash when the parent directories also collide', () => {
    const roots = ['C:\\a\\tmp\\ws', 'D:\\a\\tmp\\ws'];
    const labels = projectLabels(roots);
    const values = [...labels.values()];
    expect(new Set(values).size).toBe(2);
    expect(values[0]).toMatch(/^ws · tmp \(/);
    // deterministic across calls
    expect([...projectLabels(roots).values()]).toEqual(values);
  });

  it('keeps the distinguishing tail when the parent directory is long', () => {
    const roots = ['C:\\t\\vessel-e2e-provisioned-YofLXx\\ws', 'C:\\t\\vessel-e2e-provisioned-RJSjZu\\ws'];
    const values = [...projectLabels(roots).values()];
    expect(new Set(values).size).toBe(2);
    expect(values[0]).toContain('…');
    expect(values[0].endsWith('YofLXx')).toBe(true);
    expect(values[1].endsWith('RJSjZu')).toBe(true);
    expect(values[0]!.length).toBeLessThanOrEqual('ws · '.length + 22);
  });

  it('gives case-only-different roots with the same parent different labels', () => {
    const roots = ['D:\\a\\tmp\\ws', 'D:\\a\\tmp\\Ws'];
    const labels = projectLabels(roots);
    const first = labels.get(roots[0]!)!;
    const second = labels.get(roots[1]!)!;
    expect(first).not.toBe(second);
    expect(first.toLowerCase()).not.toBe(second.toLowerCase());
    // deterministic across calls, whatever the input order
    expect([...projectLabels([...roots].reverse()).values()].sort()).toEqual([first, second].sort());
  });

  it('never repeats a label across many roots sharing one parent', () => {
    // 400 distinct roots, all basename `ws` with parent `shared`: the base label
    // is identical for all of them, so uniqueness can only come from claim().
    const roots = Array.from({ length: 400 }, (_, i) => `C:\\users\\u${i}\\shared\\ws`);
    roots.push('D:\\users\\u0\\shared\\Ws');
    const labels = projectLabels(roots);
    const values = [...labels.values()];
    expect(values.length).toBe(roots.length);
    expect(new Set(values.map((v) => v.toLowerCase())).size).toBe(values.length);
  });

  it('puts the digest before an elided parent so clipping cannot hide it', () => {
    const roots = ['C:\\a\\vessel-e2e-provisioned-YofLXx\\ws', 'D:\\a\\vessel-e2e-provisioned-YofLXx\\ws'];
    const labels = projectLabels(roots);
    const first = labels.get(roots[0]!)!;
    const second = labels.get(roots[1]!)!;
    expect(first).toMatch(/^ws \(\w+\) · …/);
    expect(second).toMatch(/^ws \(\w+\) · …/);
    expect(first.slice(0, 20)).not.toBe(second.slice(0, 20));
  });

  it('keeps projectName behaviour for single roots', () => {
    expect(projectName('E:\\Projects\\Vessel')).toBe('Vessel');
    expect(labelFor(new Map(), 'E:\\Projects\\Vessel')).toBe('Vessel');
  });
});
