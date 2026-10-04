// Issue #101: the light or dark choice survives a reload. The value is only `light` or `dark` under one key;
// anything else, and any storage that fails, leaves the page following the system preference.
// The page-level behavior is in startup.test.ts (applied before the first request) and
// tests/e2e/hosted/app.spec.ts (switch, reload, same theme).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadThemeChoice, saveThemeChoice, THEME_STORAGE_KEY } from '../../src/app/theme-choice.ts';

const memory = (initial: Record<string, string> = {}) => {
  const items = { ...initial };
  return { items, getItem: (key: string) => items[key] ?? null, setItem: (key: string, value: string) => void (items[key] = value) };
};
const broken = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
};

test('a saved choice is read back, and it is the only key written', () => {
  const storage = memory();
  for (const choice of ['dark', 'light'] as const) {
    saveThemeChoice(storage, choice);
    assert.equal(loadThemeChoice(storage), choice);
  }
  assert.deepEqual(storage.items, { [THEME_STORAGE_KEY]: 'light' });
});

test('nothing stored means no choice', () => {
  assert.equal(loadThemeChoice(memory()), undefined);
});

test('a stored value that is not exactly light or dark is ignored', () => {
  for (const value of ['', 'auto', 'system', 'Dark', 'LIGHT', ' dark', 'dark ', '"dark"', '{"theme":"dark"}', 'null', 'undefined']) {
    assert.equal(loadThemeChoice(memory({ [THEME_STORAGE_KEY]: value })), undefined, JSON.stringify(value));
  }
});

test('storage that throws never breaks reading or writing', () => {
  assert.equal(loadThemeChoice(broken), undefined);
  assert.doesNotThrow(() => saveThemeChoice(broken, 'dark'));
});
