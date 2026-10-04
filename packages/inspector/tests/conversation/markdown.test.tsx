// Spec 012: Markdown on demand in the conversation. Everything here runs without a DOM, because the view builds React
// elements and never an HTML string: constructs, the safety rules against a list of hostile samples, the scope (which
// text), the length limit and failure notes, and the cost on the 5,000-frame workload. What needs a browser (policy
// violations, requests, focus, the recording around a toggle) is in tests/e2e/conversation/markdown*.spec.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { Fragment, createElement, type ReactNode } from 'react';
import { EventSchemas } from '@ag-ui/core/schemas';
import { renderToStaticMarkup } from 'react-dom/server';
import { eventFixtures } from '../../../../examples/reference-agent/protocol-fixtures.ts';
import { MARKDOWN_REPLY, markdownRunResponse } from '../../../../examples/reference-agent/scenarios.ts';
import { generateFixture } from '../../../../tests/benchmarks/generate.ts';
import { projectConversation, type ConversationEntry, type MessageEntry, type ReasoningEntry } from '../../src/core/projection/index.ts';
import { ConversationView } from '../../src/views/conversation/index.tsx';
import { ConversationText, FAILED_NOTE, MARKDOWN_LIMIT, MarkdownModeProvider, TOO_LONG_NOTE, format, safeLink, type TextMode } from '../../src/views/conversation/markdown.tsx';
import { HOSTILE } from './hostile.ts';
import { RUN_FINISHED, RUN_STARTED, harness, sessionOf } from './support.ts';

const render = (node: ReactNode): string => renderToStaticMarkup(createElement(Fragment, null, node));
const inMode = (mode: TextMode, text: string, role?: string): string =>
  renderToStaticMarkup(createElement(MarkdownModeProvider, { value: mode }, createElement(ConversationText, { text, ...(role !== undefined && { role }) })));
const md = (text: string, role = 'assistant'): string => inMode('markdown', text, role);

// ---- the control and the default ----

function scripted() {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  [RUN_STARTED, { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: '*not* formatted' }, { type: 'TEXT_MESSAGE_END', messageId: 'm1' }, RUN_FINISHED].forEach((event, i) => h.push('ex1', event, (i + 1) * 10));
  h.close('ex1');
  return h;
}
const view = (h: ReturnType<typeof harness>) =>
  renderToStaticMarkup(
    createElement(ConversationView, { store: h.store, interrupts: [], toolResults: [], onDraftInterrupt() {}, onAnswerInterrupt() {}, onDraftToolResult() {}, onSubmitToolResult() {}, onContinue() {} }),
  );

test('a fresh conversation is plain text, with the control labelled and Plain text pressed', () => {
  const html = view(scripted());
  assert.match(html, /<section [^>]*data-view="conversation"[^>]*data-text-mode="plain"/);
  assert.match(html, /<div class="agui-seg" role="group" aria-label="Message text"><button type="button" class="agui-seg-opt" aria-pressed="true">Plain text<\/button><button type="button" class="agui-seg-opt" aria-pressed="false">Markdown<\/button><\/div>/);
  assert.match(html, /<div class="agui-conv-body">\*not\* formatted<\/div>/, 'the message is the bare received text, as before');
});

test('the control is there before the first message too', () => {
  const html = view(harness());
  assert.match(html, /aria-label="Message text"/);
  assert.match(html, /No conversation yet/);
});

test('plain mode and a view without a provider add nothing around the text', () => {
  const text = '# not a heading\n\n<b>raw</b> and *stars*';
  assert.equal(inMode('plain', text, 'assistant'), render(text));
  assert.equal(renderToStaticMarkup(createElement(ConversationText, { text, role: 'assistant' })), render(text));
});

// ---- constructs ----

test('paragraphs, emphasis, strong, strikethrough and inline code', () => {
  assert.equal(md('Hello *world* and **you** and ~~them~~ and `x < y`'), '<div class="agui-md"><p>Hello <em>world</em> and <strong>you</strong> and <del>them</del> and <code>x &lt; y</code></p></div>');
});

test('headings start at h3 and stop at h6', () => {
  const html = md('# a\n## b\n### c\n#### d\n##### e\n###### f');
  assert.deepEqual([...html.matchAll(/<(h\d)>(\w)<\/h\d>/g)].map((m) => `${m[1]}${m[2]}`), ['h3a', 'h4b', 'h5c', 'h6d', 'h6e', 'h6f']);
  assert.doesNotMatch(html, /<h[12]/);
});

test('fenced code with and without a language, and indented code, are focusable labelled blocks', () => {
  assert.match(md('```ts\nconst a = 1;\n```'), /<pre class="agui-code" tabindex="0" role="region" aria-label="Code, ts">const a = 1;<\/pre>/);
  assert.match(md('```\nplain\n```'), /aria-label="Code">plain<\/pre>/);
  assert.match(md('    indented <b>'), /aria-label="Code">indented &lt;b&gt;<\/pre>/);
  assert.match(md('```' + 'x'.repeat(200) + '\ncode\n```'), /aria-label="Code, x{40}"/, 'a long info string is cut');
});

test('block quotes, lists, tight and loose', () => {
  assert.equal(md('> quoted'), '<div class="agui-md"><blockquote><p>quoted</p></blockquote></div>');
  assert.equal(md('- a\n- b'), '<div class="agui-md"><ul><li>a</li><li>b</li></ul></div>');
  assert.equal(md('- a\n\n- b'), '<div class="agui-md"><ul><li><p>a</p></li><li><p>b</p></li></ul></div>');
  assert.equal(md('1. a\n2. b'), '<div class="agui-md"><ol><li>a</li><li>b</li></ol></div>');
  assert.match(md('3. a\n4. b'), /<ol start="3">/);
  assert.match(md('0. a'), /<ol start="0">/);
});

test('rules and line breaks', () => {
  assert.match(md('a\n\n---\n\nb'), /<p>a<\/p><hr\/><p>b<\/p>/);
  assert.match(md('a  \nb'), /<p>a<br\/>b<\/p>/);
  assert.match(md('a\nb'), /<p>a\nb<\/p>/, 'a single newline stays a newline, which wraps like a space');
});

test('a table scrolls in its own focusable box and its alignment is an attribute, never a style', () => {
  const html = md('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
  assert.match(html, /<div class="agui-md-scroll" tabindex="0" role="region" aria-label="Table"><table><thead><tr><th data-align="left">a<\/th><th data-align="center">b<\/th><th data-align="right">c<\/th><\/tr><\/thead><tbody><tr><td data-align="left">1<\/td>/);
  assert.doesNotMatch(html, /style=/);
  assert.doesNotMatch(md('| a |\n|---|\n| 1 |'), /data-align/);
});

test('constructs the view does not support stay as typed', () => {
  assert.match(md('<b>x</b> and <img src=x>'), /<p>&lt;b&gt;x&lt;\/b&gt; and &lt;img src=x&gt;<\/p>/);
  assert.equal(md('see https://example.test/x now'), '<div class="agui-md"><p>see https://example.test/x now</p></div>');
  assert.match(md('- [ ] task\n- [x] done'), /<li>\[ \] task<\/li><li>\[x\] done<\/li>/);
  assert.match(md('"quotes" -- and ... stay'), /&quot;quotes&quot; -- and \.\.\. stay/, 'no typographic replacement');
});

// ---- scope: which text ----

test('role tool, an unknown role and empty text stay plain; reasoning, which has no role, formats', () => {
  assert.equal(md('{"a": *1*}', 'tool'), render('{"a": *1*}'));
  assert.equal(md('*x*', 'mystery'), render('*x*'));
  assert.equal(md('', 'assistant'), '');
  for (const role of ['assistant', 'user', 'system', 'developer']) assert.match(md('*x*', role), /<em>x<\/em>/, role);
  assert.match(inMode('markdown', '**why**'), /<strong>why<\/strong>/);
});

/** The message and reasoning entries a scripted run projects to, anywhere in the tree. */
function textEntries(entries: readonly ConversationEntry[]): (MessageEntry | ReasoningEntry)[] {
  return entries.flatMap((entry) => (entry.kind === 'message' || entry.kind === 'reasoning' ? [entry] : entry.kind === 'step' ? textEntries(entry.children) : []));
}
const textOf = (entry: MessageEntry | ReasoningEntry) => ({ mode: (mode: TextMode) => inMode(mode, entry.text, entry.kind === 'message' ? entry.role : undefined) });

test('messages that came through a MESSAGES_SNAPSHOT format, except a tool message', () => {
  const session = sessionOf([
    RUN_STARTED,
    { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: '_snap_' }, { id: 'a1', role: 'assistant', content: '> quote' }, { id: 'tool1', role: 'tool', toolCallId: 'no-such-call', content: '{"k":*1*}' }] },
    RUN_FINISHED,
  ]);
  const byId = new Map(textEntries(projectConversation(session).entries).map((entry) => [entry.messageId, entry]));
  assert.match(textOf(byId.get('u1')!).mode('markdown'), /<em>snap<\/em>/);
  assert.match(textOf(byId.get('a1')!).mode('markdown'), /<blockquote>/);
  const tool = byId.get('tool1')!;
  assert.equal(tool.kind === 'message' && tool.role, 'tool');
  assert.equal(textOf(tool).mode('markdown'), render(tool.text), 'a tool message stays plain');
  for (const entry of byId.values()) assert.equal(textOf(entry).mode('plain'), render(entry.text));
});

test('streamed text, chunk text and reasoning text format as they were received', () => {
  const fx = eventFixtures;
  const session = sessionOf([
    RUN_STARTED,
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: '# Ti' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'tle\n\n- *a*' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    { type: 'TEXT_MESSAGE_CHUNK', messageId: 'm2', role: 'assistant', delta: '**chunk**' },
    fx.REASONING_START,
    fx.REASONING_MESSAGE_START,
    { ...fx.REASONING_MESSAGE_CONTENT, delta: '`why`' },
    fx.REASONING_MESSAGE_END,
    fx.REASONING_END,
    RUN_FINISHED,
  ]);
  const byId = new Map(textEntries(projectConversation(session).entries).map((entry) => [entry.messageId, entry]));
  assert.match(textOf(byId.get('m1')!).mode('markdown'), /<h3>Title<\/h3><ul><li><em>a<\/em><\/li><\/ul>/, 'deltas are joined before they are formatted');
  assert.match(textOf(byId.get('m2')!).mode('markdown'), /<strong>chunk<\/strong>/);
  assert.match(textOf(byId.get('rs1')!).mode('markdown'), /<code>why<\/code>/);
  for (const entry of byId.values()) assert.equal(textOf(entry).mode('plain'), render(entry.text));
});

// ---- the link rule ----

test('only absolute http, https and mailto addresses may open', () => {
  assert.equal(safeLink('https://example.test/a?b=c#d'), 'https://example.test/a?b=c#d');
  assert.equal(safeLink('http://example.test'), 'http://example.test/');
  assert.equal(safeLink('mailto:dev@example.test'), 'mailto:dev@example.test');
  for (const bad of ['', '/relative', '#frag', '//example.test/x', 'ftp://example.test', 'tel:+15550100', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'blob:https://example.test/x', 'example.test', 'https://']) {
    assert.equal(safeLink(bad), undefined, JSON.stringify(bad));
  }
});

test('a link is an anchor that cannot reach back, with its destination printed after it', () => {
  assert.equal(
    md('[docs](https://example.test/a)'),
    '<div class="agui-md"><p><a class="agui-md-link" href="https://example.test/a" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">docs</a> <span class="agui-md-dest">(https://example.test/a)</span></p></div>',
  );
  assert.match(md('[docs][r]\n\n[r]: https://example.test/ref'), /href="https:\/\/example\.test\/ref"/, 'a link reference works as in CommonMark');
  assert.match(md('[mail](mailto:dev@example.test)'), /href="mailto:dev@example\.test"[^>]*>mail<\/a> <span class="agui-md-dest">\(mailto:dev@example\.test\)<\/span>/);
});

test('an angle-bracket address is its own text and prints no second copy', () => {
  const html = md('<https://example.test/x>');
  assert.match(html, /<a [^>]*href="https:\/\/example\.test\/x"[^>]*>https:\/\/example\.test\/x<\/a>/);
  assert.doesNotMatch(html, /agui-md-dest/);
});

test('a link whose text names one site and whose address is another shows both', () => {
  const html = md('[https://bank.example](https://evil.example/login)');
  assert.match(html, />https:\/\/bank\.example<\/a> <span class="agui-md-dest">\(https:\/\/evil\.example\/login\)<\/span>/);
});

test('an address with a look-alike host prints in its parsed form', () => {
  assert.match(md('[x](https://аpple.example/)'), /agui-md-dest">\(https:\/\/xn--pple-43d\.example\/\)/);
});

test('a link that may not open prints its text and its typed address, with no anchor', () => {
  for (const href of ['/relative', '//example.test/x', '#frag', 'ftp://example.test/f', 'tel:+15550100']) {
    const html = md(`[label](${href})`);
    assert.doesNotMatch(html, /<a /, href);
    assert.match(html, new RegExp(`label <span class="agui-md-dest">\\(${href.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\)</span>`), href);
  }
});

test('an image is its alt text and nothing is requested', () => {
  assert.equal(md('![a cat](https://example.test/cat.png)'), '<div class="agui-md"><p><span class="agui-md-inert">[image: a cat]</span></p></div>');
  assert.match(md('![](https://example.test/p.png)'), /\[image\]/);
  const html = md('![t](data:image/png;base64,iVBORw0KGgo=) ![u](//example.test/p.png)');
  assert.doesNotMatch(html, /<img|src=|base64/);
});

// ---- hostile samples ----

const ALLOWED_TAGS = new Set(['div', 'p', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'span']);
const ALLOWED_ATTRIBUTES = new Set(['class', 'href', 'target', 'rel', 'referrerpolicy', 'start', 'data-align', 'tabindex', 'role', 'aria-label']);

test('at least 15 hostile samples', () => assert.ok(HOSTILE.length >= 15));

test('every hostile sample comes out as text or as elements and attributes from a short allowlist', () => {
  for (const sample of HOSTILE) {
    const html = md(sample);
    const label = JSON.stringify(sample.slice(0, 60));
    // Real tags only: text is escaped, so a tag name here is an element the view made.
    for (const [, name, attributes] of html.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g)) {
      assert.ok(ALLOWED_TAGS.has(name!.toLowerCase()), `${label}: <${name}>`);
      for (const [, attribute] of (attributes ?? '').matchAll(/\s([^\s="]+)(?:="[^"]*")?/g)) assert.ok(ALLOWED_ATTRIBUTES.has(attribute!.toLowerCase()), `${label}: ${attribute} on <${name}>`);
    }
    assert.doesNotMatch(html, /<\/?(script|img|iframe|svg|style|object|embed|form|input|link|video|audio|source)\b/i, label);
    for (const [, href] of html.matchAll(/ href="([^"]*)"/g)) assert.match(href!.replace(/&amp;/g, '&'), /^(https?:\/\/|mailto:)/, `${label}: href`);
    assert.ok(html.length < 40_000, `${label}: output stays bounded`);
  }
});

test('raw HTML is text, character for character', () => {
  const raw = '<script>window.__pwned = 1</script>';
  assert.equal(md(raw), `<div class="agui-md"><p>${render(raw)}</p></div>`);
});

test('the view source has no way to write markup or evaluate code', () => {
  const source = readFileSync(path.join(process.cwd(), 'packages/inspector/src/views/conversation/markdown.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|\.render\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB/);
});

// ---- the length limit and failures ----

test('a text at the limit formats and one character more shows plain with a note', () => {
  const at = `**x** ${'a'.repeat(MARKDOWN_LIMIT - 6)}`;
  assert.equal(at.length, MARKDOWN_LIMIT);
  assert.match(md(at), /<strong>x<\/strong>/);
  const over = `${at}b`;
  assert.equal(md(over), `<p class="agui-conv-muted agui-md-note">${TOO_LONG_NOTE}</p>${render(over)}`);
  assert.deepEqual(format(over), { kind: 'plain', note: TOO_LONG_NOTE });
});

test('run-on emphasis that would nest elements thousands deep falls back to plain text', () => {
  const text = `${'*'.repeat(5000)}a${'*'.repeat(5000)}`;
  assert.deepEqual(format(text), { kind: 'plain', note: FAILED_NOTE });
  assert.equal(md(text), `<p class="agui-conv-muted agui-md-note">${FAILED_NOTE}</p>${render(text)}`);
  assert.equal(format('*'.repeat(20) + 'a' + '*'.repeat(20)).kind, 'formatted', 'ordinary nesting is fine');
});

// Five seconds is far above what each takes alone (well under a second) and still fails a quadratic parse on 150,000 characters.
test('input made to be slow still finishes, formatted or plain, within seconds each', () => {
  for (const text of ['['.repeat(150_000), '>'.repeat(150_000), '* '.repeat(75_000), 'a'.repeat(190_000), '`'.repeat(150_000), '[a](b'.repeat(30_000), '_a '.repeat(60_000), '1. '.repeat(60_000), '| a '.repeat(40_000) + '\n' + '|-'.repeat(40_000)]) {
    const started = performance.now();
    const result = format(text);
    const elapsed = performance.now() - started;
    assert.ok(result.kind === 'formatted' || result.kind === 'plain');
    assert.ok(elapsed < 5000, `${JSON.stringify(text.slice(0, 12))} x ${text.length} took ${elapsed.toFixed(0)} ms`);
  }
});

// ---- cost ----

// The bounds below are five times the figures in spec 012 (SC-005): other test files and other workers share the machine, and
// a bound at the measured time would fail on load. They still catch a slowdown of an order of magnitude. The measured figures print.
test('turning Markdown on for the 5,000-frame workload and for a long conversation stays fast, and a text at the limit formats quickly', () => {
  const h = harness();
  for (const exchange of generateFixture()) {
    const id = `bench-${exchange.index}`;
    h.open(id, { input: { threadId: 'bench-thread', runId: exchange.runId } });
    for (const frame of exchange.frames) h.pushWire(id, frame.envelope, 0);
    h.close(id);
  }
  const entries = textEntries(projectConversation(h.session()).entries);
  assert.ok(entries.length > 0, 'the workload has text');

  const started = performance.now();
  let bytes = 0;
  for (const entry of entries) bytes += textOf(entry).mode('markdown').length;
  const elapsed = performance.now() - started;
  console.log(`markdown for ${entries.length} message and reasoning entries of the 5,000-frame workload: ${elapsed.toFixed(1)} ms, ${bytes} bytes of markup`);
  assert.ok(elapsed < 5000, `drawing the workload as Markdown took ${elapsed.toFixed(0)} ms`);

  // The workload's own messages are short, so also draw a long conversation: 1,000 messages of about a kilobyte each.
  // Each figure is the best of a few runs.
  const best = <T,>(runs: number, run: () => T): { value: T; ms: number } => {
    let ms = Infinity;
    let value!: T;
    for (let i = 0; i < runs; i += 1) {
      const begun = performance.now();
      value = run();
      ms = Math.min(ms, performance.now() - begun);
    }
    return { value, ms };
  };
  const kilobyte = 'Some *emphasis*, a [link](https://example.test/x) and `code`.\n\n- one\n- two\n\n'.repeat(14);
  const long = best(3, () => {
    for (let i = 0; i < 1000; i += 1) inMode('markdown', `${kilobyte}${i}`, 'assistant');
  });
  console.log(`markdown for 1,000 messages of ${kilobyte.length} characters: ${long.ms.toFixed(1)} ms`);
  assert.ok(long.ms < 5000, `drawing 1,000 messages took ${long.ms.toFixed(0)} ms`);

  const block = '## Heading\n\n- item *one* with `code` and [a link](https://example.test/a)\n- item **two**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n\nA paragraph with _emphasis_ and more words in it.\n\n';
  const dense = block.repeat(Math.floor(MARKDOWN_LIMIT / block.length));
  assert.ok(dense.length <= MARKDOWN_LIMIT && dense.length > MARKDOWN_LIMIT - block.length);
  const formatted = best(5, () => format(dense));
  console.log(`format of a dense ${dense.length} character message: ${formatted.ms.toFixed(1)} ms`);
  assert.equal(formatted.value.kind, 'formatted');
  assert.ok(formatted.ms < 1000, `formatting at the limit took ${formatted.ms.toFixed(0)} ms`);
});

// ---- the reference agent's Markdown reply ----

test('the reference agent\'s Markdown run is deterministic, valid, and uses every construct the view draws', () => {
  const ids = { threadId: 't-md', runId: 'r-md' };
  const bytes = (response: ReturnType<typeof markdownRunResponse>) => response.chunks.map((chunk) => new TextDecoder().decode(chunk)).join('');
  assert.equal(bytes(markdownRunResponse(ids)), bytes(markdownRunResponse(ids)));
  const events = bytes(markdownRunResponse(ids))
    .split('\n\n')
    .filter((block) => block !== '')
    .map((block) => JSON.parse(block.replace(/^data: /, '')) as { type: string; delta?: string });
  for (const event of events) assert.ok(EventSchemas.safeParse(event).success, event.type);
  assert.deepEqual(events.map((event) => event.type), ['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
  assert.equal(events[2]?.delta, MARKDOWN_REPLY);

  const html = md(MARKDOWN_REPLY);
  for (const piece of ['<h3>Release notes</h3>', '<strong>agent</strong>', '<em>Markdown</em>', '<del>no</del>', '<code>inline code</code>', '<ul>', 'data-align="right"', 'aria-label="Code, ts"', 'agui-md-dest', 'agui-md-inert']) assert.ok(html.includes(piece), piece);
  assert.doesNotMatch(html, /<img|href="javascript/);
});
