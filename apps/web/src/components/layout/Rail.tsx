import { useEffect, useState, type ReactElement } from 'react';
import { VesselLogo } from '../VesselLogo';
import { useI18n } from '../LanguageProvider';
import { applyTheme, getStoredTheme, toggleTheme, type ThemeMode } from '../../utils/theme';

/** Product-level regions reachable from the 58px icon rail (DESIGN.md §4). */
export const RAIL_AREAS = ['workbench', 'activity', 'studio', 'settings'] as const;
export type RailArea = typeof RAIL_AREAS[number];

/** 16px stroked glyphs, one per area — no external icon dependency. */
const GLYPHS: Record<RailArea, ReactElement> = {
  workbench: <><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></>,
  activity: <path d="M3 12h4l2.5-7 5 14 2.5-7h4" />,
  studio: <path d="M12 3l2.2 5.3L20 9.5l-4 3.9.9 5.6L12 16.4 7.1 19l.9-5.6-4-3.9 5.8-1.2z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.7v3M12 18.3v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5" /></>,
};

export interface RailProps {
  area: RailArea;
  onSelect: (area: RailArea) => void;
}

/** The 58px global navigation rail: brand mark, region buttons, theme toggle, palette hint. */
export default function Rail({ area, onSelect }: RailProps) {
  const { t } = useI18n();
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const label = (value: RailArea) => t(value === 'studio' ? 'agentStudio' : value);
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  return (
    <aside className="rail">
      <span className="rail-mark" aria-hidden="true"><VesselLogo /></span>
      <nav className="primary-nav" aria-label="Vessel">
        {RAIL_AREAS.map((value) => (
          <button
            key={value}
            data-area={value}
            className={`rail-item${area === value ? ' rail-item-active' : ''}`}
            aria-current={area === value ? 'page' : undefined}
            aria-label={label(value)}
            title={label(value)}
            onClick={() => onSelect(value)}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{GLYPHS[value]}</svg>
          </button>
        ))}
      </nav>
      <div className="rail-footer">
        <button
          type="button"
          className="rail-item rail-theme-toggle"
          aria-label={isDark ? '切换浅色模式' : '切换深色模式'}
          title={isDark ? '切换为浅色主题 (Light)' : '切换为深色主题 (Dark)'}
          onClick={() => {
            const next = isDark ? 'light' : 'dark';
            setTheme(next);
            applyTheme(next);
          }}
        >
          {isDark ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </aside>
  );
}
