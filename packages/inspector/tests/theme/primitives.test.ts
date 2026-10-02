// F06 T053/T054: component logic of the shared view primitives. Rendering is static (no DOM library
// is installed); the Playwright theme spec covers real styling, focus and native popover/dialog.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CodeBlock,
  Dialog,
  Editor,
  FamilyDot,
  Field,
  FilterChip,
  Finding,
  Icon,
  Label,
  Popover,
  SearchField,
  SegmentedControl,
  Switch,
  TOAST_MS,
  Tag,
  ToastRegion,
  icons,
  popoverPosition,
  tokenizeJson,
} from '../../src/views/theme/primitives';

const html = (element: ReactElement) => renderToStaticMarkup(element);
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
/** Primitives without hooks are plain functions: call one to read the element it returns. */
const props = <P>(element: ReactElement): P => element.props as P;

test('Button defaults to a plain type="button" and maps variants and size to classes', () => {
  assert.match(html(createElement(Button, null, 'Go')), /^<button type="button" class="agui-btn">Go<\/button>$/);
  const primary = html(createElement(Button, { variant: 'primary', small: true }, 'Go'));
  assert.match(primary, /class="agui-btn agui-btn--primary agui-btn--small"/);
  assert.match(html(createElement(Button, { variant: 'ghost' }, 'Go')), /agui-btn--ghost/);
  assert.match(html(createElement(Button, { disabled: true }, 'Go')), /disabled=""/);
  assert.match(html(createElement(Button, { type: 'submit' }, 'Go')), /type="submit"/);
});

test('an icon-only Button carries its accessible name, and the type system demands one', () => {
  const markup = html(createElement(Button, { iconOnly: true, 'aria-label': 'Send', variant: 'primary' }, createElement(Icon, { name: 'send' })));
  assert.match(markup, /aria-label="Send"/);
  assert.match(markup, /agui-btn--icon/);
  assert.match(markup, /<svg[^>]*aria-hidden="true"/);
  // @ts-expect-error an icon-only button without aria-label is a type error
  createElement(Button, { iconOnly: true }, createElement(Icon, { name: 'send' }));
});

test('Tag renders each variant and an optional pulse that carries no text of its own', () => {
  for (const variant of ['line', 'dashed', 'accent', 'ok', 'warn', 'err'] as const) {
    assert.match(html(createElement(Tag, { variant }, 'x')), new RegExp(`agui-tag agui-tag--${variant}`));
  }
  assert.equal(html(createElement(Tag, null, 'x')), '<span class="agui-tag">x</span>');
  assert.equal(html(createElement(Tag, { variant: 'neutral' }, 'x')), '<span class="agui-tag">x</span>', 'neutral is the base look');
  const live = html(createElement(Tag, { variant: 'accent', pulse: true }, 'Streaming'));
  assert.match(live, /<span class="agui-pulse" aria-hidden="true"><\/span>Streaming/);
});

test('FamilyDot names its family, can be hollow, and is hidden from assistive technology', () => {
  assert.equal(html(createElement(FamilyDot, { family: 'tool' })), '<span class="agui-dot" data-family="tool" aria-hidden="true"></span>');
  assert.match(html(createElement(FamilyDot, { family: 'neutral', hollow: true })), /class="agui-dot agui-dot--hollow" data-family="neutral"/);
});

test('FilterChip exposes pressed state, optional family dot and count, and disabled', () => {
  const on = html(createElement(FilterChip, { pressed: true, family: 'text', count: 12 }, 'Text'));
  assert.match(on, /aria-pressed="true"/);
  assert.match(on, /data-family="text"/);
  assert.match(on, /<span class="agui-count">12<\/span>/);
  const off = html(createElement(FilterChip, { pressed: false, disabled: true }, 'Issues'));
  assert.match(off, /aria-pressed="false"/);
  assert.match(off, /disabled=""/);
  assert.doesNotMatch(off, /agui-count|agui-dot/);
  // a count of zero is still shown: "0" is information
  assert.match(html(createElement(FilterChip, { pressed: false, count: 0 }, 'Issues')), /<span class="agui-count">0<\/span>/);
});

test('Card composes header, body and footer, and the interrupt variant adds one class', () => {
  const card = html(
    createElement(Card, null, createElement(CardHeader, null, 'h'), createElement(CardBody, null, 'b'), createElement(CardFooter, null, 'f')),
  );
  assert.equal(
    card,
    '<div class="agui-card"><div class="agui-card-h">h</div><div class="agui-card-b">b</div><div class="agui-card-f">f</div></div>',
  );
  assert.match(html(createElement(Card, { interrupt: true })), /class="agui-card agui-card--interrupt"/);
});

test('tokenizeJson splits keys, strings, numbers, literals and punctuation, and loses no byte', () => {
  const text = '{\n  "a": [1, -2.5e3, true, null],\n  "b": "x\\"y"\n}';
  const tokens = tokenizeJson(text);
  assert.equal(tokens.map((token) => token.text).join(''), text);
  const kinds = (kind: string) => tokens.filter((token) => token.kind === kind).map((token) => token.text);
  assert.deepEqual(kinds('key'), ['"a"', '"b"']);
  assert.deepEqual(kinds('string'), ['"x\\"y"']);
  assert.deepEqual(kinds('number'), ['1', '-2.5e3']);
  assert.deepEqual(kinds('literal'), ['true', 'null']);
  assert.ok(kinds('punct').includes('{') && kinds('punct').includes(':') && kinds('punct').includes(','));
});

test('tokenizeJson keeps text that is not JSON exactly as received', () => {
  for (const text of ['', 'data: not json', '{"open": ', '\u0000\ud800 <b>&amp;</b> "unterminated', '   \n\t']) {
    assert.equal(tokenizeJson(text).map((token) => token.text).join(''), text);
  }
});

test('CodeBlock highlights JSON, leaves raw text alone, escapes markup and is keyboard scrollable', () => {
  const json = html(createElement(CodeBlock, { format: 'json', text: '{"k": "<b>v</b>"}' }));
  assert.match(json, /<span class="agui-j-k">&quot;k&quot;<\/span>/);
  assert.doesNotMatch(json, /<b>/);
  assert.equal(textOf(json), '{"k": "<b>v</b>"}');
  const raw = html(createElement(CodeBlock, { format: 'raw', text: 'event: x\n{"k":1}' }));
  assert.doesNotMatch(raw, /agui-j-/);
  assert.equal(textOf(raw), 'event: x\n{"k":1}');
  assert.match(raw, /tabindex="0"/);
  assert.match(html(createElement(CodeBlock, { text: '1', 'aria-label': 'Request body' })), /aria-label="Request body"/);
});

test('SegmentedControl is a labelled group whose options carry aria-pressed and report their value', () => {
  const changes: string[] = [];
  const element = SegmentedControl({
    label: 'Message mode',
    value: 'turn',
    options: [
      { value: 'full', label: 'Full' },
      { value: 'turn', label: 'Turn' },
    ],
    onChange: (value) => changes.push(value),
  });
  const markup = html(element);
  assert.match(markup, /role="group" aria-label="Message mode"/);
  assert.match(markup, /aria-pressed="false"[^>]*>Full/);
  assert.match(markup, /aria-pressed="true"[^>]*>Turn/);
  const buttons = props<{ children: Array<ReactElement> }>(element).children;
  props<{ onClick: () => void }>(buttons[0] as ReactElement).onClick();
  assert.deepEqual(changes, ['full']);
});

test('Switch is a role="switch" with aria-checked and reports the opposite value on click', () => {
  const seen: boolean[] = [];
  const off = Switch({ checked: false, 'aria-label': 'Render A2UI', onChange: (value) => seen.push(value) });
  assert.match(html(off), /role="switch" aria-checked="false" aria-label="Render A2UI"/);
  props<{ onClick: () => void }>(off).onClick();
  const on = Switch({ checked: true, 'aria-label': 'Render A2UI', onChange: (value) => seen.push(value) });
  assert.match(html(on), /aria-checked="true"/);
  props<{ onClick: () => void }>(on).onClick();
  assert.deepEqual(seen, [true, false]);
  assert.match(html(Switch({ checked: false, disabled: true, 'aria-label': 'x', onChange: () => {} })), /disabled=""/);
});

test('Field, SearchField and Editor mark an invalid value for assistive technology', () => {
  assert.doesNotMatch(html(createElement(Field, { 'aria-label': 'Header' })), /aria-invalid/);
  assert.match(html(createElement(Field, { 'aria-label': 'Header', invalid: true })), /aria-invalid="true"/);
  assert.match(html(createElement(Editor, { 'aria-label': 'Payload', invalid: true, defaultValue: '{}' })), /<textarea[^>]*aria-invalid="true"/);
  assert.match(html(createElement(Editor, { 'aria-label': 'Payload' })), /spellcheck="false"/i);
  const search = html(createElement(SearchField, { 'aria-label': 'Filter frames', placeholder: 'Filter' }));
  assert.match(search, /<input[^>]*type="search"[^>]*aria-label="Filter frames"/);
  assert.match(search, /<svg/);
});

test('Finding pairs its color with an icon and a bold kind, so color is never the only signal', () => {
  for (const variant of ['neutral', 'warn', 'err'] as const) {
    const markup = html(createElement(Finding, { variant, kind: 'Schema', children: 'type is required' }));
    assert.match(markup, new RegExp(`agui-finding agui-finding--${variant}`));
    assert.match(markup, /<svg/);
    assert.match(markup, /<b>Schema<\/b>/);
  }
  assert.doesNotMatch(html(createElement(Finding, { children: 'plain' })), /<b>/);
  assert.match(html(createElement(Finding, { icon: 'branch', children: 'x' })), /<svg/);
});

test('Label renders a span, or a label when it names a control', () => {
  assert.equal(html(createElement(Label, null, 'Preset')), '<span class="agui-label">Preset</span>');
  assert.equal(html(createElement(Label, { htmlFor: 'q' }, 'Search')), '<label class="agui-label" for="q">Search</label>');
});

test('Icon draws the 24-grid, 1.8-stroke set inline and every named icon has geometry', () => {
  const markup = html(createElement(Icon, { name: 'check', size: 15 }));
  assert.match(markup, /viewBox="0 0 24 24"/);
  assert.match(markup, /stroke-width="1.8"/);
  assert.match(markup, /stroke-linecap="round"/);
  assert.match(markup, /width="15" height="15"/);
  assert.ok(Object.keys(icons).length >= 20);
  for (const [name, geometry] of Object.entries(icons)) assert.match(geometry, /^<(path|circle|rect)/, `${name} has shapes`);
  assert.doesNotMatch(Object.values(icons).join(''), /href|<script|on[a-z]+=/i);
});

test('Popover is a native popover element addressed by id', () => {
  const markup = html(createElement(Popover, { id: 'agent-picker', 'aria-label': 'Agent' }, createElement('p', null, 'inside')));
  assert.match(markup, /^<div popover="" id="agent-picker" class="agui-pop" aria-label="Agent">/);
});

test('popoverPosition sits 6 px under the trigger and stays inside a 16 px viewport margin', () => {
  assert.deepEqual(popoverPosition({ left: 100, bottom: 40 }, 1200), { top: 46, left: 100 });
  assert.deepEqual(popoverPosition({ left: 1100, bottom: 40 }, 1200), { top: 46, left: 1200 - 340 - 16 });
  assert.deepEqual(popoverPosition({ left: -20, bottom: 40 }, 1200), { top: 46, left: 16 });
  // narrow viewport: the popover shrinks to viewport minus gutters, so it still starts at the gutter
  assert.deepEqual(popoverPosition({ left: 200, bottom: 40 }, 360), { top: 46, left: 16 });
});

test('Dialog renders a closed native dialog named by its title, with a footer slot', () => {
  const markup = html(createElement(Dialog, { open: false, title: 'Export this session?', onClose: () => {}, footer: 'buttons', children: 'body' }));
  assert.match(markup, /^<dialog class="agui-dialog" aria-labelledby="[^"]+">/);
  assert.doesNotMatch(markup, /\sopen(=|>)/, 'opening is done by showModal(), never by the open attribute');
  assert.match(markup, /<h2[^>]*>Export this session\?<\/h2>/);
  assert.match(markup, /class="agui-dialog-f">buttons</);
});

test('ToastRegion is an always-present polite live region that lists its toasts', () => {
  assert.equal(TOAST_MS, 3200);
  assert.equal(html(createElement(ToastRegion, { toasts: [] })), '<div class="agui-toasts" aria-live="polite"></div>');
  const markup = html(createElement(ToastRegion, { toasts: [{ id: 1, text: 'Token cleared.' }, { id: 2, text: 'Copied.' }] }));
  assert.match(markup, /aria-live="polite"/);
  assert.equal(textOf(markup), 'Token cleared.Copied.');
});

test('primitives pass unknown attributes through but own their class names', () => {
  const markup = html(createElement(Tag, { id: 't1', title: 'Thread id', className: 'host-class' } as never, 'x'));
  assert.match(markup, /id="t1"/);
  assert.match(markup, /title="Thread id"/);
  assert.doesNotMatch(markup, /host-class/, 'views style through variants, never around the primitive');
});
