// F05 T015: the frame reader. Every check compares the original envelope text, order and offsets,
// not only the parsed events: the reader may add findings, never change what crossed the wire.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventType, type AgentCapabilities } from '@ag-ui/core';
import {
  baselineRunTypes,
  eventFixtures,
  invalidCases,
  missingTerminalScenarios,
  protocolScenarios,
} from '../../../../examples/reference-agent/protocol-fixtures.ts';
import { scenarioBytes, type RecorderScenario } from '../../../../examples/reference-agent/recorder-fixtures.ts';
import type { Finding, FindingSubject, RawFrame } from '../../src/contracts.ts';
import { createFrameReader } from '../../src/core/frames/index.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const EXCHANGE = 'exchange-1';

type Check = NonNullable<Parameters<typeof createFrameReader>[2]>['check'];

/** Pushes chunks (text is encoded; bytes pass through) with offsets 10, 20, 30 ... unless given. */
function read(
  chunks: ReadonlyArray<string | Uint8Array>,
  options: { offsets?: readonly number[]; end?: FindingSubject | false; check?: Check; declared?: () => AgentCapabilities | undefined } = {},
) {
  const frames: RawFrame[] = [];
  const findings: Finding[] = [];
  const reader = createFrameReader(
    { appendFrame: (frame) => void frames.push(frame), addFinding: (finding) => void findings.push(finding) },
    EXCHANGE,
    { ...(options.check && { check: options.check }), ...(options.declared && { declared: options.declared }) },
  );
  chunks.forEach((chunk, i) => reader.push(typeof chunk === 'string' ? encoder.encode(chunk) : chunk, options.offsets?.[i] ?? (i + 1) * 10));
  if (options.end !== false) reader.end(options.end);
  return { frames, findings, reader };
}

const scenarioChunks = (scenario: RecorderScenario) => scenario.chunks;
const envelopes = (frames: readonly RawFrame[]) => frames.map((frame) => frame.envelope);
const dataFramesOf = (frames: readonly RawFrame[]) => frames.filter((frame) => frame.classification === 'data');
const one = (text: string) => read([text]).frames;

// ---- one dedicated case per baseline event type -------------------------------------------------

test('the fixtures cover exactly the 31 upstream event types', () => {
  assert.deepEqual(Object.keys(eventFixtures).sort(), Object.values(EventType).sort());
  assert.equal(Object.keys(eventFixtures).length, 31);
});

for (const type of Object.values(EventType)) {
  test(`event type ${type}: kept as received, identified, schema-valid, no findings`, () => {
    const data = JSON.stringify(eventFixtures[type]);
    const envelope = `data: ${data}\n\n`;
    const { frames, findings } = read([envelope]);

    assert.equal(frames.length, 1);
    const frame = frames[0]!;
    assert.equal(frame.classification, 'data');
    assert.equal(frame.envelope, envelope);
    assert.equal(frame.data, data);
    assert.equal(frame.eventType, type);
    assert.equal(frame.jsonVerdict, 'valid');
    assert.equal(frame.schemaVerdict, 'valid');
    assert.deepEqual(frame.parsed, eventFixtures[type]);
    assert.equal(frame.provenance, 'raw');
    assert.ok(frame.summary.startsWith(type), `summary starts with the type: ${frame.summary}`);
    assert.deepEqual(findings.filter((finding) => finding.kind !== 'terminal'), []);
    // Only these two end a run.
    const terminal = type === 'RUN_FINISHED' || type === 'RUN_ERROR';
    assert.equal(findings.some((finding) => finding.kind === 'terminal'), !terminal);
  });
}

test('a schema-valid event keeps every field it arrived with, including unknown ones', () => {
  const data = '{"type":"STEP_STARTED","stepName":"plan","vendorExtension":{"kept":true}}';
  const frame = one(`data: ${data}\n\n`)[0]!;
  assert.equal(frame.schemaVerdict, 'valid');
  assert.deepEqual(frame.parsed, JSON.parse(data), 'schema validation never strips or repairs what was received');
});

// ---- data that is not a valid event ------------------------------------------------------------

for (const [name, expected] of Object.entries(invalidCases)) {
  test(`invalid data ${name}: retained with its verdicts and one additive finding`, () => {
    const envelope = `data: ${expected.data}\n\n`;
    const { frames, findings } = read([envelope], { end: false });

    assert.equal(frames.length, 1);
    const frame = frames[0]!;
    assert.equal(frame.classification, 'data', 'invalid data is still a received data frame and counts as one');
    assert.equal(frame.envelope, envelope);
    assert.equal(frame.data, expected.data);
    assert.equal(frame.jsonVerdict, expected.jsonVerdict);
    assert.equal(frame.schemaVerdict, expected.schemaVerdict);
    assert.equal(frame.eventType, 'eventType' in expected ? expected.eventType : undefined);
    if (expected.jsonVerdict === 'valid') assert.deepEqual(frame.parsed, JSON.parse(expected.data));
    else assert.equal(frame.parsed, undefined);

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.kind, expected.jsonVerdict === 'invalid' ? 'json' : 'schema');
    assert.equal(findings[0]!.rule, expected.jsonVerdict === 'invalid' ? 'json.invalid' : expected.schemaVerdict === 'unknown-type' ? 'schema.unknown-event-type' : 'schema.invalid-event');
    assert.equal(findings[0]!.id, `${frame.id}:finding`, 'the first finding of a frame keeps its 0.1.0 id');
    assert.deepEqual(findings[0]!.subject, { type: 'frame', id: frame.id });
    assert.ok(findings[0]!.message.length > 0);
  });
}

test('schema findings name the failing field and never repeat the received values', () => {
  const secretLooking = 'synthetic-token-1234567890';
  const { findings } = read([`data: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', messageId: secretLooking, delta: 7 })}\n\n`], { end: false });
  assert.match(findings[0]!.message, /delta/);
  assert.ok(!findings[0]!.message.includes(secretLooking));
  const unknown = read([`data: ${JSON.stringify({ type: 'X'.repeat(500) })}\n\n`], { end: false }).findings[0]!;
  assert.ok(unknown.message.length < 200, 'a hostile type name is truncated in the message');
});

test('a validator that throws leaves the frame retained and marked, and the next frame is still read', () => {
  let calls = 0;
  const check: Check = () => {
    calls += 1;
    if (calls === 1) throw new Error('validator exploded');
    return { verdict: 'valid', problems: [] };
  };
  const first = `data: ${JSON.stringify(eventFixtures.RUN_STARTED)}\n\n`;
  const second = `data: ${JSON.stringify(eventFixtures.RUN_FINISHED)}\n\n`;
  const { frames, findings } = read([first, second], { check });

  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.envelope, first);
  assert.equal(frames[0]!.data, JSON.stringify(eventFixtures.RUN_STARTED));
  assert.deepEqual(frames[0]!.parsed, eventFixtures.RUN_STARTED, 'the parsed companion survives the validator failure');
  assert.equal(frames[0]!.schemaVerdict, 'invalid');
  assert.equal(frames[1]!.schemaVerdict, 'valid');
  assert.deepEqual(findings.map((finding) => [finding.kind, finding.rule]), [['schema', 'schema.check-failed']]);
  assert.match(findings[0]!.message, /validation failed/i);
});

test('schema-valid events in the wrong order are not the reader’s business: no findings, no outcome', () => {
  const { frames, findings } = read(scenarioChunks(protocolScenarios.sequenceViolations));
  assert.equal(frames.length, 5);
  assert.ok(frames.every((frame) => frame.schemaVerdict === 'valid'));
  assert.deepEqual(findings, [], 'sequence findings come from the protocol client and attach to the run');
});

// ---- delimiters, fields and multiline data -------------------------------------------------------

test('LF, CRLF and CR delimiters each end an event and stay in the envelope', () => {
  for (const eol of ['\n', '\r\n', '\r']) {
    const first = `data: {"type":"STEP_STARTED","stepName":"a"}${eol}${eol}`;
    const second = `data: {"type":"STEP_FINISHED","stepName":"a"}${eol}${eol}`;
    const { frames } = read([first + second]);
    assert.deepEqual(envelopes(frames), [first, second], JSON.stringify(eol));
    assert.deepEqual(frames.map((frame) => frame.data), ['{"type":"STEP_STARTED","stepName":"a"}', '{"type":"STEP_FINISHED","stepName":"a"}']);
  }
});

test('line endings may change inside one event and between events', () => {
  const text = 'data: {"type":"STEP_STARTED",\r\ndata: "stepName":"a"}\r\r' + 'data: {"type":"STEP_FINISHED","stepName":"a"}\n\n';
  const { frames } = read([text]);
  assert.deepEqual(envelopes(frames), [
    'data: {"type":"STEP_STARTED",\r\ndata: "stepName":"a"}\r\r',
    'data: {"type":"STEP_FINISHED","stepName":"a"}\n\n',
  ]);
  assert.equal(frames[0]!.data, '{"type":"STEP_STARTED",\n"stepName":"a"}', 'data lines are joined with a line feed');
  assert.equal(frames[0]!.schemaVerdict, 'valid', 'multiline data validates as the joined JSON');
});

test('CR then LF is one delimiter even when a chunk boundary falls between them', () => {
  const text = 'data: {"type":"STEP_STARTED","stepName":"a"}\r\n\r\ndata: {"type":"STEP_FINISHED","stepName":"a"}\r\n\r\n';
  const whole = read([text]).frames;
  const cut = text.indexOf('\r\n') + 1;
  const split = read([text.slice(0, cut), text.slice(cut)]).frames;
  assert.deepEqual(envelopes(split), envelopes(whole));
  assert.equal(split.length, 2, 'no spurious empty event appears between the CR and the LF');
});

test('a CR CR LF run is a CR line end followed by a CRLF blank line, wherever it is cut', () => {
  const text = 'data: {"type":"STEP_STARTED","stepName":"a"}\r\r\ndata: {"type":"STEP_FINISHED","stepName":"a"}\n\n';
  const expected = ['data: {"type":"STEP_STARTED","stepName":"a"}\r\r\n', 'data: {"type":"STEP_FINISHED","stepName":"a"}\n\n'];
  assert.deepEqual(envelopes(read([text]).frames), expected);
  for (let cut = 1; cut < text.length; cut++) {
    assert.deepEqual(envelopes(read([text.slice(0, cut), text.slice(cut)]).frames), expected, `cut at ${cut}`);
  }
});

test('field forms: one optional space is dropped, other fields and unknown fields stay in the envelope only', () => {
  const text = [
    'data:{"type":"STEP_STARTED","stepName":"a"}\n\n',
    'data:  {"type":"STEP_FINISHED","stepName":"a"}\n\n',
    'data\n\n',
    'event: custom\nunknown-field: x\ndata: 1\n\n',
  ].join('');
  const { frames } = read([text]);
  assert.deepEqual(frames.map((frame) => frame.data), ['{"type":"STEP_STARTED","stepName":"a"}', ' {"type":"STEP_FINISHED","stepName":"a"}', '', '1']);
  assert.equal(frames[0]!.schemaVerdict, 'valid');
  assert.equal(frames[1]!.schemaVerdict, 'valid', 'a second space is whitespace in JSON');
  assert.equal(frames[2]!.jsonVerdict, 'invalid', 'a data field with no value is an empty data frame');
  assert.equal(frames[3]!.envelope, 'event: custom\nunknown-field: x\ndata: 1\n\n');
  assert.ok(frames.every((frame) => frame.classification === 'data'));
});

// ---- comments and control evidence --------------------------------------------------------------

test('comments, field-only blocks and stray blank lines are control evidence, not AG-UI data', () => {
  const { frames, findings } = read(scenarioChunks(protocolScenarios.controlEvidence));

  assert.deepEqual(
    frames.map((frame) => frame.classification),
    ['control', 'control', 'data', 'control', 'control', 'data', 'data'],
  );
  assert.deepEqual(envelopes(frames), [
    ': keepalive\n\n',
    'event: ping\nid: 7\nretry: 1000\n\n',
    `data: ${JSON.stringify(eventFixtures.RUN_STARTED)}\n\n`,
    ': another keepalive\r\n\r\n',
    '\n',
    `: note inside a data block\ndata: ${JSON.stringify(eventFixtures.TEXT_MESSAGE_START)}\nid: 8\n\n`,
    `data: ${JSON.stringify(eventFixtures.RUN_FINISHED)}\n\n`,
  ]);
  for (const frame of frames.filter((frame) => frame.classification === 'control')) {
    assert.equal(frame.data, undefined);
    assert.equal(frame.eventType, undefined);
    assert.equal(frame.parsed, undefined);
    assert.equal(frame.jsonVerdict, 'not-applicable');
    assert.equal(frame.schemaVerdict, 'not-applicable');
    assert.ok(frame.summary.length > 0);
  }
  assert.equal(frames[0]!.summary, 'SSE comment');
  assert.deepEqual(findings, [], 'control evidence is not an error and invents no event');
  assert.equal(dataFramesOf(frames).length, 3, 'only data frames are AG-UI frames');
});

test('arrival indices count every envelope in order, so the data-frame count must come from the classification', () => {
  const { frames } = read(scenarioChunks(protocolScenarios.controlEvidence));
  assert.deepEqual(frames.map((frame) => frame.index), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(frames.map((frame) => frame.id), frames.map((_, i) => `${EXCHANGE}:frame-${i}`));
  assert.ok(frames.every((frame) => frame.exchangeId === EXCHANGE));
});

// ---- split input ---------------------------------------------------------------------------------

test('multibyte characters cut at every byte are decoded whole and the envelope text is intact', () => {
  const text = `data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"héllo 你好 🙂"}\r\n\r\ndata: ${JSON.stringify(eventFixtures.RUN_FINISHED)}\n\n`;
  const bytes = encoder.encode(text);
  const whole = read([bytes]).frames;
  assert.equal(whole[0]!.data!.includes('héllo 你好 🙂'), true);

  const oneByte = read(Array.from(bytes, (byte) => Uint8Array.of(byte)));
  assert.deepEqual(envelopes(oneByte.frames), envelopes(whole));
  for (let cut = 1; cut < bytes.length; cut++) {
    assert.deepEqual(envelopes(read([bytes.slice(0, cut), bytes.slice(cut)]).frames), envelopes(whole), `cut at byte ${cut}`);
  }
  assert.equal(oneByte.frames[0]!.parsed && (oneByte.frames[0]!.parsed as { delta: string }).delta, 'héllo 你好 🙂');
});

test('the whole stream read back equals the bytes received, whatever the chunking', () => {
  for (const scenario of [...Object.values(protocolScenarios), ...Object.values(missingTerminalScenarios)]) {
    const wire = decoder.decode(scenarioBytes(scenario));
    for (const sizes of [[1], [3], [7, 1], [4096]]) {
      const bytes = scenarioBytes(scenario);
      const chunks: Uint8Array[] = [];
      for (let at = 0, turn = 0; at < bytes.length; turn += 1) {
        const size = sizes[turn % sizes.length]!;
        chunks.push(bytes.slice(at, at + size));
        at += size;
      }
      const { frames } = read(chunks);
      assert.equal(frames.map((frame) => frame.envelope).join(''), wire, `${scenario.name} in chunks of ${sizes}`);
    }
  }
});

test('a byte order mark stays in the envelope and is ignored by the first field', () => {
  const { frames } = read(['﻿data: {"type":"STEP_STARTED","stepName":"a"}\n\n']);
  assert.equal(frames[0]!.envelope.startsWith('﻿'), true, 'the envelope is the text as received');
  assert.equal(frames[0]!.schemaVerdict, 'valid');
  assert.equal(frames[0]!.data, '{"type":"STEP_STARTED","stepName":"a"}');
});

test('bytes that are not UTF-8 become replacement characters; the frame is still kept', () => {
  const { frames } = read([Uint8Array.of(...encoder.encode('data: bad '), 0xff, ...encoder.encode('\n\n'))]);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.data, 'bad �');
  assert.equal(frames[0]!.jsonVerdict, 'invalid');
});

// ---- end of stream ------------------------------------------------------------------------------

test('a block cut before its closing blank line is partial evidence, never a dispatched event', () => {
  const { frames } = read(scenarioChunks(missingTerminalScenarios.truncatedFinished));
  assert.deepEqual(frames.map((frame) => frame.classification), ['data', 'partial']);
  const partial = frames[1]!;
  assert.equal(partial.envelope, `data: ${JSON.stringify(eventFixtures.RUN_FINISHED)}\n`);
  assert.equal(partial.data, undefined);
  assert.equal(partial.eventType, undefined);
  assert.equal(partial.parsed, undefined);
  assert.equal(partial.jsonVerdict, 'not-applicable');
  assert.equal(partial.schemaVerdict, 'not-applicable');
  assert.equal(partial.index, 1);
  assert.match(partial.summary, /incomplete/i);
});

test('an envelope cut inside a line, or inside a multibyte character, keeps the text received', () => {
  const inLine = read(['data: {"type":"RUN_FIN']).frames;
  assert.deepEqual(inLine.map((frame) => [frame.classification, frame.envelope]), [['partial', 'data: {"type":"RUN_FIN']]);

  const { frames } = read(scenarioChunks(missingTerminalScenarios.truncatedMidCharacter));
  const partial = frames.at(-1)!;
  assert.equal(partial.classification, 'partial');
  assert.ok(partial.envelope.startsWith('data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"h'));
  assert.ok(partial.envelope.endsWith('�'), 'the dangling lead byte is reported as a replacement character, not dropped');
});

test('a final CR is a complete delimiter once the stream ends, and an empty end adds nothing', () => {
  const text = 'data: {"type":"STEP_STARTED","stepName":"a"}\r\r';
  const { frames } = read([text]);
  assert.deepEqual(frames.map((frame) => [frame.classification, frame.envelope]), [['data', text]]);
  assert.deepEqual(read([]).frames, []);
  assert.deepEqual(read([new Uint8Array(0)]).frames, []);
});

test('end is idempotent and nothing is accepted after it', () => {
  const { reader, frames, findings } = read(['data: {"type":"RUN_STARTED","threadId":"t","runId":"r"}\n\n']);
  const before = [frames.length, findings.length];
  reader.end();
  assert.throws(() => reader.push(encoder.encode('data: late\n\n'), 99));
  assert.deepEqual([frames.length, findings.length], before);
});

// ---- offsets --------------------------------------------------------------------------------------

test('a frame’s offset is that of the chunk in which its last character arrived', () => {
  const first = 'data: {"type":"STEP_STARTED","stepName":"a"}\n\n';
  const second = 'data: {"type":"STEP_FINISHED","stepName":"a"}\n\n';
  const text = first + second;
  // chunk 0 holds the first event and half of the second; chunk 1 the rest; chunk 2 a comment.
  const cut = first.length + 10;
  const { frames } = read([text.slice(0, cut), text.slice(cut), ': tail\n\n'], { offsets: [100, 250, 400] });
  assert.deepEqual(frames.map((frame) => frame.offsetMs), [100, 250, 400]);
});

test('a CR that waits for a possible LF is stamped with the chunk the CR arrived in', () => {
  const first = 'data: {"type":"STEP_STARTED","stepName":"a"}\r\r';
  const second = 'data: {"type":"STEP_FINISHED","stepName":"a"}\n\n';
  const { frames } = read([first, second], { offsets: [100, 900] });
  assert.deepEqual(envelopes(frames), [first, second]);
  assert.deepEqual(frames.map((frame) => frame.offsetMs), [100, 900]);

  const crlf = read(['data: {"type":"STEP_STARTED","stepName":"a"}\r\n\r', '\n'], { offsets: [100, 900] });
  assert.equal(crlf.frames[0]!.offsetMs, 900, 'the LF is part of the envelope, so the envelope ends in the chunk that carried it');
});

test('partial evidence at the end of the stream carries the offset of the last chunk', () => {
  const { frames } = read(['data: {"type":"STEP_STARTED","stepName":"a"}\n\n', 'data: {"type":"RUN_FIN'], { offsets: [5, 77] });
  assert.deepEqual(frames.map((frame) => frame.offsetMs), [5, 77]);
});

test('offsets never go backwards even if the supplied clock does', () => {
  const part = (n: string) => `data: {"type":"STEP_STARTED","stepName":"${n}"}\n\n`;
  const { frames } = read([part('a'), part('b'), part('c')], { offsets: [50, 20, 90] });
  assert.deepEqual(frames.map((frame) => frame.offsetMs), [50, 50, 90]);
});

test('offsets are never negative', () => {
  const { frames } = read(['data: {"type":"STEP_STARTED","stepName":"a"}\n\n'], { offsets: [-5] });
  assert.equal(frames[0]!.offsetMs, 0);
});

test('several events in one chunk share that chunk’s offset, in arrival order', () => {
  const { frames } = read([scenarioBytes(protocolScenarios.baselineRun)], { offsets: [42] });
  assert.equal(frames.length, 30);
  assert.ok(frames.every((frame) => frame.offsetMs === 42));
  assert.deepEqual(frames.map((frame) => frame.index), Array.from({ length: 30 }, (_, i) => i));
});

// ---- the baseline run and terminal detection ----------------------------------------------------------

test('the baseline run reads back as thirty data frames in order, all valid, ending in a valid terminal', () => {
  const { frames, findings } = read(scenarioChunks(protocolScenarios.baselineRun));
  assert.deepEqual(frames.map((frame) => frame.eventType), baselineRunTypes);
  assert.ok(frames.every((frame) => frame.classification === 'data' && frame.schemaVerdict === 'valid'));
  assert.deepEqual(findings, []);
});

test('RUN_ERROR is a valid terminal too', () => {
  const { frames, findings } = read(scenarioChunks(protocolScenarios.runError));
  assert.deepEqual(frames.map((frame) => frame.eventType), ['RUN_STARTED', 'RUN_ERROR']);
  assert.deepEqual(findings, []);
});

test('invalid frames amid a valid run are all kept and flagged; the valid ending still satisfies the terminal', () => {
  const { frames, findings } = read(scenarioChunks(protocolScenarios.invalidFrames));
  assert.equal(frames.length, 8);
  assert.deepEqual(
    frames.map((frame) => frame.schemaVerdict),
    ['valid', 'not-applicable', 'unknown-type', 'invalid', 'valid', 'not-applicable', 'invalid', 'valid'],
  );
  assert.deepEqual(
    findings.map((finding) => [finding.kind, finding.rule, (finding.subject as { id: string }).id]),
    [
      ['json', 'json.invalid', 'exchange-1:frame-1'],
      ['schema', 'schema.unknown-event-type', 'exchange-1:frame-2'],
      ['schema', 'schema.invalid-event', 'exchange-1:frame-3'],
      ['json', 'json.invalid', 'exchange-1:frame-5'],
      ['schema', 'schema.invalid-event', 'exchange-1:frame-6'],
    ],
  );
});

const missing = Object.entries(missingTerminalScenarios) as Array<[string, RecorderScenario]>;
for (const [name, scenario] of missing) {
  test(`missing terminal: ${name} gets a terminal finding and no invented event`, () => {
    const { frames, findings } = read(scenarioChunks(scenario));
    const terminals = findings.filter((finding) => finding.kind === 'terminal');
    assert.equal(terminals.length, 1);
    assert.deepEqual(terminals[0]!.subject, { type: 'exchange', id: EXCHANGE });
    assert.equal(terminals[0]!.rule, 'terminal.missing');
    assert.match(terminals[0]!.message, /RUN_FINISHED|RUN_ERROR/);
    assert.ok(
      !frames.some((frame) => frame.eventType === 'RUN_FINISHED' && frame.schemaVerdict === 'valid'),
      'no valid terminal is manufactured',
    );
    const wire = decoder.decode(scenarioBytes(scenario));
    assert.equal(frames.map((frame) => frame.envelope).join(''), wire, 'only the received text is retained');
  });
}

test('the terminal finding attaches to the subject the caller names, once', () => {
  const run: FindingSubject = { type: 'run', id: 'run-1' };
  const { reader, findings } = read(scenarioChunks(missingTerminalScenarios.closedAfterContent), { end: run });
  assert.deepEqual(findings.map((finding) => [finding.kind, finding.rule, finding.subject]), [['terminal', 'terminal.missing', run]]);
  reader.end(run);
  assert.equal(findings.length, 1);
});

test('a terminal event anywhere in the stream satisfies it, even when more frames follow', () => {
  const finished = `data: ${JSON.stringify(eventFixtures.RUN_FINISHED)}\n\n`;
  const { findings } = read([finished, `data: ${JSON.stringify(eventFixtures.STEP_STARTED)}\n\n`]);
  assert.deepEqual(findings, []);
});

test('finding ids are unique within an exchange and distinct from the recorder’s', () => {
  for (const scenario of [protocolScenarios.invalidFrames, missingTerminalScenarios.lookalikeFinished, missingTerminalScenarios.lookalikeNonJson]) {
    const ids = read(scenarioChunks(scenario)).findings.map((finding) => finding.id);
    assert.ok(ids.length > 0);
    assert.equal(new Set(ids).size, ids.length, scenario.name);
    assert.ok(ids.every((id) => !/^finding-\d+$/.test(id)));
  }
});

// ---- capability findings (specs/007, US2) -------------------------------------------------------

const wire = (...events: readonly object[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
const RUN = { type: 'RUN_STARTED', threadId: 't', runId: 'r' };
const DONE = { type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: { type: 'success' } };

test('a frame that contradicts a declared false gets a finding on that frame, and the stream is read as it would be without one', () => {
  const declared = () => ({ state: { deltas: false } });
  const chunks = wire(RUN, eventFixtures.STATE_DELTA, eventFixtures.STATE_SNAPSHOT, DONE);
  const { frames, findings } = read(chunks, { declared });
  const plain = read(chunks);

  assert.deepEqual(findings.map((finding) => [finding.id, finding.kind, finding.rule, finding.subject]), [
    ['exchange-1:frame-1:finding', 'capability', 'capability.state-delta-unsupported', { type: 'frame', id: 'exchange-1:frame-1' }],
  ]);
  assert.match(findings[0]!.message, /STATE_DELTA came from an agent that declares state\.deltas: false/);
  assert.deepEqual(frames, plain.frames, 'frames, envelopes, offsets and verdicts do not depend on the declaration');
  assert.equal(frames.map((frame) => frame.envelope).join(''), chunks.join(''));
  assert.deepEqual(plain.findings, []);
});

test('a second finding on a frame takes the next id, and an invalid frame of the right type still counts', () => {
  const { findings } = read(wire(RUN, { type: 'STATE_DELTA' }, DONE), { declared: () => ({ state: { deltas: false } }) });
  assert.deepEqual(findings.map((finding) => [finding.id, finding.rule]), [
    ['exchange-1:frame-1:finding', 'schema.invalid-event'],
    ['exchange-1:frame-1:finding-2', 'capability.state-delta-unsupported'],
  ]);
});

test('no provider, a provider that returns nothing and a declaration without the flag give no finding', () => {
  const chunks = wire(RUN, eventFixtures.STATE_DELTA, DONE);
  assert.deepEqual(read(chunks).findings, []);
  assert.deepEqual(read(chunks, { declared: () => undefined }).findings, []);
  assert.deepEqual(read(chunks, { declared: () => ({ state: { deltas: true } }) }).findings, []);
  assert.deepEqual(read(chunks, { declared: () => ({}) }).findings, []);
});

test('the declaration is read once, when the stream starts: a later change does not change a running stream', () => {
  let declaration: AgentCapabilities | undefined;
  let asked = 0;
  const { findings, reader } = read(wire(RUN), { declared: () => (asked += 1, declaration), end: false });
  declaration = { state: { deltas: false } };
  reader.push(encoder.encode(wire(eventFixtures.STATE_DELTA, eventFixtures.STATE_DELTA).join('')), 99);
  assert.equal(asked, 1, 'one read for the stream, not one for each frame');
  assert.deepEqual(findings, [], 'a stream that started with nothing declared is not judged against what is declared later');

  declaration = undefined;
  const second = read(wire(RUN, eventFixtures.STATE_DELTA), { declared: () => (declaration = { state: { deltas: false } }), end: false });
  declaration = undefined;
  second.reader.push(encoder.encode(wire(eventFixtures.STATE_DELTA).join('')), 99);
  assert.equal(second.findings.length, 2, 'and one that started with a declaration keeps it');
});

test('every contradicting frame gets its own finding: 200 deltas from an agent that declares none give 200 findings', () => {
  const chunks = wire(RUN, ...Array.from({ length: 200 }, () => eventFixtures.STATE_DELTA), DONE);
  const { findings, frames } = read(chunks, { declared: () => ({ state: { deltas: false } }) });
  assert.equal(findings.length, 200);
  assert.equal(new Set(findings.map((finding) => finding.id)).size, 200);
  assert.equal(frames.length, 202);
});

test('a provider that throws, or a declaration that throws when read, costs no frame and is reported once on a frame', () => {
  const chunks = wire(RUN, eventFixtures.STATE_DELTA, DONE);
  const provider = read(chunks, {
    declared: () => {
      throw new RangeError('provider exploded');
    },
  });
  assert.equal(provider.frames.length, 3);
  assert.deepEqual(provider.findings.map((finding) => [finding.rule, finding.subject]), [['capture.rule-check-failed', { type: 'frame', id: 'exchange-1:frame-0' }]]);
  assert.match(provider.findings[0]!.message, /RangeError/);
  assert.ok(!provider.findings[0]!.message.includes('provider exploded'), 'the error message stays out of the finding');

  const hostile = read(chunks, {
    declared: () =>
      ({
        get state(): never {
          throw new Error('getter exploded');
        },
      }) as AgentCapabilities,
  });
  assert.equal(hostile.frames.length, 3, 'every frame is kept');
  assert.deepEqual(hostile.frames.map((frame) => frame.schemaVerdict), ['valid', 'valid', 'valid']);
  assert.deepEqual(hostile.findings.map((finding) => finding.rule), ['capture.rule-check-failed', 'capture.rule-check-failed', 'capture.rule-check-failed'], 'the next frames are still read, and each says so');
});

// ---- the older event versions the client accepts (specs/007, US3) -----------------------------------

const rulesOf = (findings: readonly Finding[]) => findings.map((finding) => finding.rule);

test('a retired THINKING event is a compat finding and no schema finding, and its frame is kept as received', () => {
  const event = { type: 'THINKING_START', title: 'planning' };
  const { frames, findings } = read(wire(RUN, event, DONE));
  assert.deepEqual(rulesOf(findings), ['compat.retired-event-type']);
  assert.equal(findings[0]!.kind, 'compat');
  assert.match(findings[0]!.message, /^THINKING_START is a retired event type\. The protocol client reads it as REASONING_START\.$/);
  assert.equal(frames[1]!.eventType, 'THINKING_START');
  assert.equal(frames[1]!.schemaVerdict, 'unknown-type', 'the verdict is that of the data as received');
  assert.deepEqual(frames[1]!.parsed, event, 'the parsed value keeps the retired shape');
  assert.equal(frames[1]!.data, JSON.stringify(event));
});

test('a RUN_FINISHED that the client accepts after its upgrade ends the terminal check', () => {
  const { frames, findings } = read(wire(RUN, { ...DONE, result: null }));
  assert.deepEqual(rulesOf(findings), ['compat.null-optional-field'], 'no schema finding and no terminal.missing');
  assert.match(findings[0]!.message, /^RUN_FINISHED\.result is null\. The protocol client reads it as absent\.$/);
  assert.equal(frames[1]!.schemaVerdict, 'invalid', 'the received shape is not valid');
  assert.equal((frames[1]!.parsed as { result: unknown }).result, null, 'and the parsed value still holds the null');

  const lookalike = read(wire(RUN, { type: 'RUN_FINISHED', threadId: 't', outcome: null }));
  assert.ok(rulesOf(lookalike.findings).includes('terminal.missing'), 'a finish that is still invalid after the upgrade does not count');
});

test('a frame that is still invalid after the upgrade gets a schema finding about the upgraded copy only', () => {
  const { findings } = read(wire(RUN, { type: 'TOOL_CALL_START', toolCallId: 'c1', parentMessageId: null }, DONE));
  assert.deepEqual(rulesOf(findings), ['schema.invalid-event', 'compat.null-optional-field']);
  assert.match(findings[0]!.message, /toolCallName/);
  assert.doesNotMatch(findings[0]!.message, /parentMessageId/, 'the null that the client accepts is not named twice');
  assert.deepEqual(findings.map((finding) => finding.id), ['exchange-1:frame-1:finding', 'exchange-1:frame-1:finding-2']);
});

test('a retired event from an agent that declares no reasoning breaks two rules, and one rule counts once however many fields it covers', () => {
  const retired = read(wire(RUN, { type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: 'hm' }, DONE), { declared: () => ({ reasoning: { supported: false } }) });
  assert.deepEqual(rulesOf(retired.findings), ['compat.retired-event-type', 'capability.reasoning-unsupported']);

  const input = { threadId: 't', runId: 'r', state: {}, messages: [], tools: [{ name: 'a', description: 'd', parameters: null }, { name: 'b', description: 'd', parameters: null }], context: [], forwardedProps: null };
  const nulls = read(wire({ ...RUN, rawEvent: null, input }, DONE));
  assert.deepEqual(rulesOf(nulls.findings), ['compat.null-optional-field']);
  assert.match(nulls.findings[0]!.message, /RUN_STARTED\.rawEvent.*forwardedProps.*tools\[0\]\.parameters.*tools\[1\]\.parameters are null/);
});

test('a legacy binary content part and a protocol version the client cannot read or that is newer are named, and a version it reads silently is not', () => {
  const snapshot = { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: [{ type: 'binary', mimeType: 'image/png', data: 'AAAA' }] }] };
  const binary = read(wire(RUN, snapshot, DONE));
  assert.deepEqual(rulesOf(binary.findings), ['compat.legacy-binary-content']);
  assert.match(binary.findings[0]!.message, /^MESSAGES_SNAPSHOT\.messages\[0\]\.content\[0\] is a binary content part\./);

  for (const [protocolVersion, expected] of [['2.0', ['compat.protocol-version-newer']], ['1.0.1', ['compat.protocol-version-unreadable']], ['1.0', []], ['0.9', []], [undefined, []]] as const) {
    const { findings, frames } = read(wire({ ...RUN, ...(protocolVersion !== undefined && { protocolVersion }) }, DONE));
    assert.deepEqual(rulesOf(findings), expected, String(protocolVersion));
    assert.equal(frames[0]!.schemaVerdict, 'valid', 'a version rule never makes a valid frame invalid');
  }
});

test('the upgrade never changes a frame: the parsed value is the JSON of the data and the envelopes are the received text', () => {
  const chunks = wire(
    { ...RUN, rawEvent: null },
    { type: 'THINKING_START', title: 't' },
    { type: 'THINKING_END' },
    { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: [{ type: 'binary', mimeType: 'image/png', data: 'AAAA' }] }] },
    { ...DONE, outcome: null },
  );
  const { frames, findings } = read(chunks);
  assert.ok(findings.length >= 4);
  assert.equal(frames.map((frame) => frame.envelope).join(''), chunks.join(''));
  for (const frame of frames) assert.deepEqual(frame.parsed, JSON.parse(frame.data!), frame.id);
});
