// The light or dark choice made with the top-bar switch, kept in browser storage so a reload shows the same theme.
// It is the only value written besides the saved profile: the word `light` or `dark`, under one key. Reading and
// writing never throw, so blocked or full storage only means the choice is not remembered.
import type { StorageLike } from '../core/profiles/index.ts';

export const THEME_STORAGE_KEY = 'agui-inspector.theme';

export type ThemeChoice = 'light' | 'dark';

/** The stored choice; `undefined` when nothing is stored, the value is not `light` or `dark`, or storage cannot be read. */
export function loadThemeChoice(storage: StorageLike): ThemeChoice | undefined {
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveThemeChoice(storage: StorageLike, choice: ThemeChoice): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // The choice holds for this page and is not remembered.
  }
}
