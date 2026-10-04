// Spec 009 (subagent lanes and the timeline): the markup of the conversation over scripted sessions. What a lane holds, how
// it is named for assistive technology, how each status looks without color, and what the timeline draws. Keys, jumps,
// focus and scrolling are in tests/e2e/conversation/lanes.spec.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConversationViewProps } from '../../src/contracts.ts';
import { projectConversation } from '../../src/core/projection/index.ts';
import { ConversationView } from '../../src/views/conversation/index.tsx';
import { countsOf, pathTo } from '../../src/views/conversation/lanes.tsx';
import { ROW_LIMIT } from '../../src/views/conversation/timeline.tsx';
import { RUN_FINISHED, RUN_STARTED, harness, sessionOf, type Harness } from './support.ts';

const started = (id: string, extra: object = {}) => ({ type: 'SUBAGENT_STARTED', subagentRunId: id, name: `agent-${id}`, ...extra });
const finished = (id: string, extra: object = {}) => ({ type: 'SUBAGENT_FINISHED', subagentRunId: id, ...extra });
const inLane = (id: string, event: object) => ({ ...event, subagentRunId: id });
const say = (id: string, messageId: string, text: string) => [
  inLane(id, { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' }),
  inLane(id, { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text }),
  inLane(id, { type: 'TEXT_MESSAGE_END', messageId }),
];

const props = (h: Harness): ConversationViewProps => ({
  store: h.store,
  interrupts: [],
  toolResults: [],
  onDraftInterrupt() {},
  onAnswerInterrupt() {},
  onDraftToolResult() {},
  onSubmitToolResult() {},
  onContinue() {},
});

/** One exchange with `events` at 10 ms steps, ended after `elapsed` ms. */
function played(events: ReadonlyArray<object>, options: { live?: boolean; elapsed?: number; transport?: 'user-stopped' } = {}): Harness {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  events.forEach((event, i) => h.push('ex1', event, (i + 1) * 10));
  if (!options.live) h.close('ex1', options.transport ?? 'completed', options.elapsed ?? (events.length + 1) * 10);
  return h;
}

const render = (h: Harness, extra: object = {}) => renderToStaticMarkup(createElement(ConversationView, { ...props(h), ...extra }));

/** The `div` whose opening tag holds `marker`, with everything inside it. */
function block(html: string, marker: string): string {
  const at = html.indexOf(marker);
  assert.ok(at >= 0, `${marker} is not in the markup`);
  const open = html.lastIndexOf('<div', at);
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = open;
  let depth = 0;
  for (let match = tags.exec(html); match !== null; match = tags.exec(html)) {
    depth += match[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(open, tags.lastIndex);
  }
  return assert.fail('unbalanced markup');
}
const lane = (html: string, id: string) => block(html, `data-subagent="${id}"`);
const rows = (html: string) => [...html.matchAll(/<button[^>]*data-tl-row="([^"]+)"[^>]*>/g)];

// ---- lanes ----

test('a lane shows its header and holds what its events produced, and nothing else', () => {
  const html = render(
    played([
      RUN_STARTED,
      { type: 'TEXT_MESSAGE_START', messageId: 'p1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'p1', delta: 'parent words' },
      { type: 'TEXT_MESSAGE_END', messageId: 'p1' },
      started('s1', { description: 'Finds the sources', parentToolCallId: 'tc9', parentMessageId: 'pm9' }),
      ...say('s1', 'c1', 'child words'),
      inLane('s1', { type: 'TOOL_CALL_START', toolCallId: 'tool1', toolCallName: 'look' }),
      inLane('s1', { type: 'TOOL_CALL_END', toolCallId: 'tool1' }),
      finished('s1', { result: { found: 2 } }),
      RUN_FINISHED,
    ]),
  );
  const inside = lane(html, 's1');
  assert.match(inside, /agent-s1/);
  assert.match(inside, />s1</, 'the invocation id');
  assert.match(inside, /Finds the sources/);
  assert.match(inside, /via tool call <span[^>]*>tc9</);
  assert.match(inside, /in message <span[^>]*>pm9</);
  assert.match(inside, /Finished/);
  assert.match(inside, /1 message · 1 tool call/);
  assert.match(inside, /child words/);
  assert.match(inside, /look/);
  assert.match(inside, /frame #\d+/, 'each lifecycle line has a frame reference');
  assert.match(inside, /\{&quot;found&quot;:2\}/, 'the result of the finish line');
  assert.doesNotMatch(inside, /parent words/);
  assert.match(html, /parent words/);
  assert.ok(html.indexOf('parent words') < html.indexOf('data-subagent="s1"'), 'the parent message came first');
});

test('a nested lane is inside the body of its parent, at any depth', () => {
  const html = render(
    played([RUN_STARTED, started('root'), started('mid', { parentSubagentRunId: 'root' }), started('leaf', { parentSubagentRunId: 'mid' }), ...say('leaf', 'l1', 'leaf words'), finished('leaf'), finished('mid'), finished('root'), RUN_FINISHED]),
  );
  const root = lane(html, 'root');
  const mid = lane(root, 'mid');
  const leaf = lane(mid, 'leaf');
  assert.match(leaf, /leaf words/);
  assert.doesNotMatch(mid.replace(leaf, ''), /leaf words/);
  assert.equal(lane(html, 'leaf'), leaf);
  assert.match(mid, /in <span[^>]*>agent-root</, 'the header says what it is nested in');
});

test('parallel subagents have their own lanes with only their own events', () => {
  const html = render(
    played([RUN_STARTED, started('a'), started('b'), ...say('a', 'ma', 'alpha text'), ...say('b', 'mb', 'beta text'), finished('b'), finished('a'), RUN_FINISHED]),
  );
  const a = lane(html, 'a');
  const b = lane(html, 'b');
  assert.match(a, /alpha text/);
  assert.doesNotMatch(a, /beta text/);
  assert.match(b, /beta text/);
  assert.doesNotMatch(b, /alpha text/);
});

test('the toggle is a button that says it is expanded and names the subagent, its status, duration, start and parent', () => {
  const html = render(played([RUN_STARTED, started('root'), started('kid', { parentSubagentRunId: 'root' }), finished('kid'), finished('root'), RUN_FINISHED]));
  const kid = lane(html, 'kid');
  const toggle = /<button[^>]*class="agui-lane-toggle"[^>]*>/.exec(kid)![0];
  assert.match(toggle, /aria-expanded="true"/);
  assert.match(toggle, /aria-controls="[^"]+"/);
  assert.match(toggle, /aria-label="agent-kid, subagent kid, Finished, 10 ms, starts \+0\.030 s, nested under agent-root"/);
  assert.match(kid, /Show in timeline/);
});

test('the counts cover what a lane holds directly, and zero counts are left out', () => {
  const session = sessionOf([
    RUN_STARTED,
    started('outer'),
    inLane('outer', { type: 'STEP_STARTED', stepName: 'work' }),
    ...say('outer', 'm1', 'one'),
    ...say('outer', 'm2', 'two'),
    inLane('outer', { type: 'STEP_FINISHED', stepName: 'work' }),
    started('inner', { parentSubagentRunId: 'outer' }),
    ...say('inner', 'm3', 'three'),
    finished('inner'),
    finished('outer'),
    RUN_FINISHED,
  ]);
  const model = projectConversation(session);
  const outer = model.subagents.find((item) => item.subagentRunId === 'outer')!;
  assert.deepEqual(countsOf(outer.children), { messages: 2, tools: 0, subagents: 1 }, 'through the step, not through the nested lane');
  const h = played([RUN_STARTED, started('only'), finished('only'), RUN_FINISHED]);
  assert.doesNotMatch(lane(render(h), 'only'), /\d+ (messages?|tool calls?|subagents?)/);
});

test('a lane with no events says so', () => {
  const html = render(played([RUN_STARTED, started('empty'), finished('empty'), RUN_FINISHED]));
  assert.match(lane(html, 'empty'), /No events in this lane\./);
});

test('a thread without subagents has no lane and no timeline', () => {
  const html = render(played([RUN_STARTED, { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }, { type: 'TEXT_MESSAGE_END', messageId: 'm' }, RUN_FINISHED]));
  assert.doesNotMatch(html, /agui-lane|agui-tl|data-timeline/);
});

test('names, ids, descriptions and results are shown as typed, never as Markdown or HTML', () => {
  const html = render(
    played([
      RUN_STARTED,
      started('s1', { name: '<img src=x onerror=alert(1)>', description: '**bold** <b>html</b>' }),
      finished('s1', { result: '<script>alert(1)</script>' }),
      RUN_FINISHED,
    ]),
  );
  assert.doesNotMatch(html, /<img |<script|<b>html/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /\*\*bold\*\* &lt;b&gt;html&lt;\/b&gt;/);
});

test('whatever the markup, the only style attributes are the positions of bars, labels and indents', () => {
  const html = render(played([RUN_STARTED, started('a'), started('b', { parentSubagentRunId: 'a' }), finished('b'), finished('a'), RUN_FINISHED]));
  const styles = [...html.matchAll(/style="([^"]*)"/g)].map((match) => match[1]!);
  assert.ok(styles.length > 0);
  for (const style of styles) assert.match(style, /^(left:[\d.]+%?(;width:[\d.]+%)?|margin-left:calc\(var\(--u\) \* \d+\))$/, style);
});

// ---- statuses ----

function allStatuses(): Harness {
  const h = harness();
  const open = (id: string, run: string) => {
    h.open(id, { input: { threadId: 't1', runId: run } });
    h.push(id, { type: 'RUN_STARTED', threadId: 't1', runId: run }, 10);
  };
  open('ex1', 'r1');
  [started('fin'), finished('fin'), started('sus'), finished('sus', { outcome: { type: 'suspended', interruptIds: ['i1', 'i2'] } }), started('err'), { type: 'SUBAGENT_ERROR', subagentRunId: 'err', message: 'budget gone', code: 'E_BUDGET' }, started('open')].forEach((event, i) => h.push('ex1', event, 20 + i * 10));
  h.close('ex1', 'completed', 200);
  open('ex2', 'r2');
  h.push('ex2', started('live'), 20);
  open('ex3', 'r3');
  h.push('ex3', started('cut'), 20);
  h.close('ex3', 'user-stopped', 100);
  return h;
}

test('the six statuses differ by word and by glyph, in the lane and on its row, with no color needed', () => {
  const html = render(allStatuses());
  const expected: Record<string, [string, string]> = { fin: ['finished', 'Finished'], sus: ['suspended', 'Suspended'], err: ['error', 'Error'], open: ['no-end', 'No end event'], live: ['running', 'Running'], cut: ['stopped', 'Stopped by you'] };
  const glyphs = new Set<string>();
  const words = new Set<string>();
  for (const [id, [status, word]] of Object.entries(expected)) {
    const body = lane(html, id);
    assert.match(body, new RegExp(`data-status="${status}"`));
    const tag = new RegExp(`<span aria-hidden="true">(\\S)</span> ${word}`).exec(body);
    assert.ok(tag, `${id}: the lane's header has its glyph and its word`);
    glyphs.add(tag[1]!);
    words.add(word);
    const row = new RegExp(`<button[^>]*data-tl-row="[^"]*"[^>]*data-status="${status}"[\\s\\S]*?</button>`).exec(html);
    assert.ok(row, `${status}: a row`);
    assert.match(row[0], new RegExp(`<span class="agui-tl-end">${tag[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>`), `${status}: the end of its bar has the glyph`);
    assert.match(row[0], new RegExp(`<span>${word}</span>`), `${status}: its row says the word`);
  }
  assert.equal(glyphs.size, 6);
  assert.equal(words.size, 6);
});

test('the lifecycle shows an error with its message and code, and a suspended finish with its interrupts', () => {
  const html = render(allStatuses());
  assert.match(lane(html, 'err'), /budget gone/);
  assert.match(lane(html, 'err'), />E_BUDGET</);
  assert.match(lane(html, 'sus'), /interrupts <span[^>]*>i1, i2</);
});

test('a failed subagent does not change the outcome of its run', () => {
  const html = render(played([RUN_STARTED, started('x'), { type: 'SUBAGENT_ERROR', subagentRunId: 'x', message: 'nope' }, RUN_FINISHED]));
  assert.match(block(html, 'data-entry="run"'), /Finished/);
  assert.match(lane(html, 'x'), /Error/);
});

test('a lane with no start event, an unseen parent and a continuation say so in words', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  h.push('ex1', RUN_STARTED, 10);
  h.push('ex1', started('moves'), 20);
  h.push('ex1', finished('moves', { outcome: { type: 'suspended' } }), 30);
  h.close('ex1');
  h.open('ex2', { input: { threadId: 't1', runId: 'r2' } });
  h.push('ex2', { type: 'RUN_STARTED', threadId: 't1', runId: 'r2' }, 10);
  h.push('ex2', started('moves'), 20);
  h.push('ex2', finished('moves'), 30);
  h.push('ex2', inLane('nostart', { type: 'CUSTOM', name: 'x', value: 1 }), 40);
  h.push('ex2', started('lost', { parentSubagentRunId: 'ghost' }), 50);
  h.close('ex2');
  const html = render(h);
  const moved = [...html.matchAll(/data-subagent="moves"/g)];
  assert.equal(moved.length, 2, 'one lane in each run');
  assert.match(html, /Continued/);
  assert.match(lane(html, 'nostart'), /Start not received/);
  assert.match(lane(html, 'nostart'), /Subagent nostart/);
  assert.match(lane(html, 'lost'), /Parent ghost not seen in this run/);
  assert.equal(rows(html).length, 4, 'a row for each lane, each in its own run');
  assert.equal([...html.matchAll(/data-chart="/g)].length, 2, 'two charts, one for each run');
});

// ---- the timeline ----

test('the timeline has one chart for each run that has lanes, with a row for each lane and bars at the frame offsets', () => {
  const html = render(
    played(
      [
        RUN_STARTED, // 10
        started('a'), // 20
        started('b'), // 30
        started('a1', { parentSubagentRunId: 'a' }), // 40
        finished('a1'), // 50
        finished('a'), // 60
        finished('b'), // 70
        RUN_FINISHED, // 80
      ],
      { elapsed: 100 },
    ),
  );
  assert.equal([...html.matchAll(/data-chart="/g)].length, 1);
  const all = rows(html).map((match) => match[1]);
  assert.equal(all.length, 3);
  const bar = (id: string) => {
    const row = new RegExp(`<button[^>]*data-tl-row="${id}"[\\s\\S]*?</button>`).exec(html)![0];
    return /style="left:([\d.]+)%;width:([\d.]+)%"/.exec(row)!.slice(1).map(Number);
  };
  const lanes = [...html.matchAll(/data-tl-row="([^"]+)"/g)].map((match) => match[1]!);
  assert.deepEqual(bar(lanes[0]!), [20, 40], 'a: from its start at 20 ms to its end at 60 ms on an axis of 100 ms');
  assert.deepEqual(bar(lanes[1]!), [40, 10], 'a1: start 40, end 50, nested under a');
  assert.deepEqual(bar(lanes[2]!), [30, 40], 'b: start 30, end 70');
  const run = /agui-tl-runrow[\s\S]*?<\/li>/.exec(html)![0];
  assert.match(run, /style="left:10\.000%;width:70\.000%"/, 'the run from 10 to 80 ms');
});

test('nested rows indent by their depth and come after their parent', () => {
  const html = render(played([RUN_STARTED, started('a'), started('b', { parentSubagentRunId: 'a' }), started('c', { parentSubagentRunId: 'b' }), finished('c'), finished('b'), finished('a'), RUN_FINISHED]));
  const indents = [...html.matchAll(/margin-left:calc\(var\(--u\) \* (\d+)\)/g)].map((match) => Number(match[1]));
  assert.deepEqual(indents, [0, 3, 6]);
});

test('the timeline says it uses arrival offsets and not the event timestamp, and it is collapsible and open', () => {
  const html = render(played([RUN_STARTED, started('a'), finished('a'), RUN_FINISHED]));
  assert.match(html, /derived from the offsets at which frames arrived/);
  assert.match(html, /optional timestamp of an event is not used/);
  assert.match(html, /<details[^>]*open=""[^>]*>(?:(?!<\/details>).)*Subagent timeline/s);
});

test('the rows are one tab stop: the first has tabindex 0 and the others -1', () => {
  const html = render(played([RUN_STARTED, started('a'), started('b'), finished('b'), finished('a'), RUN_FINISHED]));
  const tabs = [...html.matchAll(/<button[^>]*data-tl-row="[^"]+"[^>]*tabindex="(-?\d)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ['0', '-1']);
});

test('a row names the subagent, its id, status, duration, start and parent, and says what activating it does', () => {
  const html = render(played([RUN_STARTED, started('a'), started('b', { parentSubagentRunId: 'a' }), finished('b'), finished('a'), RUN_FINISHED]));
  const labels = [...html.matchAll(/<button[^>]*data-tl-row="[^"]+"[^>]*aria-label="([^"]*)"/g)].map((match) => match[1]);
  assert.equal(labels[0], 'agent-a, subagent a, Finished, 30 ms, starts +0.020 s. Activate to show its lane');
  assert.equal(labels[1], 'agent-b, subagent b, Finished, 10 ms, starts +0.030 s, nested under agent-a. Activate to show its lane');
});

test('a chart draws its first 100 lane rows and offers the rest', () => {
  const many = (count: number) => {
    const events: object[] = [RUN_STARTED];
    for (let i = 0; i < count; i += 1) events.push(started(`s${i}`));
    for (let i = 0; i < count; i += 1) events.push(finished(`s${i}`));
    events.push(RUN_FINISHED);
    return render(played(events));
  };
  assert.equal(ROW_LIMIT, 100);
  const exact = many(100);
  assert.equal(rows(exact).length, 100);
  assert.doesNotMatch(exact, /more rows?/);
  const one = many(101);
  assert.equal(rows(one).length, 100);
  assert.match(one, /Show 1 more row</);
  const fifty = many(150);
  assert.equal(rows(fifty).length, 100);
  assert.match(fifty, /Show 50 more rows</);
});

test('a long name is complete in the row’s name and its title', () => {
  const name = 'n'.repeat(400);
  const html = render(played([RUN_STARTED, started('long', { name }), finished('long'), RUN_FINISHED]));
  assert.match(html, new RegExp(`title="${name} \\(long\\)"`));
  assert.match(html, new RegExp(`aria-label="${name}, subagent long, `));
});

test('a lane a messages snapshot took out of the transcript keeps its row, which says so', () => {
  const html = render(played([RUN_STARTED, started('gone'), finished('gone'), { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: 'restated' }] }, RUN_FINISHED]), { onReveal() {} });
  assert.doesNotMatch(html, /data-subagent=/, 'no lane in the transcript');
  const row = /<button[^>]*data-tl-row=[\s\S]*?<\/button>/.exec(html)![0];
  assert.match(row, /Replaced transcript/);
  assert.match(row, /transcript replaced\. Activate to show its start frame in the frames list/);
});

// ---- the path of a jump ----

test('pathTo lists the steps and lanes that contain a lane, outermost first, and nothing for a lane the transcript lost', () => {
  const model = projectConversation(
    sessionOf([
      RUN_STARTED,
      { type: 'STEP_STARTED', stepName: 'delegate' },
      started('a'),
      started('b', { parentSubagentRunId: 'a' }),
      inLane('b', { type: 'STEP_STARTED', stepName: 'inner' }),
      started('c', { parentSubagentRunId: 'b' }),
      inLane('b', { type: 'STEP_FINISHED', stepName: 'inner' }),
      finished('c'),
      finished('b'),
      finished('a'),
      { type: 'STEP_FINISHED', stepName: 'delegate' },
      RUN_FINISHED,
    ]),
  );
  const [a, b, c] = ['a', 'b', 'c'].map((id) => model.subagents.find((item) => item.subagentRunId === id)!);
  const step = model.entries.find((entry) => entry.kind === 'step')!;
  assert.deepEqual(pathTo(model.entries, a!.id), [step.id]);
  assert.deepEqual(pathTo(model.entries, b!.id), [step.id, a!.id]);
  const inner = (b!.children.find((entry) => entry.kind === 'step') as { id: string }).id;
  assert.deepEqual(pathTo(model.entries, c!.id), [step.id, a!.id, b!.id, inner], 'c started while b had a step open, so it sits in that step');
  assert.equal(pathTo(model.entries, 'no-such-lane'), undefined);

  const lost = projectConversation(sessionOf([RUN_STARTED, started('x'), finished('x'), { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u', role: 'user', content: '.' }] }, RUN_FINISHED]));
  assert.equal(pathTo(lost.entries, lost.subagents[0]!.id), undefined);
});
