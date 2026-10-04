// F07 T003: the rule catalogue. Ids are a public contract, so the grammar, uniqueness and the family-equals-kind
// rule are checked here. The docs and fixtures checks join this file once they exist.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RULE_ID_PATTERN, RULES, checkRuleId, ruleOf } from '../../src/core/rules/catalogue.ts';

const KINDS = ['json', 'schema', 'sequence', 'terminal', 'transport', 'capture', 'compat', 'capability'];

test('the catalogue has 39 rules, each with a well-formed unique id and a short description', () => {
  assert.equal(RULES.length, 39);
  const ids = RULES.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const rule of RULES) {
    assert.match(rule.id, RULE_ID_PATTERN, rule.id);
    assert.ok(rule.summary.length > 0 && rule.summary.length < 200, `${rule.id} has a short description`);
    assert.ok(rule.summary.endsWith('.'), `${rule.id} description is a sentence`);
  }
});

test('the family of a rule is its id prefix and a finding kind, and every family has a rule', () => {
  for (const rule of RULES) {
    assert.equal(rule.id.slice(0, rule.id.indexOf('.')), rule.family, rule.id);
    assert.ok(KINDS.includes(rule.family), rule.id);
  }
  for (const kind of KINDS) assert.ok(RULES.some((rule) => rule.family === kind), `${kind} has a rule`);
});

test('checkRuleId accepts each catalogue id with its family and rejects what the grammar or the family forbids', () => {
  for (const rule of RULES) assert.equal(checkRuleId(rule.family, rule.id), undefined, rule.id);
  assert.equal(checkRuleId('capability', 'capability.future-flag-unsupported'), undefined, 'unknown but well formed');
  assert.match(checkRuleId('json', 'json')!, /<family>\.<problem>/);
  assert.match(checkRuleId('json', 'JSON.invalid')!, /<family>\.<problem>/);
  assert.match(checkRuleId('json', 'json.invalid-')!, /<family>\.<problem>/);
  assert.match(checkRuleId('json', 'json.1invalid')!, /<family>\.<problem>/);
  assert.match(checkRuleId('json', 'json.invalid.twice')!, /<family>\.<problem>/);
  assert.match(checkRuleId('schema', 'json.invalid')!, /family must match kind/);
  assert.match(checkRuleId('projection', 'json.invalid')!, /family must match kind/);
});

test('ruleOf finds a catalogue rule and says nothing about an id from a newer version', () => {
  assert.equal(ruleOf('sequence.first-event')?.family, 'sequence');
  assert.equal(ruleOf('sequence.from-the-future'), undefined);
});
