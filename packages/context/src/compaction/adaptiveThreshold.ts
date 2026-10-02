export interface AdaptiveCompactionOptions {
  contextWindow: number;
  maxOutputTokens: number;
  safetyBufferTokens?: number;
  cjkSafetyRatio?: number;
}

export function computeAdaptiveThreshold(opts: AdaptiveCompactionOptions): number {
  const buffer = opts.safetyBufferTokens ?? 65_536;
  const ratio = opts.cjkSafetyRatio ?? 0.85;
  if (!Number.isFinite(opts.contextWindow) || opts.contextWindow <= 0 ||
      !Number.isFinite(opts.maxOutputTokens) || opts.maxOutputTokens < 0 ||
      !Number.isFinite(buffer) || buffer < 0 || !Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new RangeError('invalid adaptive compaction token budget');
  }
  const calibratedWindow = opts.contextWindow * ratio;
  // Negative headroom also triggers immediately for non-negative token estimates.
  return Math.floor(Math.min(calibratedWindow * 0.8, calibratedWindow - opts.maxOutputTokens - buffer));
}
