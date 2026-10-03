// FX9: natural pacing for the scripted agents. The pacing layer turns any scenario response into a timed
// one: streamed text, reasoning and tool-call arguments are cut into small deltas, and a pause is set before
// each chunk. These tests prove what must not change (event types and order, every delta's text, wire
// fragments and invalid frames) and what must (pieces and pauses), and that the pauses are reproducible. No
// test sleeps: delivery takes an injected sleep, and the timer-backed one is exercised with a fake clock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createInteractiveServer } from '../../examples/reference-agent/interactive-scenarios.ts';
import { deliver, NATURAL_PACE, pace, SLOW_PACE, sleepOn, type PaceProfile, type Sleep } from '../../examples/reference-agent/pacing.ts';
import { a2uiResponse, baselineResponse, interactiveResponse, runErrorResponse, SCENARIOS, type RunInput, type ScenarioResponse } from '../../examples/reference-agent/scenarios.ts';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const ids = { threadId: 't-1', runId: 'r-1' };
const run = (content?: string, extra: Partial<RunInput> = {}) => interactiveResponse({ ...ids, ...(content === undefined ? {} : { messages: [{ role: 'user', content }] }), ...extra });

type Event = { type: string; [key: string]: unknown };

/** The events of a response of whole `data:` frames, in order. */
const eventsOf = (response: ScenarioResponse): Event[] =>
  response.chunks.map((chunk) => JSON.parse(decoder.decode(chunk).slice('data: '.length)) as Event);
const typesOf = (response: ScenarioResponse) => eventsOf(response).map((event) => event.type);
/** Types with runs of one type counted once: a delta that was cut in pieces is still one run of its type. */
const distinct = (types: readonly string[]) => types.filter((type, index) => type !== types[index - 1]);
const joined = (response: ScenarioResponse) => Buffer.concat(response.chunks);

/** What each message or tool call said, by id, deltas joined: the thing pacing must not change. */
function said(response: ScenarioResponse): Record<string, string> {
  const out: Record<string, string> = {};
  for (const event of eventsOf(response)) {
    if (typeof event.delta !== 'string') continue;
    const id = String(event.messageId ?? event.toolCallId);
    out[`${event.type}:${id}`] = (out[`${event.type}:${id}`] ?? '') + event.delta;
  }
  return out;
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const inRange = (value: number, [min, max]: readonly [number, number]) => value >= min && value <= max;

// ---- what stays the same --------------------------------------------------------------------------

test('every interactive scenario keeps its event types in order, and every delta joins back into the original', () => {
  const bodies: [string, ScenarioResponse][] = [
    ['plain', run('hello')],
    ['interrupt', run(SCENARIOS.interrupt)],
    ['tools', run(SCENARIOS.tools)],
    ['slow', run(SCENARIOS.slow)],
    ['never finishes', run(SCENARIOS.neverFinishes)],
    ['state', run(SCENARIOS.state)],
    ['resume', run(undefined, { resume: [{ interruptId: 'i-approve', status: 'resolved', payload: { approved: true, note: 'ok' } }] })],
    ['tool results', run(undefined, { messages: [{ role: 'tool', toolCallId: 'c-color', content: 'teal' }] })],
    ['a2ui', a2uiResponse(ids)],
  ];
  for (const [name, original] of bodies) {
    const paced = pace(original);
    assert.deepEqual(distinct(typesOf(paced)), distinct(typesOf(original)), name);
    assert.deepEqual(said(paced), said(original), name);
    assert.equal(paced.status, original.status, name);
    assert.equal(paced.contentType, original.contentType, name);
    assert.equal(paced.ending, original.ending, name);
    assert.equal(paced.delaysMs?.length, paced.chunks.length, `${name}: one pause per chunk`);
  }
});

test('text streams as word-sized deltas and tool-call arguments as a few characters at a time', () => {
  const plain = pace(run('hello'));
  const text = eventsOf(plain).filter((event) => event.type === 'TEXT_MESSAGE_CONTENT');
  assert.deepEqual(
    text.map((event) => event.delta),
    ['Hello', ' from', ' the', ' reference', ' agent.'],
  );
  assert.ok(text.every((event) => event.messageId === 'm-r-1'), 'each delta stays on its message');

  const tools = pace(run(SCENARIOS.tools));
  const args = eventsOf(tools).filter((event) => event.type === 'TOOL_CALL_ARGS');
  assert.ok(args.length > 4, 'the two argument lists were cut into several deltas');
  assert.ok(args.every((event) => (event.delta as string).length <= 9));
  assert.deepEqual(JSON.parse(said(tools)['TOOL_CALL_ARGS:c-color']!), { choices: ['red', 'teal'] });
  assert.deepEqual(JSON.parse(said(tools)['TOOL_CALL_ARGS:c-size']!), { max: 3 });
});

test('multibyte text and arguments are never cut inside a code point, and stay valid UTF-8 and valid frames', () => {
  const text = 'héllo wörld, 你好 🙂 🙂🙂🙂';
  const args = JSON.stringify({ q: '🙂🙂🙂🙂🙂🙂🙂🙂 你好 héllo' });
  const frame = (event: object) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  const original: ScenarioResponse = {
    status: 200,
    contentType: 'text/event-stream',
    chunks: [
      frame({ type: 'RUN_STARTED', ...ids }),
      frame({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: text }),
      frame({ type: 'REASONING_MESSAGE_CONTENT', messageId: 'r', delta: text }),
      frame({ type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: args }),
    ],
    ending: 'close',
  };
  const paced = pace(original);
  assert.deepEqual(said(paced), said(original));
  for (const event of eventsOf(paced)) {
    if (typeof event.delta === 'string') assert.doesNotMatch(event.delta, LONE_SURROGATE, `a delta of ${event.type} was cut inside a surrogate pair`);
  }
  for (const chunk of paced.chunks) assert.equal(decoder.decode(chunk, { stream: false }).includes('�'), false);
});

test('an empty or single-piece delta keeps its original bytes', () => {
  const frame = (delta: string) => encoder.encode(`data: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta })}\n\n`);
  const original: ScenarioResponse = { status: 200, contentType: 'text/event-stream', chunks: [frame(''), frame('word'), frame('  ')], ending: 'close' };
  assert.deepEqual(pace(original).chunks, original.chunks);
});

test('wire fragments and invalid frames are kept as they are, and the protocol fixtures are not touched at all', () => {
  for (const original of [baselineResponse(ids), runErrorResponse(ids), baselineResponse({ threadId: 'tt', runId: 'rr' })]) {
    const paced = pace(original);
    assert.deepEqual(paced.chunks, original.chunks, 'the uneven chunks of a fixture stay uneven');
    assert.deepEqual(joined(paced), joined(original));
    assert.ok(paced.delaysMs!.every((delay) => delay === 0), 'a fixture reaches the page at wire speed');
  }

  const broken = pace(run(SCENARIOS.broken));
  const text = decoder.decode(joined(broken));
  assert.ok(text.includes('data: {not json at all\n\n'), 'the damage is kept unrepaired');
  assert.ok(text.indexOf('never-started') < text.indexOf('{not json') && text.indexOf('{not json') < text.indexOf('after the damage'));
  assert.deepEqual(broken.chunks, run(SCENARIOS.broken).chunks, 'a delta with no start is the damage and stays one frame: pacing adds nothing to it');
});

test('the never finishes scenario streams a little, then stays open and says so', () => {
  const held = pace(run(SCENARIOS.neverFinishes));
  assert.equal(held.ending, 'hold-until-abort');
  assert.deepEqual(distinct(typesOf(held)), ['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT']);
  assert.equal(Object.values(said(held)).join(''), 'This response stays open until you press Stop.');
  assert.ok(!typesOf(held).includes('RUN_FINISHED'), 'no terminal frame is made up');
  assert.ok(!typesOf(held).includes('TEXT_MESSAGE_END'), 'the message is left open too');
});

test('the slow scenario is a long reply that finishes: message end, then RUN_FINISHED, and the closing body', () => {
  const slow = pace(run(SCENARIOS.slow));
  assert.equal(slow.ending, 'close');
  assert.deepEqual(distinct(typesOf(slow)), ['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
  assert.equal(typesOf(slow).at(-1), 'RUN_FINISHED');
  const text = Object.values(said(run(SCENARIOS.slow))).join('');
  assert.ok(text.split(/[.!?] /).length >= 3, 'a few sentences');
  assert.equal(Object.values(said(slow)).join(''), text, 'the words join back into the original reply');
  assert.ok(eventsOf(slow).filter((event) => event.type === 'TEXT_MESSAGE_CONTENT').length > 30, 'streamed a word at a time');
});

/** A virtual clock: `sleep` advances `now` by what it was asked for and never waits, so a run of seconds takes no time. */
function virtualClock(): { now: number; sleep: Sleep } {
  const clock = {
    now: 0,
    sleep: (async (ms, signal) => {
      if (!signal.aborted) clock.now += ms;
    }) as Sleep,
  };
  return clock;
}

test('the slow scenario is scheduled over 6 to 10 seconds and its last frame, RUN_FINISHED, goes out at the end', async () => {
  const slow = pace(run(SCENARIOS.slow));
  const total = slow.delaysMs!.reduce((sum, delay) => sum + delay, 0);
  assert.ok(total >= 6000 && total <= 10_000, `the slow run is scheduled over ${total} ms`);

  const clock = virtualClock();
  const written: { type: string; at: number }[] = [];
  const started = Date.now();
  const complete = await deliver(slow, (chunk) => written.push({ type: (JSON.parse(decoder.decode(chunk).slice('data: '.length)) as Event).type, at: clock.now }), clock.sleep, new AbortController().signal);
  assert.ok(Date.now() - started < 200, 'ten seconds of schedule was delivered without sleeping');
  assert.equal(complete, true);
  assert.equal(clock.now, total, 'delivery waited exactly the schedule');
  assert.deepEqual(written.at(-1), { type: 'RUN_FINISHED', at: total });
  assert.equal(written[0]!.at, 0, 'RUN_STARTED goes out at once');

  // The window does not depend on which pauses the hash picks, only on the profile and the reply's length.
  const [think, ...tokens] = slow.delaysMs!.filter((delay) => delay > 0);
  assert.ok(inRange(think!, SLOW_PACE.think), 'the first pause is the think latency');
  assert.ok(tokens.every((delay) => inRange(delay, SLOW_PACE.token)), 'every later pause is a token interval');
  assert.ok(SLOW_PACE.think[0] + tokens.length * SLOW_PACE.token[0] >= 6000, 'the quickest the profile can stream it is 6 seconds');
  assert.ok(SLOW_PACE.think[1] + tokens.length * SLOW_PACE.token[1] <= 10_000, 'the slowest is 10 seconds');
});

test('Stop partway through the slow scenario ends the wait at once, writes nothing more and leaves no terminal frame', async () => {
  const slow = pace(run(SCENARIOS.slow));
  const stop = new AbortController();
  const clock = virtualClock();
  const written: Uint8Array[] = [];
  const sleep: Sleep = async (ms, signal) => {
    if (clock.now >= 3000) stop.abort(); // Stop pressed three seconds in, during a pause
    await clock.sleep(ms, signal);
  };
  assert.equal(await deliver(slow, (chunk) => written.push(chunk), sleep, stop.signal), false);
  assert.ok(clock.now >= 3000 && clock.now < 3200, `the schedule stopped at ${clock.now} ms, not at its end`);
  assert.ok(written.length > 5 && written.length < slow.chunks.length - 1, 'part of the reply arrived');
  assert.deepEqual(written, slow.chunks.slice(0, written.length), 'what arrived is a prefix of the original frames, unchanged');
  const types = written.map((chunk) => (JSON.parse(decoder.decode(chunk).slice('data: '.length)) as Event).type);
  assert.ok(!types.includes('RUN_FINISHED') && !types.includes('TEXT_MESSAGE_END'), 'no terminal frame is made up');
});

// ---- what changes: the pauses ---------------------------------------------------------------------

test('a run is announced at once, the first event after it waits a think latency, and deltas wait a token interval', () => {
  const paced = pace(run('hello'));
  const delays = paced.delaysMs!;
  const types = typesOf(paced);
  assert.equal(types[0], 'RUN_STARTED');
  assert.equal(delays[0], 0, 'RUN_STARTED goes out at once');
  assert.ok(inRange(delays[1]!, NATURAL_PACE.think), `think latency ${delays[1]}`);
  types.forEach((type, index) => {
    if (index < 2) return;
    // START, deltas, END, RUN_FINISHED: all inside a message, so all a token interval apart.
    if (type === 'TEXT_MESSAGE_CONTENT' || type === 'TEXT_MESSAGE_END' || type === 'RUN_FINISHED') assert.ok(inRange(delays[index]!, NATURAL_PACE.token), `${type} waited ${delays[index]}`);
  });
  const total = delays.reduce((sum, delay) => sum + delay, 0);
  assert.ok(total > 500, `a plain run takes ${total} ms of pauses, not one millisecond`);
});

test('a new step, a state update, a surface and a tool result each wait their own pause', () => {
  const frame = (event: object) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  const original: ScenarioResponse = {
    status: 200,
    contentType: 'text/event-stream',
    ending: 'close',
    chunks: [
      { type: 'RUN_STARTED', ...ids },
      { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }, // after RUN_STARTED: think
      { type: 'TEXT_MESSAGE_END', messageId: 'm' },
      { type: 'STEP_STARTED', stepName: 'plan' }, // a new step
      { type: 'TOOL_CALL_START', toolCallId: 'c', toolCallName: 'search' }, // a new tool call
      { type: 'TOOL_CALL_END', toolCallId: 'c' },
      { type: 'TOOL_CALL_RESULT', messageId: 'tm', toolCallId: 'c', content: 'found', role: 'tool' },
      { type: 'STATE_SNAPSHOT', snapshot: { a: 1 } },
      { type: 'STATE_DELTA', delta: [{ op: 'add', path: '/b', value: 2 }] },
      { type: 'ACTIVITY_SNAPSHOT', messageId: 'a', activityType: 'a2ui-surface', content: {}, replace: true },
      { type: 'RUN_FINISHED', ...ids, outcome: { type: 'success' } },
    ].map(frame),
  };
  const paced = pace(original);
  const wait = (type: string) => paced.delaysMs![typesOf(paced).indexOf(type)]!;
  assert.ok(inRange(wait('TEXT_MESSAGE_START'), NATURAL_PACE.think));
  assert.ok(inRange(wait('TEXT_MESSAGE_END'), NATURAL_PACE.token));
  assert.ok(inRange(wait('STEP_STARTED'), NATURAL_PACE.step));
  assert.ok(inRange(wait('TOOL_CALL_START'), NATURAL_PACE.step));
  assert.ok(inRange(wait('TOOL_CALL_END'), NATURAL_PACE.token));
  assert.ok(inRange(wait('TOOL_CALL_RESULT'), NATURAL_PACE.tool), 'between the call and its result');
  assert.ok(inRange(wait('STATE_SNAPSHOT'), NATURAL_PACE.update));
  assert.ok(inRange(wait('STATE_DELTA'), NATURAL_PACE.update));
  assert.ok(inRange(wait('ACTIVITY_SNAPSHOT'), NATURAL_PACE.update), 'before a surface');
  assert.ok(inRange(wait('RUN_FINISHED'), NATURAL_PACE.token));
  assert.deepEqual(paced.chunks, original.chunks, 'no delta here, so no byte changed');
});

test('the A2UI and state scenarios think first, then pause before the update', () => {
  const surface = pace(a2uiResponse(ids));
  assert.deepEqual(typesOf(surface), ['RUN_STARTED', 'ACTIVITY_SNAPSHOT', 'RUN_FINISHED']);
  assert.ok(inRange(surface.delaysMs![1]!, NATURAL_PACE.think));
  const state = pace(run(SCENARIOS.state));
  assert.deepEqual(typesOf(state), ['RUN_STARTED', 'STATE_SNAPSHOT', 'STATE_DELTA', 'RUN_FINISHED']);
  assert.ok(inRange(state.delaysMs![1]!, NATURAL_PACE.think));
  assert.ok(inRange(state.delaysMs![2]!, NATURAL_PACE.update));
});

test('pauses are reproducible and vary: the same response paces the same way, with no clock or Math.random', () => {
  const again = () => pace(run('hello'));
  assert.deepEqual(again().delaysMs, again().delaysMs);
  assert.deepEqual(again().chunks, again().chunks);
  const real = Math.random;
  Math.random = () => {
    throw new Error('pacing used Math.random');
  };
  try {
    assert.deepEqual(again().delaysMs, pace(run('hello')).delaysMs);
  } finally {
    Math.random = real;
  }
  const tokens = pace(run('hello')).delaysMs!.slice(3, 8);
  assert.ok(new Set(tokens).size > 1, `the token intervals are not all ${tokens[0]} ms`);
  assert.doesNotMatch(readFileSync(path.join(process.cwd(), 'examples', 'reference-agent', 'pacing.ts'), 'utf8'), /Math\.random|Date\.now|performance\.now/);
});

test('a profile sets the ranges, and an instant one asks for no time at all', () => {
  const none: PaceProfile = { think: [0, 0], token: [0, 0], step: [0, 0], tool: [0, 0], update: [0, 0] };
  assert.ok(pace(run('hello'), none).delaysMs!.every((delay) => delay === 0));
  const fixed: PaceProfile = { ...none, think: [250, 250] };
  assert.equal(pace(run('hello'), fixed).delaysMs![1], 250);
  assert.ok(pace(run(SCENARIOS.slow), none).delaysMs!.every((delay) => delay === 0), 'a profile that is passed wins over the slow scenario’s own');
});

// ---- playing a paced response -----------------------------------------------------------------------

/** A sleep that takes no time: it only records what it was asked for. */
function recordingSleep(): { sleep: Sleep; asked: number[] } {
  const asked: number[] = [];
  return { asked, sleep: async (ms) => void asked.push(ms) };
}

test('deliver writes every chunk in order after its pause, with the injected sleep and no real time', async () => {
  const paced = pace(run('hello'));
  const { sleep, asked } = recordingSleep();
  const written: Uint8Array[] = [];
  const started = Date.now();
  assert.equal(await deliver(paced, (chunk) => written.push(chunk), sleep, new AbortController().signal), true);
  assert.ok(Date.now() - started < 200, 'a paced response of several seconds was delivered at once');
  assert.deepEqual(written, paced.chunks);
  assert.deepEqual(asked, paced.delaysMs!.filter((delay) => delay > 0));
  assert.deepEqual(Buffer.concat(written), joined(paced));
});

test('a response with no pauses is written straight through, in the same turn', async () => {
  const written: Uint8Array[] = [];
  const original = run('hello');
  const done = deliver(original, (chunk) => written.push(chunk), async () => assert.fail('nothing to wait for'), new AbortController().signal);
  assert.equal(written.length, original.chunks.length, 'written before the first await settles');
  assert.equal(await done, true);
});

test('an abort during a pause stops delivery: nothing more is written, and it says it did not finish', async () => {
  const paced = pace(run('hello'));
  const stop = new AbortController();
  const written: Uint8Array[] = [];
  let sleeps = 0;
  const sleep: Sleep = async () => {
    sleeps += 1;
    if (sleeps === 3) stop.abort();
  };
  assert.equal(await deliver(paced, (chunk) => written.push(chunk), sleep, stop.signal), false);
  assert.deepEqual(written, paced.chunks.slice(0, 3), 'what went out before the pause that was interrupted');
  assert.equal(sleeps, 3);

  const before = written.length;
  assert.equal(await deliver(paced, (chunk) => written.push(chunk), sleep, stop.signal), false);
  assert.equal(written.length, before, 'an already aborted signal writes nothing');
});

/** A fake clock: timers fire only when the test says so. */
function fakeTimers() {
  let next = 0;
  const pending = new Map<number, () => void>();
  return {
    pending,
    setTimeout(handler: () => void, ms: number) {
      next += 1;
      pending.set(next, handler);
      void ms;
      return next;
    },
    clearTimeout(id: unknown) {
      pending.delete(id as number);
    },
    fire() {
      const [first] = pending;
      if (first === undefined) return;
      pending.delete(first[0]);
      first[1]();
    },
  };
}

test('the timer-backed sleep waits for its timer, and an abort ends it early and clears the timer', async () => {
  const timers = fakeTimers();
  const sleep = sleepOn(timers);

  let woke = false;
  const slept = sleep(500, new AbortController().signal).then(() => (woke = true));
  await Promise.resolve();
  assert.equal(woke, false, 'still waiting');
  assert.equal(timers.pending.size, 1);
  timers.fire();
  await slept;
  assert.equal(woke, true);
  assert.equal(timers.pending.size, 0);

  const stop = new AbortController();
  const interrupted = sleep(900, stop.signal);
  assert.equal(timers.pending.size, 1);
  stop.abort();
  await interrupted;
  assert.equal(timers.pending.size, 0, 'the timer was cleared, not left to fire later');

  await sleep(900, stop.signal);
  assert.equal(timers.pending.size, 0, 'an already aborted signal never starts a timer');
});

// ---- the Node fixture server: off by default, opt-in with a profile -----------------------------------

const FAST: PaceProfile = { think: [30, 30], token: [5, 5], step: [10, 10], tool: [10, 10], update: [10, 10] };

async function post(origin: string, content: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`${origin}/agent`, { method: 'POST', body: JSON.stringify({ ...ids, messages: [{ role: 'user', content }] }), ...(signal && { signal }) });
}

test('the Node interactive server answers at wire speed unless a profile is given, and the bytes are the producer’s', async () => {
  const server = await createInteractiveServer();
  try {
    const started = Date.now();
    const response = await post(server.origin, 'hello');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), joined(run('hello')));
    assert.ok(Date.now() - started < 200, 'no pause was added');
  } finally {
    await server.close();
  }
});

test('with a profile the Node server streams the paced bytes over time and closes the response', async () => {
  const server = await createInteractiveServer({ pace: FAST });
  try {
    const started = Date.now();
    const response = await post(server.origin, 'hello');
    const arrivals: number[] = [];
    const received: Uint8Array[] = [];
    const reader = response.body!.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      received.push(value);
      arrivals.push(Date.now() - started);
    }
    assert.deepEqual(Buffer.concat(received), joined(pace(run('hello'), FAST)));
    assert.ok(arrivals.at(-1)! >= 30, 'the think latency was waited');
    assert.ok(new Set(arrivals).size > 3, 'the chunks arrived at different times, not in one burst');
  } finally {
    await server.close();
  }
});

test('with a profile a held run counts as open at once, and Stop mid-stream releases it and writes nothing more', async () => {
  const lateProfile: PaceProfile = { ...FAST, think: [400, 400] };
  const server = await createInteractiveServer({ pace: lateProfile });
  try {
    const stop = new AbortController();
    const response = await post(server.origin, SCENARIOS.neverFinishes, stop.signal);
    const reader = response.body!.getReader();
    await reader.read(); // RUN_STARTED; the think pause is now running
    assert.equal(server.openStreams(), 1, 'the connection is open while it thinks');
    stop.abort();
    await assert.rejects(reader.read());
    for (let tries = 0; tries < 50 && server.openStreams() > 0; tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(server.openStreams(), 0, 'the connection was released');
  } finally {
    await server.close();
  }
});
