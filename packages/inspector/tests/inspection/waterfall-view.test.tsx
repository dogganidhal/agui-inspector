// The waterfall panel as markup (spec 011): rows, bars, words and roles. Kind, state and errors are text in the markup,
// so removing color loses nothing (SC-010). Keys and the browser behavior are in the end-to-end spec.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InspectionSession } from '../../src/contracts.ts';
import { buildWaterfall } from '../../src/core/projection/waterfall.ts';
import { NO_CHOICES, WaterfallPanel, type WaterfallChoices } from '../../src/views/inspection/waterfall.tsx';
import { harness } from '../conversation/support.ts';
import { delegation, flatten, playRun, timed } from './waterfall-support.ts';

const noop = () => undefined;
const panel = (session: InspectionSession, choices: Partial<WaterfallChoices> = {}): ReactElement =>
  createElement(WaterfallPanel, { session, ...NO_CHOICES, ...choices, onSelect: noop, onToggle: noop, onShowFrames: noop });
const html = (session: InspectionSession, choices: Partial<WaterfallChoices> = {}) => renderToStaticMarkup(panel(session, choices));
/** The treeitem elements of the markup, as `[attributes, inner markup]`. */
const items = (markup: string) => [...markup.matchAll(/<div ([^>]*role="treeitem"[^>]*)>(.*?)<\/div>(?=<div|<\/div>)/g)].map((match) => [match[1] as string, match[2] as string] as const);

const RUN = { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' };
const DONE = { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'success' } };

const markup = html(delegation({ subagents: false }));

test('the panel is a labelled tree with a row for each visible row, in order, with its kind word and label', () => {
  assert.match(markup, /<section[^>]*data-view="waterfall"/);
  assert.match(markup, /<h3 id="waterfall-heading">Waterfall<\/h3>/);
  assert.match(markup, /<div role="tree" aria-label="Run waterfall"/);
  const rows = markup.match(/role="treeitem"/g) ?? [];
  assert.equal(rows.length, 10);
  for (const word of ['run', 'step', 'text', 'reasoning', 'tool']) assert.match(markup, new RegExp(`<span class="agui-wf-kind">${word}</span>`));
  for (const label of ['run1', 'plan', 'research', 'answer', 'think-1', 'search_documents', 'pick_color']) assert.match(markup, new RegExp(`class="agui-wf-label"[^>]*>${label}<`));
  assert.match(markup, /class="agui-wf-subject"[^>]*>tc-search</, 'the id of a call shows beside its name');
});

test('levels, set sizes and expanded state follow the nesting, and exactly one row is in the tab order', () => {
  const rows = [...markup.matchAll(/role="treeitem"[^>]*/g)].map((match) => match[0]);
  assert.deepEqual(rows.map((row) => Number(/aria-level="(\d+)"/.exec(row)?.[1])), [1, 2, 3, 3, 2, 3, 3, 2, 3, 3]);
  assert.equal(rows.filter((row) => row.includes('tabindex="0"')).length, 1);
  assert.ok(rows[0]?.includes('tabindex="0"'), 'the first row is the tab stop when nothing is selected');
  assert.ok(rows.every((row) => row.includes('aria-selected="false"')));
  assert.deepEqual(rows.map((row) => /aria-expanded="(\w+)"/.exec(row)?.[1]), ['true', 'true', undefined, undefined, 'true', undefined, undefined, 'true', undefined, undefined]);
  assert.match(rows[0] as string, /aria-posinset="1" aria-setsize="1"|aria-setsize="1"[^>]*aria-posinset="1"/);
});

test('every row has an accessible label with kind, times and state', () => {
  const labels = [...markup.matchAll(/role="treeitem"[^>]*aria-label="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(labels.includes('tool, search_documents, level 3, started +0.520, ended +1.400, 880 ms'));
  assert.ok(labels.includes('tool, pick_color, level 3, started +1.700, ended +1.720, 20 ms, waiting for result'));
  assert.ok(labels.every((label) => /^(run|step|text|reasoning|tool), .+, level \d, started \+\d\.\d{3}, ended \+\d\.\d{3}, /.test(label as string)));
});

test('a tool call has an arguments bar and a wait bar, every other row one bar, and positions are percentages of the axis', () => {
  const byRow = items(markup);
  assert.equal(byRow.length, 10);
  const parts = (inner: string) => [...inner.matchAll(/data-part="(\w+)"/g)].map((match) => match[1]);
  const rowOf = (label: string) => byRow.find(([, inner]) => inner.includes(`>${label}<`)) as readonly [string, string];
  assert.deepEqual(parts(rowOf('search_documents')[1]), ['args', 'wait']);
  assert.deepEqual(parts(rowOf('pick_color')[1]), ['args'], 'a call left for the client has no wait bar');
  assert.deepEqual(parts(rowOf('plan')[1]), ['span']);
  assert.ok(parts(rowOf('plan')[1]).length === 1 && parts(rowOf('run1')[1]).length === 1);
  const styles = [...markup.matchAll(/style="left:([\d.]+)%;width:([\d.]+)%"/g)].map((match) => [Number(match[1]), Number(match[2])] as const);
  assert.ok(styles.length >= 11);
  for (const [left, width] of styles) assert.ok(left >= 0 && left <= 100 && width >= 0 && left + width <= 100.01, `${left} + ${width}`);
  // The axis is 1,900 ms (the exchange's elapsed time), so the arguments bar of the search starts at 520 / 1900.
  assert.ok(styles.some(([left, width]) => left === 27.37 && width === 2.11), 'search_documents arguments 520 to 560 ms');
});

test('the newest run is open and an older run is closed, and a closed run has no axis', () => {
  const h = harness();
  playRun(h, 'ex1', timed([RUN, DONE]), { runId: 'r1' });
  playRun(h, 'ex2', timed([{ ...RUN, runId: 'r2' }, { type: 'STEP_STARTED', stepName: 'only' }, { type: 'STEP_FINISHED', stepName: 'only' }, { ...DONE, runId: 'r2' }]), { runId: 'r2' });
  const session = h.session();
  const shown = html(session);
  assert.equal((shown.match(/role="treeitem"/g) ?? []).length, 3, 'r2, its step, and r1');
  assert.equal((shown.match(/class="agui-wf-axis"/g) ?? []).length, 1);
  assert.ok(shown.indexOf('>r2<') < shown.indexOf('>r1<'), 'newest first');
  const opened = html(session, { openRuns: new Map([['ex1:run', true], ['ex2:run', false]]) });
  assert.equal((opened.match(/role="treeitem"/g) ?? []).length, 2, 'r2 closed and r1 open');
  assert.equal((opened.match(/class="agui-wf-axis"/g) ?? []).length, 1);
});

test('a closed row hides its children, and the selected row is marked and is the tab stop', () => {
  const session = delegation({ subagents: false });
  const rows = flatten(buildWaterfall(session));
  const research = rows.find((row) => row.label === 'research')?.id as string;
  const search = rows.find((row) => row.label === 'search_documents')?.id as string;
  const hidden = html(session, { closed: new Set([research]) });
  assert.equal((hidden.match(/role="treeitem"/g) ?? []).length, 8);
  assert.match(hidden, /aria-expanded="false"/);
  const chosen = html(session, { selected: search });
  const selected = items(chosen).filter(([attributes]) => attributes.includes('aria-selected="true"'));
  assert.equal(selected.length, 1);
  assert.ok(selected[0]?.[0].includes('tabindex="0"'));
  // The selected row is hidden by its closed parent: the tab stop falls on the nearest visible ancestor.
  const covered = html(session, { selected: search, closed: new Set([research]) });
  const stops = items(covered).filter(([attributes]) => attributes.includes('tabindex="0"'));
  assert.equal(stops.length, 1);
  assert.ok(stops[0]?.[1].includes('>research<'));
});

test('a row of one frame still has a bar and its duration as text', () => {
  const h = harness();
  playRun(h, 'ex1', [RUN, { type: 'STEP_STARTED', stepName: 'blink' }, { type: 'STEP_FINISHED', stepName: 'blink' }, DONE].map((event) => ({ atMs: 5, event })), { runId: 'r1' });
  const blink = items(html(h.session())).find(([, inner]) => inner.includes('>blink<'));
  assert.ok(blink);
  assert.match(blink[1], /data-part="span"/);
  assert.match(blink[1], />0 ms</);
});

test('an open row says running while the run streams and no end seen after it stopped, and a stopped run says so', () => {
  const events = [RUN, { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'x' }];
  const open = (options: Parameters<typeof playRun>[3]) => {
    const h = harness();
    playRun(h, 'ex1', timed(events), options);
    return html(h.session());
  };
  const live = open({ live: true, transport: 'streaming' });
  assert.match(live, /data-open="true"/);
  assert.match(live, />running</);
  assert.match(live, />Streaming</);
  assert.doesNotMatch(live, /no end seen/);
  const stopped = open({ transport: 'user-stopped' });
  assert.match(stopped, />no end seen</);
  assert.match(stopped, />Stopped by you</);
  assert.match(open({}), />No terminal event</);
  // An open row has a striped, square-ended bar: the bar says so, and so do the words.
  assert.ok(items(stopped).some(([, inner]) => inner.includes('data-part="span" data-open="true"')));
});

test('the details area asks for a selection, and shows what a selected row is and where its frames are', () => {
  const session = delegation({ subagents: false });
  assert.match(html(session), /<section class="agui-wf-details" aria-label="Row details"><p>Select a row to see its details\.<\/p>/);
  const rows = flatten(buildWaterfall(session));
  const id = (label: string) => rows.find((row) => row.label === label)?.id as string;

  const tool = html(session, { selected: id('search_documents') });
  assert.match(tool, /<dt>Id<\/dt><dd>tc-search<\/dd>/);
  assert.match(tool, /<dt>Start<\/dt><dd>\+0\.520<\/dd>/);
  assert.match(tool, /<dt>End<\/dt><dd>\+1\.400<\/dd>/);
  assert.match(tool, /<dt>Duration<\/dt><dd>880 ms<\/dd>/);
  assert.match(tool, /<dt>Arguments complete<\/dt><dd>\+0\.560<\/dd>/);
  assert.match(tool, /<dt>Result received<\/dt><dd>\+1\.400<\/dd>/);
  assert.match(tool, /aria-label="Show frame #\d+ in the frames list"/);
  assert.match(tool, /Times are when the browser read each frame/);

  const pending = html(session, { selected: id('pick_color') });
  assert.match(pending, /<dt>Result received<\/dt><dd>not in this run<\/dd>/);
  assert.match(pending, />waiting for result</);

  const run = html(session, { selected: id('run1') });
  assert.match(run, /<dt>Before the first event<\/dt><dd>100 ms<\/dd>/);
  assert.match(run, /<dt>Thread<\/dt><dd>t1<\/dd>/);
  assert.match(run, />Show exchange</);

  const step = html(session, { selected: id('plan') });
  assert.match(step, /<dt>Duration<\/dt><dd>310 ms<\/dd>/);
  assert.doesNotMatch(step, /Arguments complete/);
});

test('an open row is described in the details with how long it was seen, and a stopped run says how it ended', () => {
  const h = harness();
  playRun(h, 'ex1', timed([RUN, { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'x' }]), { transport: 'user-stopped' });
  const session = h.session();
  const message = flatten(buildWaterfall(session)).find((row) => row.kind === 'message')?.id as string;
  const shown = html(session, { selected: message });
  assert.match(shown, /<dt>End<\/dt><dd>not seen \(no end seen\)<\/dd>/);
  assert.match(shown, /<dt>Duration<\/dt><dd>seen for 10 ms<\/dd>/);
});

test('an empty thread says so', () => {
  assert.match(html(harness().session()), /No run in this thread yet\./);
});
