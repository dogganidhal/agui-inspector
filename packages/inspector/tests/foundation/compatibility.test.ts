// F01 T004: the pinned baseline packages must work together. A mismatch here blocks
// implementation; it is never a reason to change the baseline.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { bundleOptions } from '../../../../scripts/build.mjs';
import { A2uiSurface, basicCatalog } from '@a2ui/react/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import {
  RENDER_A2UI_TOOL,
  RENDER_A2UI_TOOL_NAME,
  type A2UIForwardedProps,
} from '@ag-ui/a2ui-middleware';
import { EventType, PROTOCOL_VERSION, type ResumeEntry, type RunAgentInput, type Tool } from '@ag-ui/core';
import { EventSchemas, ResumeEntrySchema, RunAgentInputSchema } from '@ag-ui/core/schemas';
import { HttpAgent, buildResumeArray, type AgentSubscriber, type RunAgentResult } from '@ag-ui/client';

const BASELINE_EVENT_TYPES = [
  'RUN_STARTED', 'RUN_FINISHED', 'RUN_ERROR',
  'STEP_STARTED', 'STEP_FINISHED',
  'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'TEXT_MESSAGE_CHUNK',
  'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_CHUNK', 'TOOL_CALL_RESULT',
  'REASONING_START', 'REASONING_MESSAGE_START', 'REASONING_MESSAGE_CONTENT', 'REASONING_MESSAGE_END',
  'REASONING_MESSAGE_CHUNK', 'REASONING_END', 'REASONING_ENCRYPTED_VALUE',
  'STATE_SNAPSHOT', 'STATE_DELTA', 'MESSAGES_SNAPSHOT',
  'ACTIVITY_SNAPSHOT', 'ACTIVITY_DELTA',
  'SUBAGENT_STARTED', 'SUBAGENT_FINISHED', 'SUBAGENT_ERROR',
  'CUSTOM', 'RAW',
] as const;

const encoder = new TextEncoder();

function sse(events: readonly object[], delimiter = '\n\n'): string {
  return events.map((event) => `data: ${JSON.stringify(event)}${delimiter}`).join('');
}

/** An SSE response delivered in tiny chunks so event boundaries are split. */
function streamingResponse(text: string, chunkSize = 7): Response {
  const bytes = encoder.encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          controller.enqueue(bytes.slice(offset, offset + chunkSize));
        }
        controller.close();
      },
    }),
    { status: 200 },
  );
}

interface Capture {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
  recorded: Promise<string>;
}

/**
 * A recorder-shaped fetch: tees the response with `Response.clone()`, drains the clone on its
 * own, and hands the original to the client. It never reads headers.
 */
function recordingFetch(responseText: string, captures: Capture[]) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    const response = streamingResponse(responseText);
    const branch = response.clone();
    const recorded = (async () => {
      const decoder = new TextDecoder();
      let text = '';
      const reader = branch.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    })();
    captures.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown>, recorded });
    return response;
  };
}

const runStarted = { type: EventType.RUN_STARTED, threadId: 't1', runId: 'r1' };
const runFinishedSuccess = { type: EventType.RUN_FINISHED, threadId: 't1', runId: 'r1', outcome: { type: 'success' } };

test('baseline protocol declares exactly the 31 named event types', () => {
  assert.equal(PROTOCOL_VERSION, '1.0');
  assert.deepEqual(Object.keys(EventType).sort(), [...BASELINE_EVENT_TYPES].sort());
  assert.equal(BASELINE_EVENT_TYPES.length, 31);
  assert.ok(EventSchemas, 'the upstream event schema is exported for frame validation');
});

test('run-input schema accepts protocolVersion, parentRunId and resume entries', () => {
  const resolved: ResumeEntry = { interruptId: 'i1', status: 'resolved', payload: { approved: true } };
  const cancelled: ResumeEntry = { interruptId: 'i2', status: 'cancelled' };
  assert.equal(ResumeEntrySchema.safeParse(resolved).success, true);
  assert.equal(ResumeEntrySchema.safeParse(cancelled).success, true);
  assert.equal(ResumeEntrySchema.safeParse({ interruptId: 'i3', status: 'abandoned' }).success, false);

  const input: RunAgentInput = {
    threadId: 't1',
    runId: 'r2',
    parentRunId: 'r1',
    protocolVersion: '1.0',
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: {},
    resume: [resolved, cancelled],
  };
  assert.equal(RunAgentInputSchema.safeParse(input).success, true);
  // The raw editor flags schema violations but still sends them: the schema must reject this.
  assert.equal(RunAgentInputSchema.safeParse({ threadId: 17 }).success, false);
});

test('HttpAgent sends through the injected fetch and the client does not need our headers', async () => {
  const captures: Capture[] = [];
  const agent = new HttpAgent({
    url: 'http://agent.invalid/run',
    threadId: 't1',
    fetch: recordingFetch(sse([runStarted, runFinishedSuccess]), captures),
  });
  await agent.runAgent({ runId: 'r1' });

  assert.equal(captures.length, 1);
  const [capture] = captures;
  assert.equal(capture!.url, 'http://agent.invalid/run');
  assert.equal(capture!.init.method, 'POST');
  assert.equal(typeof capture!.init.body, 'string', 'the exact request body text is available to the recorder');
  assert.equal(capture!.body.threadId, 't1');
  assert.equal(capture!.body.runId, 'r1');
  assert.equal(capture!.body.protocolVersion, PROTOCOL_VERSION);
});

test('the pinned client cuts events on two LF only: CRLF and CR streams fail in it, which is why the runtime hands it an LF copy', async () => {
  // Issue #49. The runtime's copy (src/core/runtime/line-endings.ts) is temporary: when this test fails, the pinned
  // client frames CRLF and CR itself (ag-ui-protocol/ag-ui#2939), so delete the copy and update website/content/docs/dependencies.mdx.
  const events = [runStarted, runFinishedSuccess];
  for (const [name, delimiter] of [['LF', '\n\n'], ['CRLF', '\r\n\r\n'], ['CR', '\r\r']] as const) {
    const seen: { failed?: Error; finished?: boolean } = {};
    const agent = new HttpAgent({ url: 'http://agent.invalid/run', threadId: 't1', fetch: async () => streamingResponse(sse(events, delimiter)) });
    await agent
      .runAgent({ runId: 'r1' }, { onRunFailed: ({ error }) => void (seen.failed = error), onRunFinishedEvent: () => void (seen.finished = true) })
      .catch(() => undefined);
    assert.equal(seen.finished === true, name === 'LF', `${name}: the client ${name === 'LF' ? 'reads' : 'does not read'} the stream`);
    assert.equal(seen.failed === undefined, name === 'LF', `${name}: ${name === 'LF' ? 'no' : 'a'} parse failure`);
  }
});

test('protocolVersion and parentRunId reach the request through the documented requestInit override', async () => {
  class ProfileAgent extends HttpAgent {
    protected override requestInit(input: RunAgentInput): RequestInit {
      const base = super.requestInit(input);
      return { ...base, body: JSON.stringify({ ...input, protocolVersion: '0.9', parentRunId: 'parent-run' }) };
    }
  }
  const captures: Capture[] = [];
  const agent = new ProfileAgent({
    url: 'http://agent.invalid/run',
    threadId: 't1',
    fetch: recordingFetch(sse([runStarted, runFinishedSuccess]), captures),
  });
  await agent.runAgent({ runId: 'r2' });
  assert.equal(captures[0]!.body.protocolVersion, '0.9');
  assert.equal(captures[0]!.body.parentRunId, 'parent-run');
});

test('resume answers, cancellations, tools, context and forwardedProps are sent as supplied', async () => {
  const interrupts = [
    { id: 'i1', reason: 'approval', responseSchema: { type: 'object' } },
    { id: 'i2', reason: 'approval' },
  ];
  const resume = buildResumeArray(interrupts, {
    i1: { status: 'resolved', payload: { approved: true } },
    i2: { status: 'cancelled' },
  });
  assert.deepEqual(resume, [
    { interruptId: 'i1', status: 'resolved', payload: { approved: true } },
    { interruptId: 'i2', status: 'cancelled' },
  ]);
  assert.throws(
    () => buildResumeArray(interrupts, { i1: { status: 'resolved', payload: 1 } }),
    /missing responses for open interrupts: i2/,
    'continuation requires every interrupt to be answered',
  );

  const captures: Capture[] = [];
  const agent = new HttpAgent({
    url: 'http://agent.invalid/run',
    threadId: 't1',
    fetch: recordingFetch(sse([runStarted, runFinishedSuccess]), captures),
  });
  const tools: Tool[] = [{ name: 'lookup', description: 'Look something up', parameters: { type: 'object' } }];
  await agent.runAgent({
    runId: 'r2',
    tools,
    context: [{ description: 'locale', value: 'fr-FR' }],
    forwardedProps: { user: 'u1' },
    resume,
  });
  const { body } = captures[0]!;
  assert.deepEqual(body.resume, resume);
  assert.deepEqual(body.tools, tools);
  assert.deepEqual(body.context, [{ description: 'locale', value: 'fr-FR' }]);
  assert.deepEqual(body.forwardedProps, { user: 'u1' });
});

test('interrupt, cancellation and success outcomes reach client callbacks', async () => {
  const outcomes: string[] = [];
  const subscriber: AgentSubscriber = {
    onRunFinishedEvent: (params) => {
      outcomes.push(params.outcome);
    },
  };
  const finished = (outcome: object) => ({ ...runFinishedSuccess, outcome });
  for (const outcome of [
    { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval' }] },
    { type: 'cancelled' },
    { type: 'success' },
  ]) {
    const agent = new HttpAgent({
      url: 'http://agent.invalid/run',
      threadId: 't1',
      fetch: recordingFetch(sse([runStarted, finished(outcome)]), []),
    });
    await agent.runAgent({ runId: 'r1' }, subscriber);
  }
  assert.deepEqual(outcomes, ['interrupt', 'cancelled', 'success']);
});

test('sequence violations are reported to the client while the recording branch keeps every byte', async () => {
  const stream = sse([
    runStarted,
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'no start event' },
    { type: EventType.STEP_STARTED, stepName: 'after the violation' },
    runFinishedSuccess,
  ]);
  const captures: Capture[] = [];
  const failures: string[] = [];
  const agent = new HttpAgent({
    url: 'http://agent.invalid/run',
    threadId: 't1',
    fetch: recordingFetch(stream, captures),
  });
  const originalConsoleError = console.error;
  console.error = () => {}; // the client logs the failure with its stack
  try {
    await assert.rejects(
      agent.runAgent({ runId: 'r1' }, { onRunFailed: ({ error }) => void failures.push(error.message) }),
      /TEXT_MESSAGE_CONTENT/,
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(failures.length, 1);
  assert.match(failures[0]!, /No active text message found/);
  assert.equal(await captures[0]!.recorded, stream, 'recording continued past the client failure, byte for byte');
});

test('chunk events stay in the recording while the client derives expanded events', async () => {
  const chunk = { type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', role: 'assistant', delta: 'hello' };
  const stream = sse([runStarted, chunk, runFinishedSuccess]);
  const captures: Capture[] = [];
  const derived: string[] = [];
  const agent = new HttpAgent({
    url: 'http://agent.invalid/run',
    threadId: 't1',
    fetch: recordingFetch(stream, captures),
  });
  const result: RunAgentResult = await agent.runAgent(
    { runId: 'r1' },
    {
      onTextMessageStartEvent: () => void derived.push('start'),
      onTextMessageContentEvent: ({ event }) => void derived.push(`content:${event.delta}`),
      onTextMessageEndEvent: () => void derived.push('end'),
    },
  );
  assert.deepEqual(derived, ['start', 'content:hello', 'end']);
  assert.equal(result.newMessages[0]?.content, 'hello');
  const recorded = await captures[0]!.recorded;
  assert.equal(recorded, stream);
  assert.ok(recorded.includes('TEXT_MESSAGE_CHUNK'), 'the original chunk is still in the recording');
  assert.ok(!recorded.includes('TEXT_MESSAGE_START'), 'expansions are not part of the wire');
});

test('the middleware render tool is the upstream declaration and fits the run input', async () => {
  assert.equal(RENDER_A2UI_TOOL_NAME, 'render_a2ui');
  assert.equal(RENDER_A2UI_TOOL.name, RENDER_A2UI_TOOL_NAME);
  const tool: Tool = RENDER_A2UI_TOOL;
  assert.equal(RunAgentInputSchema.safeParse({
    threadId: 't1', runId: 'r1', messages: [], tools: [tool],
  }).success, true);

  const captures: Capture[] = [];
  const agent = new HttpAgent({
    url: 'http://agent.invalid/run',
    threadId: 't1',
    fetch: recordingFetch(sse([runStarted, runFinishedSuccess]), captures),
  });
  await agent.runAgent({ runId: 'r1', tools: [tool] });
  assert.deepEqual(captures[0]!.body.tools, [JSON.parse(JSON.stringify(tool))]);
});

test('A2UI v0.9 renderer packages build a surface and report actions in the middleware envelope', () => {
  assert.equal(typeof A2uiSurface, 'function');
  const actions: Array<Record<string, unknown>> = [];
  const processor = new MessageProcessor([basicCatalog], (action) => void actions.push({ ...action }));
  processor.processMessages([
    { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: basicCatalog.id } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's1',
        components: [
          { id: 'root', component: 'Column', children: ['label', 'go'] },
          { id: 'label', component: 'Text', text: 'Hello' },
          { id: 'go-label', component: 'Text', text: 'Go' },
          { id: 'go', component: 'Button', child: 'go-label', action: { event: { name: 'go', context: { n: 1 } } } },
        ],
      },
    },
  ]);
  const surface = processor.model.getSurface('s1');
  assert.ok(surface, 'surface created from catalog-matched v0.9 messages');
  surface.dispatchAction({ name: 'go', surfaceId: 's1', sourceComponentId: 'go', timestamp: '2026-10-02T00:00:00.000Z', context: { n: 1 } }, 'go');
  assert.equal(actions.length, 1);
  const { name, surfaceId, sourceComponentId, context, timestamp } = actions[0]!;

  // forwardedProps.a2uiAction.userAction carries exactly these five fields.
  const forwardedProps: A2UIForwardedProps = {
    a2uiAction: { userAction: { name: name as string, surfaceId: surfaceId as string, sourceComponentId: sourceComponentId as string, context: context as Record<string, unknown>, timestamp: timestamp as string } },
  };
  assert.deepEqual(Object.keys(forwardedProps.a2uiAction!.userAction).sort(), ['context', 'name', 'sourceComponentId', 'surfaceId', 'timestamp']);
  assert.equal(forwardedProps.a2uiAction!.userAction.surfaceId, 's1');
});

test('renderer and protocol packages bundle for the browser without Node built-ins', async () => {
  const result = await build({
    ...bundleOptions('unused'),
    stdin: {
      contents: `
        import { A2uiSurface, basicCatalog } from '@a2ui/react/v0_9';
        import { MessageProcessor } from '@a2ui/web_core/v0_9';
        import { HttpAgent } from '@ag-ui/client';
        import { RENDER_A2UI_TOOL } from '@ag-ui/a2ui-middleware';
        import { createRoot } from 'react-dom/client';
        console.log(A2uiSurface, basicCatalog, MessageProcessor, HttpAgent, RENDER_A2UI_TOOL, createRoot);
      `,
      resolveDir: import.meta.dirname,
      loader: 'ts',
    },
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  assert.equal(result.errors.length, 0);
  const script = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  assert.ok(script.includes('render_a2ui'), 'the upstream render tool is in the bundle');
  for (const output of Object.values(result.metafile.outputs)) {
    // clarinet (via the middleware) probes `require("stream")` inside try/catch; browsers fall back.
    const unexpected = output.imports.filter((entry) => !(entry.kind === 'require-call' && entry.path === 'stream'));
    assert.deepEqual(unexpected, [], 'no external or Node built-in import survives bundling');
  }
});
