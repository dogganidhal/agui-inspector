// The brand mark is drawn in four places: the in-app icon, branding/mark.svg, branding/icon.svg and the
// favicon inlined in each page. They must stay one glyph, so a change to one has to change them all.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { icons } from '../../src/views/theme/primitives';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const DATA_URI = 'data:image/svg+xml,';

test('every copy of the brand mark draws the same glyph', () => {
  assert.ok(read('branding/mark.svg').includes(icons.mark), 'branding/mark.svg');
  const icon = read('branding/icon.svg');
  assert.ok(icon.includes(icons.mark), 'branding/icon.svg');
  for (const page of ['packages/inspector/src/app/index.html', 'demo/index.html']) {
    const href = read(page).match(/<link rel="icon" type="image\/svg\+xml" href="([^"]*)"/)?.[1];
    assert.ok(href !== undefined && href.startsWith(DATA_URI), `${page} has an inline SVG favicon`);
    assert.equal(decodeURIComponent(href.slice(DATA_URI.length)), icon.trim(), `${page} favicon is branding/icon.svg`);
  }
});
