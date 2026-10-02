// D02 T061 (FR-041, SC-010): applying the validated theme maps. The maps are set as custom
// properties through the CSS object model, which the content security policy allows, and follow the
// same automatic/manual light/dark selection the stylesheet uses. Nothing here needs a browser: the
// element, the media query and the observer are the small surfaces `applyTheme` actually touches.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { ThemeConfig } from '../../src/contracts.ts';
import { applyTheme, type ThemeWindow } from '../../src/views/theme/config.ts';

function setup(theme: ThemeConfig | undefined, prefersDark = false) {
  const set = new Map<string, string>();
  const calls: string[] = [];
  const root = {
    dataset: {} as Record<string, string | undefined>,
    style: {
      setProperty: (name: string, value: string) => void (calls.push(`set ${name}`), set.set(name, value)),
      removeProperty: (name: string) => void (calls.push(`remove ${name}`), set.delete(name)),
    },
  };
  const media = {
    matches: prefersDark,
    listeners: [] as Array<() => void>,
    addEventListener(type: string, listener: () => void) {
      assert.equal(type, 'change');
      this.listeners.push(listener);
    },
  };
  const queries: string[] = [];
  let observed: { callback: () => void; options: MutationObserverInit } | undefined;
  class FakeObserver {
    callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
    }
    observe(target: unknown, options: MutationObserverInit) {
      assert.equal(target, root);
      observed = { callback: this.callback, options };
    }
  }
  const win = {
    matchMedia: (query: string) => (queries.push(query), media),
    MutationObserver: FakeObserver,
  };
  applyTheme(root as unknown as HTMLElement, theme, win as unknown as ThemeWindow);
  return {
    set,
    calls,
    queries,
    observed: () => observed,
    force(mode: 'light' | 'dark' | undefined) {
      root.dataset.theme = mode;
      observed?.callback();
    },
    system(dark: boolean) {
      media.matches = dark;
      for (const listener of media.listeners) listener();
    },
  };
}

const THEME: ThemeConfig = {
  light: { '--agui-accent': '#2563eb', '--agui-radius': '6px' },
  dark: { '--agui-accent': '#93c5fd' },
};

test('the light map applies when the system prefers light, the dark map when it prefers dark', () => {
  assert.deepEqual([...setup(THEME, false).set], [['--agui-accent', '#2563eb'], ['--agui-radius', '6px']]);
  assert.deepEqual([...setup(THEME, true).set], [['--agui-accent', '#93c5fd']]);
  assert.deepEqual(setup(THEME).queries, ['(prefers-color-scheme: dark)']);
});

test('a system preference change swaps the maps and leaves nothing of the old one behind', () => {
  const page = setup(THEME, false);
  page.system(true);
  assert.deepEqual([...page.set], [['--agui-accent', '#93c5fd']]);
  page.system(false);
  assert.deepEqual([...page.set], [['--agui-accent', '#2563eb'], ['--agui-radius', '6px']]);
});

test('an explicit data-theme beats the system preference, in both directions, and clearing it falls back', () => {
  const page = setup(THEME, true);
  page.force('light');
  assert.equal(page.set.get('--agui-accent'), '#2563eb');
  page.force('dark');
  assert.deepEqual([...page.set], [['--agui-accent', '#93c5fd']]);
  page.system(false);
  assert.equal(page.set.get('--agui-accent'), '#93c5fd', 'a forced dark theme ignores the system');
  page.force(undefined);
  assert.equal(page.set.get('--agui-accent'), '#2563eb');
  assert.deepEqual(page.observed()?.options, { attributes: true, attributeFilter: ['data-theme'] });
});

test('a missing map leaves the mode on its defaults', () => {
  const page = setup({ light: { '--agui-radius': '2px' } }, true);
  assert.deepEqual([...page.set], []);
  page.force('light');
  assert.deepEqual([...page.set], [['--agui-radius', '2px']]);
  page.force('dark');
  assert.deepEqual([...page.set], []);
});

test('no theme means no property is touched and nothing is observed', () => {
  for (const theme of [undefined, {}]) {
    const page = setup(theme, true);
    assert.deepEqual(page.calls, []);
    assert.equal(page.observed(), undefined);
  }
});

test('an unrelated attribute change re-applies the same values without growing the property set', () => {
  const page = setup(THEME, false);
  page.force('light');
  page.force('light');
  assert.deepEqual([...page.set], [['--agui-accent', '#2563eb'], ['--agui-radius', '6px']]);
});

// ---------------------------------------------------------------------------------------------
// Where the stylesheets declare things (T060): generic derived tokens belong to the inspector's
// mount, so a host page's --bg, --fg, --muted, --acc or --r can neither reach them nor be replaced by them.
// ---------------------------------------------------------------------------------------------

const dir = path.join(process.cwd(), 'packages/inspector/src');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = strip(readFileSync(path.join(dir, 'views/theme/tokens.css'), 'utf8'));
const shell = strip(readFileSync(path.join(dir, 'app/app.css'), 'utf8'));

/** Every rule as [selector, declarations], at any @media depth. */
function rules(css: string): Array<[string, string]> {
  return [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((match) => [(match[1] ?? '').trim().replace(/\s+/g, ' '), match[2] ?? '']);
}
const declared = (declarations: string) => [...declarations.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1] as string);
const isPublic = (name: string) => name.startsWith('--agui-');

test('no generic token is declared on :root, in any mode: only the namespaced public properties are', () => {
  const onRoot = rules(tokens).filter(([selector]) => /^:root(?::not\(\[data-theme="light"\]\)|\[data-theme="dark"\])?$/.test(selector));
  assert.ok(onRoot.length >= 3, 'the light defaults and both dark rules sit on :root');
  for (const [selector, body] of onRoot) {
    for (const name of declared(body)) assert.ok(isPublic(name), `${selector} declares ${name}, which a host page could also define`);
  }
});

test('every generic derived token, and each dark variant of one, is declared on #root', () => {
  const onMount = rules(tokens).filter(([selector]) => /(^|\s)#root$/.test(selector));
  assert.deepEqual(
    onMount.map(([selector]) => selector),
    ['#root', ':root:not([data-theme="light"]) #root', ':root[data-theme="dark"] #root'],
  );
  const [light, auto, forced] = onMount.map(([, body]) => body);
  for (const name of ['--bg', '--fg', '--muted', '--acc', '--r', '--sunk', '--line', '--u', '--pop', '--l-fam', '--l-sem']) {
    assert.ok(declared(light ?? '').includes(name), `${name} is declared on #root`);
  }
  for (const body of [auto, forced]) {
    assert.deepEqual(declared(body ?? '').sort(), ['--l-fam', '--l-sem', '--pop']);
  }
  assert.equal((auto ?? '').replace(/\s+/g, ''), (forced ?? '').replace(/\s+/g, ''), 'the two dark rules agree');
});

test('the shell paints its background, text and font on #root, not on body or html', () => {
  const byName = (name: string) => rules(shell).filter(([selector]) => selector === name);
  const mount = byName('#root').map(([, body]) => body).join(';');
  assert.match(mount, /background:\s*var\(--bg\)/);
  assert.match(mount, /color:\s*var\(--fg\)/);
  assert.match(mount, /font:\s*400 13px\/1\.5 var\(--agui-font-sans\)/);
  for (const [selector, body] of rules(shell)) {
    if (/(^|,\s*)(html|body)\b/.test(selector)) {
      assert.doesNotMatch(body, /var\(--(?!agui-)[a-z-]+\)|(^|[;\s])(background|color|font)\s*:/, `${selector} consumes no inspector token and paints nothing`);
    }
  }
});

test('the stylesheets still ask for nothing outside the bundle', () => {
  assert.doesNotMatch(tokens + shell, /@import|@font-face|url\(|image-set\(/i);
});
