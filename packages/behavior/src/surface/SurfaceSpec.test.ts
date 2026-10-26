import { describe, expect, it } from 'vitest';
import { SELF_HOSTED_SURFACE, validateSurfaceSpec } from '../index.js';
import type { InstallMode, SurfaceCaps, SurfaceSpec } from '../index.js';

function surface(patch: Partial<SurfaceSpec> = {}): SurfaceSpec {
  const installMode: InstallMode = 'self-hosted';
  const caps: SurfaceCaps = { ...SELF_HOSTED_SURFACE.caps };
  return { ...SELF_HOSTED_SURFACE, installMode, caps, ...patch };
}

describe('SurfaceSpec', () => {
  it('accepts the self-hosted surface and arbitrary resident text within the cap', () => {
    expect(validateSurfaceSpec(SELF_HOSTED_SURFACE)).toEqual([]);
    expect(validateSurfaceSpec(surface({ alwaysOn: 'Any wording is allowed.' }))).toEqual([]);
  });

  it.each(['', 'Vessel', 'vessel/self hosted'])('rejects invalid name %j', name => {
    expect(validateSurfaceSpec(surface({ name }))).toContain('name must be nonempty and contain only [a-z0-9._-]');
  });

  it('rejects unsupported install modes without throwing', () => {
    expect(validateSurfaceSpec(surface({ installMode: 'home_dir' as any }))).toContain('installMode must be self-hosted');
  });

  it('requires nonempty resident text within the character cap', () => {
    for (const alwaysOn of ['', '   ']) expect(validateSurfaceSpec(surface({ alwaysOn }))).toContain('alwaysOn must be nonempty');
    expect(validateSurfaceSpec(surface({ alwaysOn: 'abcd', caps: { alwaysOn: true, maxAlwaysOnChars: 3 } }))).toContain('alwaysOn exceeds caps.maxAlwaysOnChars');
    expect(validateSurfaceSpec(surface({ alwaysOn: 'abc', caps: { alwaysOn: false, maxAlwaysOnChars: 3 } }))).toEqual([]);
  });

  it('requires boolean capability and positive integer cap', () => {
    expect(validateSurfaceSpec(surface({ caps: { alwaysOn: 'yes' as any, maxAlwaysOnChars: 8192 } }))).toContain('caps.alwaysOn must be boolean');
    for (const maxAlwaysOnChars of [0, -1, 1.5, NaN, Infinity]) {
      expect(validateSurfaceSpec(surface({ caps: { alwaysOn: true, maxAlwaysOnChars } }))).toContain('caps.maxAlwaysOnChars must be a positive integer');
    }
  });
});
