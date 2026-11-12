// Spec 016, FR-008 to FR-012 and FR-018: reading a launch link from the fragment. Which agent exists and what the
// policy allows is resolveSetup's job (setup.test.ts); here every key is read on its own and each bad one is dropped
// with one warning that names the key and never repeats the value.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_LINK_LENGTH, parseLaunchLink } from '../../src/core/setup/link.ts';

const SECRET = 'SYNTHETIC-016-secret-value';
const link = (params: Record<string, string>) => `#${new URLSearchParams(params)}`;
const noSecret = (warnings: readonly string[]) => {
  for (const warning of warnings) assert.ok(!warning.includes(SECRET), warning);
};

test('an empty fragment, or a bare #, is no link', () => {
  assert.deepEqual(parseLaunchLink(''), { values: {}, warnings: [] });
  assert.deepEqual(parseLaunchLink('#'), { values: {}, warnings: [] });
});

test('every key of the contract is read, with or without the leading #', () => {
  const text = link({
    v: '0',
    agent: 'support',
    'var.userId': '42',
    'var.seed': '{"plan":"pro"}',
    context: JSON.stringify([{ description: 'locale', value: 'fr-FR' }]),
    forwardedProps: JSON.stringify({ tenant: 'acme' }),
    message: 'Book a table for two',
  });
  const expected = {
    values: {
      agent: 'support',
      context: [{ description: 'locale', value: 'fr-FR' }],
      forwardedProps: { tenant: 'acme' },
      message: 'Book a table for two',
      variables: { userId: '42', seed: '{"plan":"pro"}' },
    },
    warnings: [],
  };
  assert.deepEqual(parseLaunchLink(text), expected);
  assert.deepEqual(parseLaunchLink(text.slice(1)), expected);
});

test('an endpoint is read instead of an agent', () => {
  assert.deepEqual(parseLaunchLink(link({ endpoint: 'https://agent.example/run' })), { values: { endpoint: 'https://agent.example/run' }, warnings: [] });
});

test('+ and %20 are spaces, and the message keeps its lines', () => {
  assert.equal(parseLaunchLink('#message=Book+a%20table%0Afor+two').values.message, 'Book a table\nfor two');
});

test('a version other than 0 ignores the whole link with one warning', () => {
  for (const v of ['1', '', '00']) {
    const parsed = parseLaunchLink(`#v=${v}&message=hi`);
    assert.deepEqual(parsed.values, {}, v);
    assert.equal(parsed.warnings.length, 1);
    assert.match(parsed.warnings[0] ?? '', /^v: .*version 0; the link was ignored$/);
  }
});

test('a fragment over the limit is ignored as a whole', () => {
  const parsed = parseLaunchLink(`#message=${'a'.repeat(MAX_LINK_LENGTH)}`);
  assert.deepEqual(parsed.values, {});
  assert.deepEqual(parsed.warnings, ['the link is longer than 65,536 characters; it was ignored']);
  assert.equal(parseLaunchLink(`message=${'a'.repeat(MAX_LINK_LENGTH - 8)}`).values.message?.length, MAX_LINK_LENGTH - 8);
});

test('credential keys are refused with their own warning and their value is never shown', () => {
  for (const key of ['token', 'auth', 'Authorization', 'header', 'HEADERS', 'header.x-api-key']) {
    const parsed = parseLaunchLink(link({ [key]: SECRET, message: 'hi' }));
    assert.deepEqual(parsed.values, { message: 'hi' }, key);
    assert.equal(parsed.warnings.length, 1);
    assert.match(parsed.warnings[0] ?? '', /credentials never go in a link; enter a token in the authentication field/);
    assert.ok(parsed.warnings[0]?.startsWith(`${key}: `));
    assert.ok(!JSON.stringify(parsed).includes(SECRET));
  }
});

test('unknown and repeated keys are refused one by one, and the rest applies', () => {
  const parsed = parseLaunchLink(`#top&tools=${SECRET}&message=a&message=b&agent=support`);
  assert.deepEqual(parsed.values, { agent: 'support' });
  assert.deepEqual(parsed.warnings, ['top is not a launch link key; it was ignored', 'tools is not a launch link key; it was ignored', 'message appears more than once; it was ignored']);
});

test('agent and endpoint together refuse both', () => {
  const parsed = parseLaunchLink(link({ agent: 'support', endpoint: '/run', message: 'hi' }));
  assert.deepEqual(parsed.values, { message: 'hi' });
  assert.deepEqual(parsed.warnings, ['agent and endpoint: a link names an agent or an endpoint, not both; both were ignored']);
});

test('an empty agent or endpoint is refused', () => {
  assert.deepEqual(parseLaunchLink('#agent=&endpoint=%20').warnings, ['agent is empty; it was ignored', 'endpoint is empty; it was ignored']);
});

test('a variable key needs a valid name', () => {
  const parsed = parseLaunchLink(link({ 'var.': SECRET, 'var.1x': SECRET, 'var.a-b': SECRET, 'var.ok_1': 'x' }));
  assert.deepEqual(parsed.values, { variables: { ok_1: 'x' } });
  assert.equal(parsed.warnings.length, 3);
  noSecret(parsed.warnings);
});

test('context and forwarded properties are held to the profile rules, and a bad one keeps the value out of the warning', () => {
  const cases: Array<[Record<string, string>, RegExp]> = [
    [{ context: `[${SECRET}` }, /^context is not valid JSON; it was ignored$/],
    [{ context: JSON.stringify({ description: SECRET }) }, /^link\.context must be a list; it was ignored$/],
    [{ context: JSON.stringify([{ description: SECRET }]) }, /^link\.context\[0\]: value: .*; it was ignored$/],
    [{ forwardedProps: `{${SECRET}` }, /^forwardedProps is not valid JSON; it was ignored$/],
    [{ forwardedProps: JSON.stringify([SECRET]) }, /^link\.forwardedProps must be a JSON object; it was ignored$/],
    [{ forwardedProps: JSON.stringify({ a2uiAction: SECRET }) }, /^link\.forwardedProps: "a2uiAction" is reserved; the A2UI action sets it; it was ignored$/],
  ];
  for (const [params, pattern] of cases) {
    const parsed = parseLaunchLink(link({ ...params, message: 'hi' }));
    assert.deepEqual(parsed.values, { message: 'hi' }, JSON.stringify(params));
    assert.equal(parsed.warnings.length, 1);
    assert.match(parsed.warnings[0] ?? '', pattern);
    noSecret(parsed.warnings);
  }
});

test('a very long key is shortened in its warning', () => {
  const parsed = parseLaunchLink(`#${'k'.repeat(200)}=1`);
  assert.equal(parsed.warnings[0], `${'k'.repeat(64)}… is not a launch link key; it was ignored`);
});
