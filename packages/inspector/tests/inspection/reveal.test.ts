// #43: the one navigation action behind every run and frame reference. `revealEvidence` is plain data in, plain
// data out: given the session, a target and what the frames list shows now, it returns what the list must show so
// the target is on screen. The page behavior (pane, tab, scroll, focus) is in tests/e2e/hosted/reveal-evidence.spec.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExchangeId, FrameId, InspectionSession } from '../../src/contracts.ts';
import { NO_FILTER, indexSession, revealEvidence, type FrameFilter, type FramesState } from '../../src/views/inspection/model.ts';
import { harness } from '../conversation/support.ts';

/** Two conversation runs whose frames have the same indices, then a preparation exchange that went well. */
function session(): InspectionSession {
  const h = harness();
  for (const id of ['ex1', 'ex2']) {
    h.open(id, { input: { threadId: 't1', runId: `r-${id}` } });
    h.push(id, { type: 'RUN_STARTED', threadId: 't1', runId: `r-${id}` }, 10);
    h.push(id, { type: 'TEXT_MESSAGE_START', messageId: `m-${id}`, role: 'assistant' }, 20);
    h.push(id, { type: 'TEXT_MESSAGE_CONTENT', messageId: `m-${id}`, delta: `hello from ${id}` }, 30);
    h.push(id, { type: 'RUN_FINISHED', threadId: 't1', runId: `r-${id}`, outcome: { type: 'success' } }, 40);
    h.close(id);
  }
  h.store.appendExchange({ id: 'prep', kind: 'preparation', method: 'POST', path: '/sessions', startedAt: 1, transport: 'completed', frameIds: [] });
  return h.session();
}

const idOf = (data: InspectionSession, exchangeId: ExchangeId, index: number): FrameId =>
  data.frames.find((frame) => frame.exchangeId === exchangeId && frame.index === index)!.id;
const start = (patch: Partial<FramesState> = {}): FramesState => ({ filter: NO_FILTER, openExchanges: new Map(), openFrames: new Set(), ...patch });
const filter = (patch: Partial<FrameFilter>): FrameFilter => ({ ...NO_FILTER, ...patch });

test('a frame target opens its exchange and its own frame, not the frame with the same index in another exchange', () => {
  const data = session();
  const target = { exchangeId: 'ex1', frameId: idOf(data, 'ex1', 2) };
  assert.notEqual(idOf(data, 'ex1', 2), idOf(data, 'ex2', 2), 'the same index names two frames');

  const next = revealEvidence(indexSession(data), target, start())!;
  assert.equal(next.openExchanges.get('ex1'), true);
  assert.equal(next.openExchanges.has('ex2'), false);
  assert.deepEqual([...next.openFrames], [idOf(data, 'ex1', 2)]);
  assert.equal(next.filterCleared, false);
});

test('an exchange target opens the exchange and no frame', () => {
  const data = session();
  const next = revealEvidence(indexSession(data), { exchangeId: 'ex1' }, start())!;
  assert.equal(next.openExchanges.get('ex1'), true);
  assert.equal(next.openFrames.size, 0);
});

test('what the user already opened or closed elsewhere stays, and the inputs are not changed', () => {
  const data = session();
  const here = start({ openExchanges: new Map([['ex2', false]]), openFrames: new Set([idOf(data, 'ex2', 1)]) });
  const next = revealEvidence(indexSession(data), { exchangeId: 'ex1', frameId: idOf(data, 'ex1', 3) }, here)!;
  assert.equal(next.openExchanges.get('ex2'), false);
  assert.deepEqual([...next.openFrames].sort(), [idOf(data, 'ex1', 3), idOf(data, 'ex2', 1)].sort());
  assert.deepEqual([...here.openExchanges], [['ex2', false]]);
  assert.equal(here.openFrames.size, 1);
});

test('a frame that is already open stays open and a closed exchange is opened again', () => {
  const data = session();
  const frameId = idOf(data, 'ex2', 1);
  const next = revealEvidence(indexSession(data), { exchangeId: 'ex2', frameId }, start({ openExchanges: new Map([['ex2', false]]), openFrames: new Set([frameId]) }))!;
  assert.equal(next.openExchanges.get('ex2'), true);
  assert.deepEqual([...next.openFrames], [frameId]);
});

test('a filter that lists the target is kept as it is', () => {
  const data = session();
  const kept = filter({ query: 'hello from ex1' });
  const next = revealEvidence(indexSession(data), { exchangeId: 'ex1', frameId: idOf(data, 'ex1', 2) }, start({ filter: kept }))!;
  assert.equal(next.filter, kept);
  assert.equal(next.filterCleared, false);
});

test('a filter that would hide the frame is cleared, except for the choice about preparation', () => {
  const data = session();
  const target = { exchangeId: 'ex1', frameId: idOf(data, 'ex1', 2) };
  for (const hiding of [filter({ query: 'no such text' }), filter({ families: new Set(['tool' as const]) }), filter({ issuesOnly: true })]) {
    const next = revealEvidence(indexSession(data), target, start({ filter: hiding }))!;
    assert.equal(next.filterCleared, true);
    assert.deepEqual({ ...next.filter }, { ...NO_FILTER });
  }
  const hidden = revealEvidence(indexSession(data), target, start({ filter: filter({ query: 'no such text', showPreparation: false }) }))!;
  assert.equal(hidden.filter.showPreparation, false, 'a conversation exchange is listed whether or not preparation is');
  assert.equal(hidden.filter.query, '');
});

test('a run target is never hidden by the frame filters', () => {
  const data = session();
  const filtering = filter({ query: 'no such text', issuesOnly: true });
  const next = revealEvidence(indexSession(data), { exchangeId: 'ex1' }, start({ filter: filtering }))!;
  assert.equal(next.filter, filtering);
  assert.equal(next.filterCleared, false);
});

test('an exchange the list hides is listed again by turning preparation on', () => {
  const data = session();
  const hiding = filter({ showPreparation: false });
  const next = revealEvidence(indexSession(data), { exchangeId: 'prep' }, start({ filter: hiding }))!;
  assert.equal(next.filter.showPreparation, true);
  assert.equal(next.filterCleared, true);
  assert.equal(next.openExchanges.get('prep'), true);
});

test('a target the session does not hold changes nothing', () => {
  const data = session();
  const index = indexSession(data);
  assert.equal(revealEvidence(index, { exchangeId: 'missing' }, start()), undefined);
  assert.equal(revealEvidence(index, { exchangeId: 'ex1', frameId: 'missing' }, start()), undefined);
  assert.equal(revealEvidence(index, { exchangeId: 'ex1', frameId: idOf(data, 'ex2', 1) }, start()), undefined, 'a frame of another exchange is not this exchange\'s');
});
