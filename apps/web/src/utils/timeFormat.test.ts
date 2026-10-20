import { describe, expect, it } from 'vitest';
import { formatClock, formatStamp, shortPathLabel } from './timeFormat';

const NOW = new Date('2026-10-15T14:30:00');

describe('P6 readable time + path formatting', () => {
  it('uses HH:mm for today', () => {
    expect(formatClock(new Date('2026-10-15T09:05:00'), NOW)).toBe('09:05');
    expect(formatClock(new Date('2026-10-15T23:59:00'), NOW)).toBe('23:59');
  });

  it('uses MM-DD for other days', () => {
    expect(formatClock(new Date('2026-10-14T09:05:00'), NOW)).toBe('10-14');
    expect(formatClock(new Date('2026-01-02T00:00:00'), NOW)).toBe('01-02');
  });

  it('renders an em dash for missing or invalid timestamps', () => {
    expect(formatClock(undefined, NOW)).toBe('—');
    expect(formatClock(null, NOW)).toBe('—');
    expect(formatClock('not-a-date', NOW)).toBe('—');
  });

  it('formats a full stamp for detail blocks', () => {
    expect(formatStamp(new Date('2026-10-14T09:05:00'))).toBe('10-14 09:05');
    expect(formatStamp(undefined)).toBe('—');
  });

  it('shows only the readable leaf name, never a raw path or slug', () => {
    expect(shortPathLabel('C:\\Users\\SATANC~1\\AppData\\Local\\Temp\\vessel-card222-fixture-SZVBBY')).toBe('vessel-card222-fixture-SZVBBY');
    expect(shortPathLabel('E:/Code_file/Projects/Vessel_Harness/')).toBe('Vessel_Harness');
    expect(shortPathLabel(undefined)).toBe('—');
  });
});
