// F07 T003 and T032: the rule catalogue. Ids are a public contract, so the grammar, uniqueness and the family-equals-kind
// rule are checked here, and so is that the catalogue, the fixtures and the docs page list exactly the same rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ruleFixtures } from '../../../../examples/reference-agent/rule-fixtures.ts';
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

const docs = (page: string) => readFileSync(path.join(process.cwd(), 'website', 'content', 'docs', page), 'utf8');
const catalogueIds: string[] = RULES.map((rule) => rule.id).sort();

test('the fixtures list exactly the rules of the catalogue', () => {
  assert.deepEqual(Object.keys(ruleFixtures).sort(), catalogueIds);
});

test('the rules page lists every rule of the catalogue once, and no other id', () => {
  const page = docs('rules.mdx');
  const listed = [...page.matchAll(/^\| `([a-z]+\.[a-z0-9-]+)` \|/gm)].map((match) => match[1]!);
  const unknown = listed.filter((id) => !catalogueIds.includes(id));
  const missing = catalogueIds.filter((id) => !listed.includes(id));
  const twice = listed.filter((id, at) => listed.indexOf(id) !== at);
  assert.deepEqual({ unknown, missing, twice }, { unknown: [], missing: [], twice: [] }, 'an id on the page and not in the catalogue, the other way round, or listed twice');
  for (const family of ['json and schema', 'sequence', 'terminal, transport and capture', 'compat', 'capability']) assert.ok(page.includes(`## ${family}`), family);
  assert.match(page, /never changes its meaning/);
});

test('the docs site lists the rules page after Inspection, and the inspection page links to it and names the two new kinds', () => {
  const pages = (JSON.parse(docs('meta.json')) as { pages: string[] }).pages;
  assert.equal(pages[pages.indexOf('inspection') + 1], 'rules');
  const inspection = docs('inspection.mdx');
  assert.match(inspection, /\(\.\/rules\.mdx\)/);
  for (const kind of ['capability', 'compat']) assert.match(inspection, new RegExp(`\\| \`${kind}\` \\|`), kind);
});

test('the new and edited docs follow the writing rules: no em or en dashes and no bold decoration', () => {
  for (const page of ['rules.mdx', 'inspection.mdx', 'recordings.mdx', 'internals.mdx', 'troubleshooting.mdx', 'configuration.mdx', 'runs.mdx']) {
    assert.doesNotMatch(docs(page), /[—–]/, page);
  }
  assert.doesNotMatch(docs('rules.mdx'), /\*\*/);
});
