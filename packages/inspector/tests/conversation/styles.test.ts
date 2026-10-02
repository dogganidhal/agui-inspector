// L03 (FR-037, FR-041): the conversation stylesheet is checked as text, like F06's: every color, radius
// and font comes from the theme tokens, spacing scales with density, and nothing is fetched from outside.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const css = readFileSync(path.join(process.cwd(), 'packages/inspector/src/views/conversation/conversation.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('the stylesheet takes every color, radius and font from the tokens', () => {
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'no hex colors');
  assert.doesNotMatch(css, /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i, 'no literal color functions');
  assert.doesNotMatch(css, /\b(white|black|red|green|blue|gray|grey)\b\s*[;}]/i, 'no named colors');
  for (const [, value] of css.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/g)) {
    assert.match(value ?? '', /^(0|50%|var\(--r(-sm|-xs)?\))$/, `radius ${value} comes from the scale`);
  }
  for (const [, value] of css.matchAll(/font(?:-family)?\s*:\s*([^;}]+)/g)) {
    assert.match(value ?? '', /inherit|var\(--agui-font-(sans|mono)\)/, `font ${value} comes from the font tokens`);
  }
});

test('spacing is a multiple of --u, apart from the 16 px edge gutter the design fixes', () => {
  for (const [, value] of css.matchAll(/(?:^|[;{\s])(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;}]+)/g)) {
    for (const part of (value ?? '').split(/\s+(?![^(]*\))/)) {
      assert.match(part, /^(0|auto|16px|-?calc\(.*var\(--u\).*\)|var\(--[a-z-]+\)|inherit)$/, `spacing ${part} is a multiple of --u`);
    }
  }
});

test('the stylesheet requests nothing from outside the bundle and defines no tokens of its own', () => {
  assert.doesNotMatch(css, /@import|@font-face|url\(|image-set\(|src\s*:/i);
  assert.doesNotMatch(css, /https?:|\/\/[a-z]/i);
  assert.doesNotMatch(css, /(?:^|[;{\s])--[a-z-]+\s*:/, 'derived tokens are F06’s; this lane adds none');
});

test('every class is namespaced so a host page cannot collide with it', () => {
  for (const [, name] of css.matchAll(/\.([a-z][\w-]*)/g)) assert.match(name ?? '', /^agui-/, `.${name}`);
});
