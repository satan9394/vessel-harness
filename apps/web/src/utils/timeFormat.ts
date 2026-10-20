/**
 * Readable time formatting for list rows (P6, DESIGN.md §6.3).
 *
 * Raw `toLocaleString()` output is noisy in dense lists (full date + seconds).
 * Rows want `HH:mm` for today and `MM-DD` for anything older. Kept pure so the
 * format is unit-testable and locale-independent.
 */
function toDate(value: string | number | Date | undefined | null): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `HH:mm` when the timestamp is today, otherwise `MM-DD`; `—` when unusable. */
export function formatClock(value: string | number | Date | undefined | null, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '—';
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `MM-DD HH:mm` for detail blocks where the exact time matters. */
export function formatStamp(value: string | number | Date | undefined | null): string {
  const date = toDate(value);
  if (!date) return '—';
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Default-deny list label: a readable project name, never a raw slug or long path. */
export function shortPathLabel(root: string | undefined | null): string {
  if (!root) return '—';
  const trimmed = root.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? trimmed;
}
