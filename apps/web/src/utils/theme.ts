export type ThemeMode = 'system' | 'dark' | 'light';

export function getStoredTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem('vessel_theme');
    if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
  } catch {
    // localStorage may be disabled
  }
  return 'system';
}

export function applyTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem('vessel_theme', mode);
  } catch {
    // localStorage may be disabled
  }
  const root = document.documentElement;
  if (mode === 'dark') {
    root.setAttribute('data-theme', 'dark');
    root.classList.add('dark');
    root.classList.remove('light');
  } else if (mode === 'light') {
    root.setAttribute('data-theme', 'light');
    root.classList.add('light');
    root.classList.remove('dark');
  } else {
    root.removeAttribute('data-theme');
    root.classList.remove('dark', 'light');
  }
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  // If system or dark -> light, if light -> dark
  if (current === 'light') return 'dark';
  return 'light';
}
