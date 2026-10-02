// F06 T052/T053: the stylesheets as executable checks. FR-041 (everything from --agui-* tokens) and
// FR-037 (nothing loaded from outside the bundle) are properties of the CSS text, so they are checked
// on the text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const dir = path.join(process.cwd(), 'packages/inspector/src/views/theme');
const tokens = readFileSync(path.join(dir, 'tokens.css'), 'utf8');
const primitives = readFileSync(path.join(dir, 'primitives.css'), 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector (whitespace-normalised) is `selector`. */
function rule(css: string, selector: string): string {
  const flat = strip(css);
  const wanted = selector.replace(/\s+/g, ' ');
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = pattern.exec(flat); match; match = pattern.exec(flat)) {
    if ((match[1] ?? '').trim().replace(/\s+/g, ' ') === wanted) return match[2] ?? '';
  }
  assert.fail(`no rule for ${selector}`);
}

const publicProperties = [
  '--agui-accent',
  '--agui-accent-contrast',
  '--agui-tint-hue',
  '--agui-tint-chroma',
  '--agui-bg',
  '--agui-fg',
  '--agui-radius',
  '--agui-density',
  '--agui-font-sans',
  '--agui-font-mono',
];

test('tokens.css defines the ten public properties with the documented light defaults', () => {
  const root = rule(tokens, ':root');
  for (const property of publicProperties) assert.match(root, new RegExp(`${property}\\s*:`), `${property} is defined`);
  assert.match(root, /--agui-tint-hue:\s*75\s*;/);
  assert.match(root, /--agui-tint-chroma:\s*0\.006\s*;/);
  assert.match(root, /--agui-bg:\s*oklch\(0\.993 calc\(var\(--agui-tint-chroma\) \* 0\.6\) var\(--agui-tint-hue\)\)/);
  assert.match(root, /--agui-fg:\s*oklch\(0\.235 calc\(var\(--agui-tint-chroma\) \* 2\.2\) var\(--agui-tint-hue\)\)/);
  assert.match(root, /--agui-accent:\s*var\(--agui-fg\)/);
  assert.match(root, /--agui-accent-contrast:\s*var\(--agui-bg\)/);
  assert.match(root, /--agui-radius:\s*8px/);
  assert.match(root, /--agui-density:\s*1\s*;/);
  assert.match(root, /color-scheme:\s*light/);
});

test('default fonts are the documented system stacks and no stack names a webfont', () => {
  const root = rule(tokens, ':root');
  assert.match(root, /--agui-font-sans:\s*ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;/);
  assert.match(root, /--agui-font-mono:\s*ui-monospace, "SF Mono", Menlo, Consolas, monospace;/);
  assert.doesNotMatch(root, /Geist|Plex|Instrument|JetBrains|Inter\b/);
});

test('dark mode follows prefers-color-scheme and data-theme, and redefines only background and text colors', () => {
  const css = strip(tokens);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{/);
  const auto = rule(css.slice(css.indexOf('@media (prefers-color-scheme: dark)')), ':root:not([data-theme="light"])');
  const forced = rule(tokens, ':root[data-theme="dark"]');
  for (const dark of [auto, forced]) {
    assert.match(dark, /--agui-bg:\s*oklch\(0\.175 calc\(var\(--agui-tint-chroma\) \* 1\.2\) var\(--agui-tint-hue\)\)/);
    assert.match(dark, /--agui-fg:\s*oklch\(0\.93 calc\(var\(--agui-tint-chroma\) \* 1\.2\) var\(--agui-tint-hue\)\)/);
    assert.match(dark, /color-scheme:\s*dark/);
    for (const property of publicProperties.filter((name) => !/-(bg|fg)$/.test(name))) {
      assert.doesNotMatch(dark, new RegExp(`${property}\\s*:`), `${property} works in both themes and is not redefined for dark`);
    }
  }
  assert.equal(auto.replace(/\s+/g, ''), forced.replace(/\s+/g, ''), 'the two dark rules agree');
});

test('derived tokens exist and mix from the public properties', () => {
  const root = rule(tokens, '#root');
  for (const token of [
    '--sunk', '--hover', '--line', '--line-2', '--muted', '--faint', '--acc-ink', '--acc-soft', '--acc-line',
    '--err', '--warn', '--ok', '--err-soft', '--warn-soft', '--ok-soft',
    '--f-text', '--f-tool', '--f-reason', '--f-state', '--f-activity', '--f-neutral',
    '--u', '--r', '--r-sm', '--r-xs', '--ease',
  ]) {
    assert.match(root, new RegExp(`${token}\\s*:`), `${token} is derived`);
  }
  assert.match(root, /--u:\s*calc\(4px \* var\(--agui-density\)\)/);
  assert.match(root, /--r-sm:\s*calc\(var\(--agui-radius\) \* 0\.7\)/);
  assert.match(root, /--r-xs:\s*calc\(var\(--agui-radius\) \* 0\.45\)/);
  assert.match(root, /--sunk:\s*color-mix\(in oklab, var\(--agui-fg\) 4%, var\(--agui-bg\)\)/);
  assert.match(root, /--ease:\s*cubic-bezier\(\.16, 1, \.3, 1\)/);
});

test('nothing in either stylesheet loads a font or any other asset from outside the bundle', () => {
  for (const [name, css] of [['tokens.css', tokens], ['primitives.css', primitives]] as const) {
    const text = strip(css);
    assert.doesNotMatch(text, /@import|@font-face|url\(|image-set\(|src\s*:/i, `${name} requests nothing`);
    assert.doesNotMatch(text, /https?:|\/\/[a-z]/i, `${name} names no remote host`);
  }
});

test('primitives take every color, radius and font from tokens', () => {
  const css = strip(primitives);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'no hex colors');
  assert.doesNotMatch(css, /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i, 'no literal color functions');
  assert.doesNotMatch(css, /\b(white|black|red|green|blue|gray|grey)\b\s*[;}]/i, 'no named colors');
  for (const [, value] of css.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/g)) {
    assert.match(value ?? '', /^(0|50%|999px|var\(--r(-sm|-xs)?\)|calc\(var\(--r(-sm)?\) \* [\d.]+\))$/, `radius ${value} comes from the scale`);
  }
  for (const [, value] of css.matchAll(/font(?:-family)?\s*:\s*([^;}]+)/g)) {
    assert.match(value ?? '', /inherit|var\(--agui-font-(sans|mono)\)/, `font ${value} comes from the font tokens`);
  }
});

test('primitives scale their spacing with the density token', () => {
  const css = strip(primitives);
  // padding, gap and margin may use 0, 1px hairlines and px nudges only inside a calc() on --u
  for (const [, value] of css.matchAll(/(?:^|[;{\s])(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;}]+)/g)) {
    for (const part of (value ?? '').split(/\s+(?![^(]*\))/)) {
      assert.match(part, /^(0|auto|-?calc\(.*var\(--u\).*\)|var\(--[a-z-]+\)|inherit)$/, `spacing ${part} is a multiple of --u`);
    }
  }
});

test('focus is visible and reduced motion switches every animation and transition off', () => {
  const css = strip(primitives);
  const focus = css.match(/:focus-visible\s*\{([^}]*)\}/);
  assert.ok(focus, 'a :focus-visible rule exists');
  assert.match(focus[1] ?? '', /outline:\s*2px solid color-mix\(in oklab, var\(--acc\) 55%, transparent\)/);
  assert.match(focus[1] ?? '', /outline-offset:\s*1px/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /animation:\s*none !important/);
  assert.match(reduced, /transition:\s*none !important/);
  // The only outline removal is the input inside a search field, whose wrapper shows the ring.
  assert.doesNotMatch(css.replace(/\.agui-search input\s*\{[^}]*\}/, ''), /outline\s*:\s*(none|0)\b/, 'no other rule removes an outline');
  assert.match(rule(primitives, '.agui-search:focus-within'), /outline:\s*2px solid/);
});
