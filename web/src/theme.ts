// White / Green theme persistence (localStorage).
//
// The active theme is expressed as `data-theme` on the `.app` div. CSS rules
// in styles.css apply the green tint when [data-theme="green"].

export type Theme = 'white' | 'green';

const STORAGE_KEY = 'pdf-reader-theme';

export function getStoredTheme(): Theme {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'green' ? 'green' : 'white';
}

export function setStoredTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}
