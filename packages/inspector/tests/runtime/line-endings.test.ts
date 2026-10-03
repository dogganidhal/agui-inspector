// Issue #49: an event stream may end its lines with LF, CRLF or a bare CR, and a run over any of them
// has to leave the same transcript, state and outcome behind. The tests read what the next request
// carries, because that is where a client that failed to read a stream shows: no assistant message
// and stale state, while the recording and the projected conversation still look fine.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Interrupt } from '@ag-ui/core';
import type { InspectionSession } from '../../src/contracts.ts';
import { canonicalizeLineEndings } from '../../src/core/runtime/line-endings.ts';
import { AGENT, bodyOf, eventStream, openStream, rig, sse, type Call, type Route } from './support.ts';

const ENDINGS = { LF: '\n', CRLF: '\r\n', CR: '\r' } as const;
const NON_LF = [['CRLF', ENDINGS.CRLF], ['CR', ENDINGS.CR]] as const;

type Sent = { threadId: string; runId: string; state: unknown; messages: Array<{ role: string; content?: string }>; resume?: unknown };
const inputOf = (call: Call | undefined) => bodyOf(call) as unknown as Sent;
const head = (call: Call) => {
  const { threadId, runId } = inputOf(call);
  return { threadId, runId };
};
const start = (call: Call) => ({ type: 'RUN_STARTED', ...head(call) });
const finish = (call: Call, outcome: object = { type: 'success' }) => ({ type: 'RUN_FINISHED', ...head(call), outcome });
const reply = (call: Call, text = 'server reply') => {
  const messageId = `m-${head(call).runId}`;
  return [
    { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text },
    { type: 'TEXT_MESSAGE_END', messageId },
  ];
};

/** The stream the issue reproduces: a state snapshot and an assistant reply. `body` writes the events as the wire text. */
const counting = (body: (events: object[]) => string, options: { chunk?: number } = {}): Route => (call) =>
  call.path === '/run' ? eventStream(body([start(call), { type: 'STATE_SNAPSHOT', snapshot: { count: 7 } }, ...reply(call), finish(call)]), options) : undefined;
const withEnding = (ending: string) => (events: object[]) => sse(events, ending + ending);

const agent = { id: 'agent', name: 'Agent', url: AGENT } as const;
/** The same identifiers in every run of a test, so frames sent over different endings can be compared. */
const fixedIds = () => {
  let n = 0;
  return () => `id-${(n += 1)}`;
};

/** Two ordinary turns, as the issue's reproduction does, and what each side saw. */
async function twoTurns(route: Route) {
  const { runtime, net, settle } = rig([route]);
  runtime.selectAgent(agent);
  await runtime.send('one');
  await runtime.send('two');
  const session = await settle();
  const second = inputOf(net.on('/run')[1]);
  return {
    session,
    runtimeError: runtime.getState().error,
    outcomes: session.runs.map((run) => run.outcome),
    nextState: second.state,
    nextMessages: second.messages.map((message) => [message.role, message.content]),
    findings: session.findings.map((finding) => [finding.kind, finding.subject.type]),
  };
}

const EXPECTED_NEXT_MESSAGES = [['user', 'one'], ['assistant', 'server reply'], ['user', 'two']];

// ---------------------------------------------------------------------------------------------
// The next request after a run over each ending
// ---------------------------------------------------------------------------------------------

for (const [name, ending] of Object.entries(ENDINGS)) {
  test(`${name}: the run succeeds and the next request carries the assistant reply and the updated state`, async () => {
    const result = await twoTurns(counting(withEnding(ending)));
    assert.deepEqual(result.outcomes, [{ kind: 'success', pendingToolCallIds: [] }, { kind: 'success', pendingToolCallIds: [] }]);
    assert.deepEqual(result.nextState, { count: 7 });
    assert.deepEqual(result.nextMessages, EXPECTED_NEXT_MESSAGES);
    assert.deepEqual(result.findings, [], 'a valid stream leaves no finding, whichever ending it uses');
    assert.equal(result.runtimeError, undefined);
  });
}

test('LF, CRLF, CR and a stream that mixes all three leave the same messages, state, outcomes and findings', async () => {
  const mixed = (events: object[]) => events.map((event, index) => `data: ${JSON.stringify(event)}${[ENDINGS.CRLF, ENDINGS.CR, ENDINGS.LF][index % 3]!.repeat(2)}`).join('');
  const summary = async (route: Route) => {
    const { outcomes, nextState, nextMessages, findings } = await twoTurns(route);
    return { outcomes, nextState, nextMessages, findings };
  };
  const reference = await summary(counting(withEnding(ENDINGS.LF)));
  for (const [name, body] of [['CRLF', withEnding(ENDINGS.CRLF)], ['CR', withEnding(ENDINGS.CR)], ['mixed', mixed]] as const) {
    assert.deepEqual(await summary(counting(body)), reference, name);
  }
});

test('a delimiter cut anywhere in the network chunks is read the same: one byte at a time splits every CR from its LF', async () => {
  for (const [name, ending] of NON_LF) {
    for (const chunk of [1, 2, 3]) {
      const result = await twoTurns(counting(withEnding(ending), { chunk }));
      assert.deepEqual([result.nextState, result.nextMessages, result.findings], [{ count: 7 }, EXPECTED_NEXT_MESSAGES, []], `${name} in ${chunk}-byte chunks`);
    }
  }
});

test('an event written over several data lines is one event under every ending', async () => {
  const multiline = (ending: string) => (events: object[]) =>
    events.map((event) => JSON.stringify(event, null, 1).split('\n').map((line) => `data: ${line}${ending}`).join('') + ending).join('');
  for (const [name, ending] of Object.entries(ENDINGS)) {
    for (const chunk of [1, 64]) {
      const result = await twoTurns(counting(multiline(ending), { chunk }));
      assert.deepEqual([result.nextState, result.nextMessages, result.findings], [{ count: 7 }, EXPECTED_NEXT_MESSAGES, []], `${name} in ${chunk}-byte chunks`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// What was recorded is what was sent
// ---------------------------------------------------------------------------------------------

const frameText = (session: InspectionSession) => session.frames.map((frame) => frame.envelope).join('');

test('the recording keeps the delimiters exactly as sent, in arrival order, for the same frames as an LF stream', async () => {
  const wires: string[] = [];
  const recorded = async (ending: string) => {
    const { runtime, settle } = rig(
      [
        counting((events) => {
          const wire = withEnding(ending)(events);
          wires.push(wire);
          return wire;
        }),
      ],
      { randomUUID: fixedIds() },
    );
    runtime.selectAgent(agent);
    await runtime.send('one');
    return settle();
  };
  const sessions = { LF: await recorded(ENDINGS.LF), CRLF: await recorded(ENDINGS.CRLF), CR: await recorded(ENDINGS.CR) };
  const [lf, crlf, cr] = wires as [string, string, string];
  assert.equal(frameText(sessions.LF), lf);
  assert.equal(frameText(sessions.CRLF), crlf, 'CRLF is not turned into LF in the recording');
  assert.equal(frameText(sessions.CR), cr, 'CR is not turned into LF in the recording');
  assert.equal(crlf, lf.replaceAll('\n', '\r\n'), 'the three wires differ only in their endings');
  assert.equal(cr, lf.replaceAll('\n', '\r'));
  const types = (session: InspectionSession) => session.frames.map((frame) => [frame.index, frame.eventType, frame.schemaVerdict, frame.data]);
  assert.deepEqual(types(sessions.CRLF), types(sessions.LF));
  assert.deepEqual(types(sessions.CR), types(sessions.LF));
  assert.ok(sessions.CRLF.frames.every((frame) => frame.envelope.endsWith('\r\n\r\n')));
  assert.ok(sessions.CR.frames.every((frame) => frame.envelope.endsWith('\r\r')));
  assert.deepEqual(sessions.CRLF.findings, []);
  assert.deepEqual(sessions.CR.findings, []);
});

test('a frame that is not JSON ends the client run, not the recording, and the CRLF run reports the same findings as the LF one', async () => {
  const stream = (ending: string): Route => (call) =>
    call.path === '/run' ? eventStream(sse([start(call), '{not json at all', ...reply(call), finish(call)], ending + ending)) : undefined;
  const run = async (ending: string) => {
    const { runtime, settle } = rig([stream(ending)], { randomUUID: fixedIds() });
    runtime.selectAgent(agent);
    await runtime.send('malformed');
    const session = await settle();
    return {
      frames: session.frames.map((frame) => [frame.eventType, frame.jsonVerdict, frame.data]),
      findings: session.findings.map((finding) => [finding.kind, finding.subject.type]),
      transport: session.exchanges[0]?.transport,
    };
  };
  const lf = await run(ENDINGS.LF);
  assert.equal(lf.frames.length, 6, 'every frame after the malformed one is captured');
  assert.deepEqual(await run(ENDINGS.CRLF), lf);
  assert.deepEqual(await run(ENDINGS.CR), lf);
});

// ---------------------------------------------------------------------------------------------
// Continuations
// ---------------------------------------------------------------------------------------------

const interrupts: Interrupt[] = [{ id: 'i-1', reason: 'approval', responseSchema: { type: 'object', properties: { approved: { type: 'boolean' } } } }];

for (const [name, ending] of NON_LF) {
  test(`${name}: an interrupt is answered, and the resume carries the transcript, the state and the answer`, async () => {
    const route: Route = (call) => {
      if (call.path !== '/run') return undefined;
      const body = (events: object[]) => eventStream(sse(events, ending + ending), { chunk: 5 });
      if (inputOf(call).resume !== undefined) return body([start(call), finish(call)]);
      return body([start(call), { type: 'STATE_SNAPSHOT', snapshot: { count: 7 } }, ...reply(call, 'may I?'), finish(call, { type: 'interrupt', interrupts })]);
    };
    const { runtime, net, settle } = rig([route]);
    runtime.selectAgent(agent);
    await runtime.send('refund my order');
    assert.deepEqual(runtime.getState().interrupts.map((answer) => answer.interruptId), ['i-1'], 'the interrupt is recognized');

    runtime.draftInterrupt('i-1', { approved: true });
    await runtime.answerInterrupt('i-1', 'resolved');
    assert.equal(net.on('/run').length, 2);
    const resume = inputOf(net.on('/run')[1]);
    assert.deepEqual(resume.resume, [{ interruptId: 'i-1', status: 'resolved', payload: { approved: true } }]);
    assert.deepEqual(resume.state, { count: 7 });
    assert.deepEqual(resume.messages.map((message) => [message.role, message.content]), [['user', 'refund my order'], ['assistant', 'may I?']]);

    const session = await settle();
    assert.deepEqual(session.runs[0]?.outcome, { kind: 'interrupt', interrupts });
    assert.deepEqual(session.runs[1]?.outcome, { kind: 'success', pendingToolCallIds: [] });
    assert.deepEqual(session.findings, []);
  });

  test(`${name}: a pending client tool call is answered, and the continuation carries the call, the result and the state`, async () => {
    const route: Route = (call) => {
      if (call.path !== '/run') return undefined;
      const body = (events: object[]) => eventStream(sse(events, ending + ending), { chunk: 5 });
      if (inputOf(call).messages.some((message) => message.role === 'tool')) return body([start(call), finish(call)]);
      return body([
        start(call),
        { type: 'STATE_SNAPSHOT', snapshot: { count: 7 } },
        { type: 'TOOL_CALL_START', toolCallId: 'c-1', toolCallName: 'pick_color' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'c-1', delta: '{"choices":["red","teal"]}' },
        { type: 'TOOL_CALL_END', toolCallId: 'c-1' },
        finish(call),
      ]);
    };
    const { runtime, net, settle } = rig([route]);
    runtime.selectAgent(agent);
    await runtime.send('pick a color');
    assert.deepEqual(runtime.getState().toolResults.map((draft) => [draft.toolCallId, draft.toolName]), [['c-1', 'pick_color']], 'the pending call is recognized');

    runtime.draftToolResult('c-1', '"teal"');
    await runtime.submitToolResult('c-1');
    assert.equal(net.on('/run').length, 2);
    const next = inputOf(net.on('/run')[1]);
    assert.deepEqual(next.state, { count: 7 });
    assert.deepEqual(next.messages.map((message) => message.role), ['user', 'assistant', 'tool']);
    assert.deepEqual(next.messages[2]?.content, '"teal"');

    const session = await settle();
    assert.deepEqual(session.runs[0]?.outcome, { kind: 'success', pendingToolCallIds: ['c-1'] });
    assert.deepEqual(session.findings, []);
  });
}

// ---------------------------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------------------------

const pause = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

for (const [name, ending] of NON_LF) {
  test(`${name}: Stop ends a stream that never ends, keeps the partial recording as sent and makes up no terminal event`, async () => {
    const sent: string[] = [];
    const { runtime, net, settle } = rig([
      (call) => {
        if (call.path !== '/run') return undefined;
        const wire = sse([start(call), ...reply(call, 'partial').slice(0, 2)], ending + ending);
        sent.push(wire);
        // Like a real connection, the body errors when the request is aborted; until then it stays open.
        return eventStream(wire, { hold: true, chunk: 5, ...(call.signal && { signal: call.signal }) });
      },
    ], { randomUUID: fixedIds() });
    runtime.selectAgent(agent);
    const running = runtime.send('stream please');
    await pause(60);
    assert.equal(runtime.getState().running, true, 'the client is still reading');
    const signal = net.on('/run')[0]?.signal as AbortSignal;

    runtime.stop();
    assert.equal(signal.aborted, true);
    await running;
    const session = await settle();

    assert.equal(runtime.getState().running, false);
    assert.equal(runtime.getState().capturing, false);
    assert.equal(runtime.getState().error, undefined, 'a stop is not an error');
    assert.equal(session.exchanges[0]?.transport, 'user-stopped');
    assert.equal(frameText(session), sent[0], 'what was recorded before the stop is the bytes as sent');
    assert.ok(session.frames.every((frame) => frame.envelope.endsWith(ending + ending)));
    assert.deepEqual(session.runs[0]?.outcome, { kind: 'unknown' });
    assert.ok(session.frames.every((frame) => frame.eventType !== 'RUN_FINISHED' && frame.eventType !== 'RUN_ERROR'));
  });

  test(`${name}: Stop still ends a recording that is open after the client rejected a malformed frame`, async () => {
    const stream = openStream();
    const { runtime, net, session, settle } = rig([
      (call) => {
        if (call.path !== '/run') return undefined;
        stream.push(sse([start(call), '{not json at all'], ending + ending));
        return stream.response;
      },
    ], { randomUUID: fixedIds() });
    runtime.selectAgent(agent);
    await runtime.send('malformed');
    await pause();
    const signal = net.on('/run')[0]?.signal as AbortSignal;
    assert.equal(runtime.getState().running, false, 'the client gave up on the stream');
    assert.equal(signal.aborted, false, 'the recording is not stopped because the client rejected a frame');
    // A frame that ends in a bare CR is only complete once the next byte shows it is not half of a CRLF, so it may wait for the stop.
    stream.push(sse([{ type: 'STEP_STARTED', stepName: 'after the rejection' }], ending + ending));
    await pause();
    assert.ok(session().frames.length >= 2, 'capture carries on past the rejection');

    const capturing = runtime.getState().capturing;
    runtime.stop();
    assert.equal(capturing, true, 'Stop was available the whole time');
    assert.equal(signal.aborted, true);
    const ended = await settle();
    assert.equal(ended.exchanges[0]?.transport, 'user-stopped');
    assert.deepEqual(ended.frames.map((frame) => frame.eventType), ['RUN_STARTED', undefined, 'STEP_STARTED'], 'everything read before the stop stays');
    assert.ok(ended.frames.every((frame) => frame.envelope.endsWith(ending + ending)));
    assert.equal(runtime.getState().capturing, false);
  });
}

// ---------------------------------------------------------------------------------------------
// The copy the client reads
// ---------------------------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const streamOf = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

async function read(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  let text = '';
  for (let step = await reader.read(); !step.done; step = await reader.read()) text += decoder.decode(step.value, { stream: true });
  return text + decoder.decode();
}

test('every ending becomes LF, wherever the chunks are cut, and nothing else changes', async () => {
  const text = 'a\r\nb\rc\n\r\nd\r\r\ne\n\rf\n\ng é✓ 🙂\r\n\r\n';
  const reference = text.replace(/\r\n|\r/g, '\n');
  const bytes = encoder.encode(text);
  const canonical = async (cuts: number[]) => {
    const edges = [0, ...cuts, bytes.length];
    const chunks = edges.slice(1).map((end, index) => bytes.slice(edges[index], end));
    return read(canonicalizeLineEndings(new Response(streamOf(chunks), { status: 200 })));
  };
  assert.equal(await canonical([]), reference);
  for (let first = 1; first < bytes.length; first += 1) {
    assert.equal(await canonical([first]), reference, `cut at ${first}`);
    for (let second = first + 1; second < bytes.length; second += 1) assert.equal(await canonical([first, second]), reference, `cuts at ${first} and ${second}`);
  }
  assert.equal(await canonical(Array.from(bytes, (_, index) => index).slice(1)), reference, 'one byte at a time');
});

test('only an event-stream answer is copied: an error body and a bodiless answer come back as they are', () => {
  const failed = new Response('line\r\nline', { status: 500 });
  const empty = new Response(null, { status: 204 });
  for (const response of [failed, empty]) assert.equal(canonicalizeLineEndings(response), response);
});

test('the status, the status text and the headers are kept', () => {
  const source = new Response(streamOf([]), { status: 202, statusText: 'Accepted', headers: { 'content-type': 'text/event-stream', 'x-trace': 'abc' } });
  const copy = canonicalizeLineEndings(source);
  assert.deepEqual([copy.status, copy.statusText, copy.ok], [202, 'Accepted', true]);
  assert.deepEqual([copy.headers.get('content-type'), copy.headers.get('x-trace')], ['text/event-stream', 'abc']);
});

test('a connection that fails reaches the client with the same error, and cancelling the client cancels the connection', async () => {
  const aborted = new DOMException('The operation was aborted.', 'AbortError');
  const failing = canonicalizeLineEndings(new Response(new ReadableStream<Uint8Array>({ start: (controller) => controller.error(aborted) }), { status: 200 }));
  await assert.rejects(read(failing), (error: unknown) => error === aborted);

  let cancelled = false;
  const open = canonicalizeLineEndings(new Response(new ReadableStream<Uint8Array>({ cancel: () => void (cancelled = true) }), { status: 200 }));
  await open.body!.cancel();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true, 'stopping the client reads no further from the connection');
});
