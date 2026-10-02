// L04 T035 (FR-033; SC-006; US5.2): the raw request editor. Syntax errors block sending, run-input
// schema violations are flagged and never block, and what is sent is the entered text, character
// for character. The click-through (typing, pressing Send, the server's answer) is in the
// end-to-end suite; here the rules are checked on the functions the editor is built from.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyzeRawInput, sendRaw } from '../../src/views/inspection/raw-input.ts';
import { RawRequest } from '../../src/views/inspection/raw.tsx';

const editor = (props: Parameters<typeof RawRequest>[0]) => renderToStaticMarkup(createElement(RawRequest, props));
const validInput = { threadId: 't1', runId: 'r1', state: {}, messages: [], tools: [], context: [], forwardedProps: {} };

test('empty and blank text is not a document yet', () => {
  for (const text of ['', '   ', '\n\t\r\n']) assert.deepEqual(analyzeRawInput(text), { state: 'empty' });
});

test('invalid syntax is an error with the parser message, and nothing else is judged', () => {
  for (const text of ['{', '{"a":}', 'undefined', '{"a":1,}', "{'a':1}", '{"a":1} trailing', '[1,2', '\u0000', 'NaN']) {
    const result = analyzeRawInput(text);
    assert.equal(result.state, 'syntax-error', JSON.stringify(text));
    assert.ok(result.state === 'syntax-error' && result.message.length > 0 && result.message.length <= 200);
  }
});

test('a schema-invalid document is flagged, not blocked', () => {
  const result = analyzeRawInput('{"threadId":17}');
  assert.equal(result.state, 'ok');
  assert.ok(result.state === 'ok');
  assert.ok(result.warnings.length > 0);
  assert.ok(result.warnings.some((warning) => warning.startsWith('threadId')));
  assert.ok(result.warnings.some((warning) => warning.startsWith('runId')));
  assert.ok(result.warnings.length <= 6, 'a short list, not every issue');
});

test('any JSON document is accepted for sending, objects or not', () => {
  for (const text of ['[1,2]', '42', 'null', '"text"', 'true', '{}']) {
    const result = analyzeRawInput(text);
    assert.equal(result.state, 'ok', text);
    assert.ok(result.state === 'ok' && result.warnings.length > 0, `${text} is not a run input`);
  }
  const array = analyzeRawInput('[1]');
  assert.ok(array.state === 'ok' && /JSON object/.test(array.warnings[0]!));
});

test('a valid run input has no warnings, whatever its whitespace or key order', () => {
  for (const text of [JSON.stringify(validInput), JSON.stringify(validInput, null, 4), `\n\t${JSON.stringify(Object.fromEntries(Object.entries(validInput).reverse()))}  \r\n`]) {
    assert.deepEqual(analyzeRawInput(text), { state: 'ok', warnings: [] });
  }
});

test('extra and protocol-newer fields are not warnings', () => {
  const result = analyzeRawInput(JSON.stringify({ ...validInput, protocolVersion: '1.0', somethingNew: { a: 1 } }));
  assert.deepEqual(result, { state: 'ok', warnings: [] });
});

test('sending passes the entered text unchanged: whitespace, key order, duplicates, numbers and line endings', () => {
  const texts = [
    '{ "threadId" :17 }',
    '\n  {"runId":"r","threadId":"t",\r\n\t"state":{},"messages":[],"tools":[],"context":[],"forwardedProps":{}}  \n\n',
    '{"a":1,"a":2,"n":12345678901234567890,"f":1.0,"e":1E3,"u":"\\u00e9\\ud83d\\ude42"}',
    '[1,   2 ,3]',
    '"just a string"',
    JSON.stringify(validInput, null, 7),
  ];
  for (const text of texts) {
    const sent: string[] = [];
    assert.equal(sendRaw(text, (entered) => sent.push(entered)), true, JSON.stringify(text));
    assert.deepEqual(sent, [text]);
    assert.equal(sent[0], text);
  }
});

test('sending is refused, without calling out, for text that is not JSON', () => {
  for (const text of ['', '  ', '{', '{"a":}', 'undefined', '\ufeff{"bom":true}']) {
    const sent: string[] = [];
    assert.equal(sendRaw(text, (entered) => sent.push(entered)), false);
    assert.deepEqual(sent, []);
  }
});

test('the editor renders disabled and explains that the request goes out as written', () => {
  const html = editor({ onSend: () => assert.fail('rendering must not send') });
  assert.match(html, /outside the conversation/i);
  assert.match(html, /presets[^<]*profile[^<]*preparation/i);
  assert.match(html, /<textarea[^>]*aria-label="Raw request body"/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*?Send unchanged/);
  assert.doesNotMatch(html, /aria-invalid="true"/);
});

test('a syntax error shows as an error and keeps Send off; a schema miss shows as a warning and keeps it on', () => {
  const broken = editor({ initialText: '{"threadId":', onSend: () => {} });
  assert.match(broken, /aria-invalid="true"/);
  assert.match(broken, /Not valid JSON/i);
  assert.match(broken, /<button[^>]*disabled=""[^>]*>[\s\S]*?Send unchanged/);

  const warned = editor({ initialText: '{"threadId":17}', onSend: () => {} });
  assert.doesNotMatch(warned, /aria-invalid="true"/);
  assert.match(warned, /Not a valid run input/i);
  assert.match(warned, /threadId/);
  assert.match(warned, /sent as written/i);
  assert.doesNotMatch(warned, /<button[^>]*disabled=""[^>]*>[\s\S]*?Send unchanged/);

  const fine = editor({ initialText: JSON.stringify(validInput), onSend: () => {} });
  assert.doesNotMatch(fine, /Not a valid run input/i);
  assert.match(fine, /Valid run input/i);
});

test('the editor keeps the entered text verbatim in the textarea', () => {
  const text = '{ "a" : 1 ,\r\n  "b":2 }';
  const html = editor({ initialText: text, onSend: () => {} });
  assert.ok(html.includes('>{ &quot;a&quot; : 1 ,\r\n  &quot;b&quot;:2 }</textarea>') || html.includes('>{ &quot;a&quot; : 1 ,\n  &quot;b&quot;:2 }</textarea>'));
});
