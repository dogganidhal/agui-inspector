// The v0.8 gallery (gallery-v08.ts) is valid and uses all 18 components of the v0.8 standard catalog, so the
// browser audit in tests/e2e/a2ui/v08.spec.ts covers every one. Nothing in it can reach an address that resolves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { A2uiMessageProcessor, A2uiMessageSchema } from '@a2ui/web_core/v0_8';
import { V08_COMPONENT_TYPES, v08Gallery } from './gallery-v08.ts';

test('every message of the gallery passes the strict v0.8 schema', () => {
  for (const operation of v08Gallery) {
    const parsed = A2uiMessageSchema.safeParse(operation);
    assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
  }
});

test('the gallery uses every one of the 18 components, and the real processor shows its surface', () => {
  const used = new Set<string>();
  for (const operation of v08Gallery) {
    const components = (operation as { surfaceUpdate?: { components: Array<{ component: object }> } }).surfaceUpdate?.components ?? [];
    for (const { component } of components) used.add(Object.keys(component)[0]!);
  }
  assert.deepEqual([...used].sort(), [...V08_COMPONENT_TYPES]);
  const processor = new A2uiMessageProcessor();
  processor.processMessages(structuredClone(v08Gallery) as never);
  assert.deepEqual([...processor.getSurfaces().keys()], ['gallery8']);
});

test('every address in the gallery is on the reserved host', () => {
  const addresses = JSON.stringify(v08Gallery).match(/https?:\/\/[^"\\\s)]+/g) ?? [];
  assert.ok(addresses.length >= 3);
  assert.ok(addresses.every((address) => new URL(address).hostname.endsWith('.invalid')), addresses.join(' '));
});
