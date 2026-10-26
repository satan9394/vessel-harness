export type InstallMode = 'self-hosted';

export interface SurfaceCaps {
  /** Whether resident text is injected on each turn. */
  alwaysOn: boolean;
  /** Maximum character count for resident text. */
  maxAlwaysOnChars: number;
}

export interface SurfaceSpec {
  name: string;
  /** Summary of the stable system context assembled by composeHarness. */
  alwaysOn: string;
  installMode: InstallMode;
  caps: SurfaceCaps;
}

/** Returns validation issues without throwing; an empty list means valid. */
export function validateSurfaceSpec(spec: SurfaceSpec): string[] {
  const issues: string[] = [];
  if (typeof spec.name !== 'string' || !/^[a-z0-9._-]+$/.test(spec.name)) issues.push('name must be nonempty and contain only [a-z0-9._-]');
  if (spec.installMode !== 'self-hosted') issues.push('installMode must be self-hosted');
  if (typeof spec.alwaysOn !== 'string' || !spec.alwaysOn.trim()) issues.push('alwaysOn must be nonempty');
  if (typeof spec.caps?.alwaysOn !== 'boolean') issues.push('caps.alwaysOn must be boolean');
  if (!Number.isInteger(spec.caps?.maxAlwaysOnChars) || spec.caps.maxAlwaysOnChars <= 0) issues.push('caps.maxAlwaysOnChars must be a positive integer');
  if (typeof spec.alwaysOn === 'string' && spec.alwaysOn.length > spec.caps?.maxAlwaysOnChars) issues.push('alwaysOn exceeds caps.maxAlwaysOnChars');
  return issues;
}

/** Descriptive value only; composeHarness does not consume this declaration. */
export const SELF_HOSTED_SURFACE: SurfaceSpec = {
  name: 'vessel.self-hosted',
  alwaysOn: 'Compiled behavior prompt sections and policy guidance form the stable system context.',
  installMode: 'self-hosted',
  caps: { alwaysOn: true, maxAlwaysOnChars: 8192 },
};
