// Spec 004 (client automation): the profile answers a finished run's interrupts and client tool calls, and the
// continuation goes out through the same path a developer's last answer takes. These tests drive the real runtime
// over a scripted network and read the request bodies the agent received, so "the same as a manual reply" is
// compared byte for byte, not assumed. Nothing here needs a browser, a model or a network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Interrupt } from '@ag-ui/core';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import type { A2uiAction, ClientProfileSettings, MessageMode } from '../../src/contracts.ts';
import { defaultProfile } from '../../src/core/profiles/index.ts';
import { AUTOMATIC_REPLY_LIMIT } from '../../src/core/runtime/replies.ts';
import { AGENT, bodyOf, eventStream, ok200, replyRoute, rig, sse, type Rig, type Route } from './support.ts';

interface Body {
  threadId: string;
  runId: string;
  parentRunId?: string;
  resume?: Array<{ interruptId: string; status: string; payload?: unknown }>;
  messages: Array<{ id: string; role: string; content?: string; toolCallId?: string }>;
  forwardedProps?: Record<string, unknown>;
}

const INTERRUPTS: Interrupt[] = [
  {
    id: 'i-approve',
    reason: 'approval',
    message: 'Approve the refund?',
    responseSchema: { type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' }, note: { type: 'string' } } },
  },
  { id: 'i-contact', reason: 'input' },
];

type Kind = 'interrupt' | 'tools' | 'tools-bad-arguments' | 'tools-odd-names';

/**
 * The agent. A continuation (a resume, or tool messages) is answered with a plain reply. A first run interrupts or calls
 * tools, by `kind`. While `loop.budget` lasts, every run, continuations included, ends with one new interrupt
 * (`loop.tools` false) or one new call to `pick_color` (`loop.tools` true): an agent that never stops asking.
 */
const loop = { budget: 0, tools: false };

function agent(kind: Kind): Route {
  return (call) => {
    if (call.path !== '/run') return undefined;
    const input = bodyOf(call) as unknown as Body;
    const start = { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId };
    const done = (outcome: object) => ({ type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId, outcome });
    const call1 = (id: string, name: string, args: string[], end = true) => [
      { type: 'TOOL_CALL_START', toolCallId: id, toolCallName: name },
      ...args.map((delta) => ({ type: 'TOOL_CALL_ARGS', toolCallId: id, delta })),
      ...(end ? [{ type: 'TOOL_CALL_END', toolCallId: id }] : []),
    ];
    if (loop.budget > 0) {
      loop.budget -= 1;
      if (loop.tools) return eventStream(sse([start, ...call1(`c-${input.runId}`, 'pick_color', ['{}']), done({ type: 'success' })]));
      return eventStream(sse([start, done({ type: 'interrupt', interrupts: [{ id: `i-${input.runId}`, reason: 'input' }] })]));
    }
    const continued = input.resume !== undefined || input.messages.some((message) => message.role === 'tool');
    if (continued) return eventStream(sse([start, done({ type: 'success' })]));
    if (kind === 'interrupt') return eventStream(sse([start, done({ type: 'interrupt', interrupts: INTERRUPTS })]));
    const calls =
      kind === 'tools'
        ? [...call1('c-1', 'pick_color', ['{"choices":', '["red","teal"]}']), ...call1('c-2', 'pick_size', ['{"n":3}'])]
        : kind === 'tools-bad-arguments'
          ? [...call1('c-1', 'pick_color', ['{"choices":']), ...call1('c-2', 'pick_size', ['{"n":3}'])]
          : ['constructor', 'toString', '__proto__'].flatMap((name, at) => call1(`k-${at}`, name, ['{}']));
    return eventStream(sse([start, ...calls, done({ type: 'success' })]));
  };
}

const supportAgent = { id: 'support', url: AGENT, preset: { prepare: [{ method: 'POST', path: '/prepare/warm' }] } } as const;
const otherAgent = { id: 'other', url: AGENT, preset: { prepare: [{ method: 'POST', path: '/prepare/warm' }] } } as const;
const tool = (name: string) => ({ name, description: `${name} tool`, parameters: { type: 'object', properties: {} } });
const TOOLS = [tool('pick_color'), tool('pick_size')];

const fixedIds = () => {
  let n = 0;
  return () => `u-${(n += 1)}`;
};

const withProfile = (patch: Partial<ClientProfileSettings>) => ({ settings: { profile: { ...defaultProfile(), tools: TOOLS, ...patch } } });
const runs = (r: Rig): Body[] => r.net.on('/run').map((call) => bodyOf(call) as unknown as Body);

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const quiet = () => new Promise((resolve) => setTimeout(resolve, 30));

function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) keysOf(item, found);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      found.push(key);
      keysOf(item, found);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// US1: interrupts
// ---------------------------------------------------------------------------------------------

test('resolve: one message is enough, and the continuation carries the starting answers, the parent run and no new message', async () => {
  loop.budget = 0;
  const r = rig([ok200, agent('interrupt')], withProfile({ interruptReply: 'resolve' }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('refund my order');

  assert.equal(runs(r).length, 2, 'send resolves after the continuation');
  const [first, second] = runs(r);
  assert.deepEqual(second?.resume, [
    { interruptId: 'i-approve', status: 'resolved', payload: { approved: false, note: '' } },
    { interruptId: 'i-contact', status: 'resolved', payload: {} },
  ]);
  assert.equal(second?.threadId, first?.threadId);
  assert.equal(second?.parentRunId, first?.runId);
  assert.deepEqual(second?.messages.map((message) => message.content), ['refund my order'], 'a resume adds no user message');
  assert.equal(RunAgentInputSchema.safeParse(second).success, true);
  assert.equal(r.net.on('/prepare/warm').length, 2, 'the continuation prepared again before it was sent');
  assert.deepEqual(r.runtime.getState().interrupts, [], 'what was carried is no longer waiting');
  assert.equal(r.runtime.getState().notice, undefined);
  assert.equal(r.runtime.getState().running, false);
});

test('cancel: every interrupt is cancelled with no payload, even when payloads are set', async () => {
  loop.budget = 0;
  const r = rig([ok200, agent('interrupt')], withProfile({ interruptReply: 'cancel', interruptPayloads: { approval: { approved: true } } }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('refund my order');
  assert.deepEqual(runs(r)[1]?.resume, [
    { interruptId: 'i-approve', status: 'cancelled' },
    { interruptId: 'i-contact', status: 'cancelled' },
  ]);
});

test('resolve with a payload for a reason: that payload as written for that reason, the starting answer for the others', async () => {
  loop.budget = 0;
  const payload = { approved: true, note: ' as written\n' };
  const r = rig([ok200, agent('interrupt')], withProfile({ interruptReply: 'resolve', interruptPayloads: { approval: payload } }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('refund my order');
  assert.deepEqual(runs(r)[1]?.resume, [
    { interruptId: 'i-approve', status: 'resolved', payload },
    { interruptId: 'i-contact', status: 'resolved', payload: {} },
  ]);
});

test('a payload that misses the response schema is sent as written and the run continues', async () => {
  loop.budget = 0;
  const r = rig([ok200, agent('interrupt')], withProfile({ interruptReply: 'resolve', interruptPayloads: { approval: { approved: 'yes' }, input: 'free text' } }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('refund my order');
  assert.equal(runs(r).length, 2);
  assert.deepEqual(runs(r)[1]?.resume, [
    { interruptId: 'i-approve', status: 'resolved', payload: { approved: 'yes' } },
    { interruptId: 'i-contact', status: 'resolved', payload: 'free text' },
  ]);
});

/** The two continuation bodies, one answered by the profile and one answered by hand, under the same identifier source. */
async function twoWays(mode: MessageMode, profile: Partial<ClientProfileSettings>, byHand: (r: Rig) => Promise<void>, kind: Kind = 'interrupt') {
  loop.budget = 0;
  const auto = rig([ok200, agent(kind)], { randomUUID: fixedIds(), ...withProfile({ ...profile, messageMode: mode }) });
  auto.runtime.selectAgent(supportAgent);
  await auto.runtime.send('refund my order');

  const manual = rig([ok200, agent(kind)], { randomUUID: fixedIds(), ...withProfile({ messageMode: mode }) });
  manual.runtime.selectAgent(supportAgent);
  await manual.runtime.send('refund my order');
  await byHand(manual);
  return { auto, manual };
}

test('the continuation of an automatic reply equals the one a developer sends, byte for byte, in both message modes', async () => {
  for (const mode of ['full', 'turn'] as const) {
    const cases: Array<[string, Partial<ClientProfileSettings>, (r: Rig) => Promise<void>]> = [
      [
        'resolve',
        { interruptReply: 'resolve' },
        async (r) => {
          await r.runtime.answerInterrupt('i-approve', 'resolved');
          await r.runtime.answerInterrupt('i-contact', 'resolved');
        },
      ],
      [
        'cancel',
        { interruptReply: 'cancel' },
        async (r) => {
          await r.runtime.answerInterrupt('i-approve', 'cancelled');
          await r.runtime.answerInterrupt('i-contact', 'cancelled');
        },
      ],
      [
        'resolve with a payload',
        { interruptReply: 'resolve', interruptPayloads: { approval: { approved: true, note: 'auto' } } },
        async (r) => {
          r.runtime.draftInterrupt('i-approve', { approved: true, note: 'auto' });
          await r.runtime.answerInterrupt('i-approve', 'resolved');
          await r.runtime.answerInterrupt('i-contact', 'resolved');
        },
      ],
    ];
    for (const [name, profile, byHand] of cases) {
      const { auto, manual } = await twoWays(mode, profile, byHand);
      assert.equal(runs(auto).length, 2, `${mode} ${name}`);
      assert.equal(auto.net.on('/run')[1]?.body, manual.net.on('/run')[1]?.body, `${mode} ${name}: the two request bodies are the same text`);
      assert.deepEqual(
        auto.net.calls.map((call) => call.path),
        manual.net.calls.map((call) => call.path),
        `${mode} ${name}: the same requests in the same order`,
      );
    }
  }
});

test('without an interrupt reply nothing is answered, whatever else the profile holds', async () => {
  loop.budget = 0;
  for (const patch of [{}, { interruptPayloads: { approval: { approved: true } } }, { toolResults: { pick_color: 'x' } }] as const) {
    const r = rig([ok200, agent('interrupt')], withProfile(patch));
    r.runtime.selectAgent(supportAgent);
    await r.runtime.send('refund my order');
    await quiet();
    assert.equal(runs(r).length, 1, JSON.stringify(patch));
    assert.deepEqual(r.runtime.getState().interrupts.map((answer) => answer.status), ['unanswered', 'unanswered']);
    assert.equal(r.runtime.getState().interrupts.some((answer) => answer.automatic === true), false);
    assert.match(r.runtime.getState().notice ?? '', /^2 interrupts waiting\. Answer them to continue the run\.$/);
  }
});

test('the profile in force when the run ends decides, and a change never answers replies that already wait', async () => {
  loop.budget = 0;
  // A profile edited while the run streams applies to that run's replies.
  const r = rig(
    [
      ok200,
      (call) => {
        if (call.path === '/run' && runs(r).length === 1) r.settings.current = { ...r.settings.current, profile: { ...r.settings.current.profile, interruptReply: 'resolve' } };
        return agent('interrupt')(call);
      },
    ],
    withProfile({}),
  );
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('refund my order');
  assert.equal(runs(r).length, 2, 'the setting in force at the end of the run answered it');

  // Replies that already wait stay by hand when the setting changes afterwards.
  const w = rig([ok200, agent('interrupt')], withProfile({}));
  w.runtime.selectAgent(supportAgent);
  await w.runtime.send('refund my order');
  w.settings.current = { ...w.settings.current, profile: { ...w.settings.current.profile, interruptReply: 'resolve' } };
  await quiet();
  assert.equal(runs(w).length, 1);
  assert.deepEqual(w.runtime.getState().interrupts.map((answer) => answer.status), ['unanswered', 'unanswered']);
});

test('an A2UI action is the developer\'s: automation neither sends one nor changes it', async () => {
  loop.budget = 0;
  const action: A2uiAction = { name: 'approve', surfaceId: 's-1', sourceComponentId: 'b-1', context: { n: 1 }, timestamp: '2026-10-04T10:00:00.000Z' };
  const r = rig([ok200, replyRoute()], withProfile({ interruptReply: 'resolve', toolResults: { pick_color: 'x' } }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('hello');
  assert.equal(runs(r).length, 1, 'a plain run starts nothing else');
  await r.runtime.sendA2uiAction(action);
  assert.equal(runs(r).length, 2);
  assert.deepEqual(runs(r)[1]?.forwardedProps?.a2uiAction, { userAction: action });
});

// ---------------------------------------------------------------------------------------------
// US2: client tool calls
// ---------------------------------------------------------------------------------------------

test('scripted results answer both calls, as written, and the continuation carries one tool message each, in order', async () => {
  loop.budget = 0;
  const results = { pick_color: ' "teal"\n', pick_size: '{"size":2}' };
  const r = rig([ok200, agent('tools')], withProfile({ toolResults: results }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('pick things');

  assert.equal(runs(r).length, 2);
  const second = runs(r)[1];
  assert.equal(second?.resume, undefined);
  assert.deepEqual(
    second?.messages.filter((message) => message.role === 'tool').map((message) => [message.toolCallId, message.content]),
    [['c-1', ' "teal"\n'], ['c-2', '{"size":2}']],
  );
  assert.equal(second?.parentRunId, runs(r)[0]?.runId);
  assert.equal(RunAgentInputSchema.safeParse(second).success, true);
  assert.deepEqual(r.runtime.getState().toolResults, []);
});

test('the continuation of scripted results equals the one a developer sends with the same text, in both message modes', async () => {
  for (const mode of ['full', 'turn'] as const) {
    const { auto, manual } = await twoWays(
      mode,
      { toolResults: { pick_color: ' "teal"\n', pick_size: '3' } },
      async (r) => {
        r.runtime.draftToolResult('c-1', ' "teal"\n');
        await r.runtime.submitToolResult('c-1');
        r.runtime.draftToolResult('c-2', '3');
        await r.runtime.submitToolResult('c-2');
      },
      'tools',
    );
    assert.equal(runs(auto).length, 2, mode);
    assert.equal(auto.net.on('/run')[1]?.body, manual.net.on('/run')[1]?.body, `${mode}: the same text, tool message ids included`);
  }
});

test('a tool without a script waits for the developer, and the developer\'s last result starts the continuation', async () => {
  loop.budget = 0;
  const r = rig([ok200, agent('tools')], withProfile({ toolResults: { pick_color: 'teal' } }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('pick things');
  await quiet();

  assert.equal(runs(r).length, 1, 'one call is still owed, so nothing is sent');
  assert.deepEqual(r.runtime.getState().toolResults.map((draft) => [draft.toolCallId, draft.status, draft.resultDraft, draft.automatic]), [
    ['c-1', 'answered', 'teal', true],
    ['c-2', 'pending', '', undefined],
  ]);
  assert.match(r.runtime.getState().notice ?? '', /^1 tool call waiting for a result\. Enter it to continue the run\.$/);

  r.runtime.draftToolResult('c-2', '3');
  await r.runtime.submitToolResult('c-2');
  assert.equal(runs(r).length, 2);
  assert.deepEqual(runs(r)[1]?.messages.filter((message) => message.role === 'tool').map((message) => [message.toolCallId, message.content]), [['c-1', 'teal'], ['c-2', '3']]);
});

test('a call whose arguments are not valid JSON still gets its scripted result', async () => {
  loop.budget = 0;
  const r = rig([ok200, agent('tools-bad-arguments')], withProfile({ toolResults: { pick_color: 'teal', pick_size: '3' } }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('pick things');
  assert.equal(runs(r).length, 2);
});

test('a tool name that looks like an object property finds no script and waits', async () => {
  loop.budget = 0;
  const r = rig([ok200, agent('tools-odd-names')], withProfile({ toolResults: { pick_color: 'teal' } }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('pick things');
  await quiet();
  assert.equal(runs(r).length, 1);
  assert.equal(r.runtime.getState().toolResults.every((draft) => draft.status === 'pending' && draft.automatic === undefined), true);
});

test('with no scripted results nothing answers a pending call', async () => {
  loop.budget = 0;
  const r = rig([ok200, agent('tools')], withProfile({ interruptReply: 'resolve' }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('pick things');
  await quiet();
  assert.equal(runs(r).length, 1);
  assert.equal(r.runtime.getState().toolResults.every((draft) => draft.status === 'pending'), true);
});

// ---------------------------------------------------------------------------------------------
// US3: the marks
// ---------------------------------------------------------------------------------------------

test('the recorded continuation says which replies the inspector answered, and the request says nothing of it', async () => {
  loop.budget = 0;
  const r = rig([ok200, agent('interrupt')], withProfile({ interruptReply: 'resolve' }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('refund my order');
  const session = await r.settle();
  assert.equal(session.runs[0]?.automaticReplies, undefined, 'the developer\'s own first run has none');
  assert.deepEqual(session.runs[1]?.automaticReplies, { interruptIds: ['i-approve', 'i-contact'], toolCallIds: [] });
  const wire = runs(r)[1];
  assert.equal(keysOf(wire).some((key) => /automatic/i.test(key)), false, 'no key of the request names it');
  assert.equal(JSON.stringify(session.runs[1]?.input), r.net.on('/run')[1]?.body, 'the recorded input is the request as sent');
});

test('scripted tool results are marked by call id, and a mixed continuation marks only the scripted one', async () => {
  loop.budget = 0;
  const all = rig([ok200, agent('tools')], withProfile({ toolResults: { pick_color: 'a', pick_size: 'b' } }));
  all.runtime.selectAgent(supportAgent);
  await all.runtime.send('pick things');
  assert.deepEqual((await all.settle()).runs[1]?.automaticReplies, { interruptIds: [], toolCallIds: ['c-1', 'c-2'] });

  const mixed = rig([ok200, agent('tools')], withProfile({ toolResults: { pick_color: 'a' } }));
  mixed.runtime.selectAgent(supportAgent);
  await mixed.runtime.send('pick things');
  assert.deepEqual(mixed.runtime.getState().toolResults.map((draft) => draft.automatic), [true, undefined], 'the cards can tell them apart while they wait');
  mixed.runtime.draftToolResult('c-2', 'by hand');
  await mixed.runtime.submitToolResult('c-2');
  assert.deepEqual((await mixed.settle()).runs[1]?.automaticReplies, { interruptIds: [], toolCallIds: ['c-1'] });
});

test('replies the developer gave carry no mark', async () => {
  loop.budget = 0;
  const r = rig([ok200, agent('interrupt')], withProfile({}));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('refund my order');
  await r.runtime.answerInterrupt('i-approve', 'resolved');
  await r.runtime.answerInterrupt('i-contact', 'cancelled');
  const session = await r.settle();
  assert.equal(runs(r).length, 2);
  assert.equal('automaticReplies' in (session.runs[1] ?? {}), false);
  assert.equal(r.runtime.getState().interrupts.length, 0);
});

test('a failed automatic continuation keeps its answers and marks, retries nothing, and the manual control sends it', async () => {
  loop.budget = 0;
  let prepares = 0;
  const r = rig(
    [
      (call) => {
        if (call.path !== '/prepare/warm') return undefined;
        prepares += 1;
        return new Response('{"error":"down"}', { status: prepares === 2 ? 500 : 200 });
      },
      agent('interrupt'),
    ],
    withProfile({ interruptReply: 'resolve' }),
  );
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('refund my order');
  await quiet();

  assert.equal(runs(r).length, 1, 'the continuation was not sent');
  assert.match(r.runtime.getState().error ?? '', /prepare|preparation|500/i);
  assert.deepEqual(r.runtime.getState().interrupts.map((answer) => [answer.status, answer.automatic]), [['resolved', true], ['resolved', true]]);
  assert.equal(r.net.on('/prepare/warm').length, 2, 'nothing is retried on its own');

  await r.runtime.continueRun();
  assert.equal(runs(r).length, 2, 'the existing control sends it');
  assert.deepEqual(runs(r)[1]?.resume?.map((entry) => entry.status), ['resolved', 'resolved']);
  assert.deepEqual((await r.settle()).runs[1]?.automaticReplies, { interruptIds: ['i-approve', 'i-contact'], toolCallIds: [] }, 'the marks survived the failure');
});

// ---------------------------------------------------------------------------------------------
// US5: the loop guard
// ---------------------------------------------------------------------------------------------

const PAUSED = `Automatic replies paused after ${AUTOMATIC_REPLY_LIMIT} in a row. Answer by hand to continue the run.`;

test('an agent that interrupts forever gets the first run and exactly 10 automatic continuations, then waits with a notice', async () => {
  loop.budget = Infinity;
  loop.tools = false;
  const r = rig([ok200, agent('interrupt')], withProfile({ interruptReply: 'resolve' }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('go');

  assert.equal(runs(r).length, 1 + AUTOMATIC_REPLY_LIMIT);
  const state = r.runtime.getState();
  assert.equal(state.running, false);
  assert.deepEqual(state.interrupts.map((answer) => answer.status), ['unanswered'], 'the 11th reply is left for the developer');
  assert.equal(state.interrupts[0]?.automatic, undefined);
  assert.equal(state.notice, `1 interrupt waiting. Answer it to continue the run. ${PAUSED}`);
  await quiet();
  assert.equal(runs(r).length, 1 + AUTOMATIC_REPLY_LIMIT, 'it does not start again on its own');
});

test('a developer\'s answer carries on, and the count starts again: up to 10 more automatic continuations', async () => {
  loop.budget = Infinity;
  const r = rig([ok200, agent('interrupt')], withProfile({ interruptReply: 'resolve' }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('go');
  const waiting = r.runtime.getState().interrupts[0]?.interruptId as string;
  await r.runtime.answerInterrupt(waiting, 'resolved');

  assert.equal(runs(r).length, 11 + 1 + AUTOMATIC_REPLY_LIMIT, 'one manual continuation, then 10 automatic ones');
  assert.equal(r.runtime.getState().notice?.endsWith(PAUSED), true);
  assert.equal((await r.settle()).runs[11]?.automaticReplies, undefined, 'the manual continuation is not marked');
  assert.deepEqual((await r.settle()).runs[12]?.automaticReplies?.interruptIds.length, 1, 'an automatic one is');
});

test('the pause notice goes away when the next run is sent, and on a new thread', async () => {
  loop.budget = Infinity;
  const r = rig([ok200, agent('interrupt')], withProfile({ interruptReply: 'resolve' }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('go');
  assert.equal(r.runtime.getState().notice?.endsWith(PAUSED), true);

  loop.budget = 0;
  await r.runtime.answerInterrupt(r.runtime.getState().interrupts[0]?.interruptId as string, 'cancelled');
  assert.equal(r.runtime.getState().notice, undefined, 'the continuation ended the chain');

  loop.budget = Infinity;
  const t = rig([ok200, agent('interrupt')], withProfile({ interruptReply: 'resolve' }));
  t.runtime.selectAgent(supportAgent);
  await t.runtime.send('go');
  assert.equal(t.runtime.getState().notice?.endsWith(PAUSED), true);
  t.runtime.newThread();
  assert.equal(t.runtime.getState().notice, undefined);
  assert.deepEqual(t.runtime.getState().interrupts, []);
});

test('a new thread, another agent and another target each start the count again', async () => {
  const restarts: Array<[string, (r: Rig) => void]> = [
    ['a new thread', (r) => r.runtime.newThread()],
    ['another agent', (r) => void r.runtime.selectAgent(otherAgent)],
    ['another target', (r) => void r.runtime.setTarget(`${AGENT}?other=1`)],
  ];
  for (const [name, restart] of restarts) {
    loop.budget = Infinity;
    const r = rig([ok200, agent('interrupt')], withProfile({ interruptReply: 'resolve' }));
    r.runtime.selectAgent(supportAgent);
    await r.runtime.send('go');
    assert.equal(runs(r).length, 11, name);

    restart(r);
    await r.runtime.send('go again');
    const sent = r.net.calls.filter((call) => call.path === '/run').length;
    assert.equal(sent, 11 + 1 + AUTOMATIC_REPLY_LIMIT, `${name}: 10 more automatic continuations`);
  }
});

test('an A2UI action starts the count again, after a chain that had not reached the limit', async () => {
  const action: A2uiAction = { name: 'go', surfaceId: 's-1', sourceComponentId: 'b-1', context: {}, timestamp: '2026-10-04T10:00:00.000Z' };
  loop.budget = 4;
  loop.tools = false;
  const r = rig([ok200, agent('interrupt')], withProfile({ interruptReply: 'resolve' }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('go');
  assert.equal(runs(r).length, 5, 'the first run, 3 automatic continuations that loop again, and one that ends it');
  assert.equal(r.runtime.getState().notice, undefined);

  loop.budget = Infinity;
  await r.runtime.sendA2uiAction(action);
  assert.equal(runs(r).length, 5 + 1 + AUTOMATIC_REPLY_LIMIT, 'the action run started a fresh count: 10 automatic continuations, not 6');
  assert.equal(r.runtime.getState().notice?.endsWith(PAUSED), true);
});

test('the same limit holds for a client tool that is scripted and called again on every run', async () => {
  loop.budget = Infinity;
  loop.tools = true;
  const r = rig([ok200, agent('tools')], withProfile({ toolResults: { pick_color: 'teal' } }));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('go');
  assert.equal(runs(r).length, 1 + AUTOMATIC_REPLY_LIMIT);
  assert.deepEqual(r.runtime.getState().toolResults.map((draft) => draft.status), ['pending']);
  assert.equal(r.runtime.getState().notice, `1 tool call waiting for a result. Enter it to continue the run. ${PAUSED}`);
  loop.tools = false;
  loop.budget = 0;
});

test('with the default profile an agent that asks forever is answered by nobody: one run, the usual notice, no pause', async () => {
  loop.budget = Infinity;
  loop.tools = false;
  const r = rig([ok200, agent('interrupt')], withProfile({}));
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('go');
  await quiet();
  assert.equal(runs(r).length, 1);
  assert.equal(r.runtime.getState().notice, '1 interrupt waiting. Answer it to continue the run.');
  loop.budget = 0;
});

test('Stop ends a chain of automatic continuations, and nothing is sent after it', async () => {
  loop.budget = 0;
  let calls = 0;
  const r = rig(
    [
      ok200,
      (call) => {
        if (call.path !== '/run') return undefined;
        calls += 1;
        // The first run interrupts and the automatic continuation streams on and never finishes.
        return calls === 1 ? agent('interrupt')(call) : eventStream(sse([{ type: 'RUN_STARTED', threadId: 't', runId: 'r' }]), { hold: true, signal: call.signal });
      },
    ],
    withProfile({ interruptReply: 'resolve' }),
  );
  r.runtime.selectAgent(supportAgent);
  const sending = r.runtime.send('go');
  await until(() => runs(r).length === 2 && r.runtime.getState().running, 'the automatic continuation to be streaming');
  await quiet();
  r.runtime.stop();
  await sending;
  await quiet();

  assert.equal(runs(r).length, 2, 'the chain ended');
  assert.equal(r.runtime.getState().running, false);
  assert.deepEqual(r.runtime.getState().interrupts, []);
  assert.equal(r.runtime.getState().error, undefined, 'a stop is not an error');
});

test('a run the developer stopped is never answered automatically, even if its stream carried an interrupt', async () => {
  loop.budget = 0;
  const r = rig(
    [
      ok200,
      (call) => {
        if (call.path !== '/run') return undefined;
        r.runtime.stop();
        return eventStream(sse([{ type: 'RUN_STARTED', threadId: 't', runId: 'r' }, { type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: { type: 'interrupt', interrupts: INTERRUPTS } }]));
      },
    ],
    withProfile({ interruptReply: 'resolve' }),
  );
  r.runtime.selectAgent(supportAgent);
  await r.runtime.send('go');
  await quiet();
  assert.equal(runs(r).length, 1, 'no continuation was sent');
  assert.deepEqual(r.runtime.getState().interrupts.map((answer) => [answer.status, answer.automatic]), [['unanswered', undefined], ['unanswered', undefined]], 'what it left waits for the developer');
});
