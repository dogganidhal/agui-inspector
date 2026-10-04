// Spec 014 (FR-014, FR-016): how one renderer is called. It gets a copy of the data and an empty container, may return a
// cleanup, and the cleanup runs before the next draw and when the card goes away. A throw is reported once and leaves an
// empty container. A fake container stands in for the element: the repository has no DOM emulation, and what a real container
// shows is checked in Playwright.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountRender } from '../../src/core/plugins/mount.ts';

function container() {
  const log: string[] = [];
  return { log, replaceChildren: () => void log.push('empty') };
}

test('render gets a copy of the data and an empty container, and dispose runs the cleanup and then empties the container', () => {
  const box = container();
  const data = { name: 'example.note', value: { text: 'hi', list: [1, 2] } };
  let seen: unknown;
  const dispose = mountRender(
    (copy, target) => {
      assert.equal(target, box);
      seen = copy;
      box.log.push('render');
      return () => void box.log.push('cleanup');
    },
    JSON.stringify(data),
    box,
    () => assert.fail('no error expected'),
  );
  assert.deepEqual(seen, data);
  assert.notEqual(seen, data, 'a copy, not the original');
  assert.deepEqual(box.log, ['empty', 'render']);
  dispose();
  assert.deepEqual(box.log, ['empty', 'render', 'cleanup', 'empty']);
  dispose();
  assert.deepEqual(box.log, ['empty', 'render', 'cleanup', 'empty'], 'a second dispose does nothing');
});

test('drawing again after a dispose starts from an empty container, with the cleanup of the first draw already run', () => {
  const box = container();
  const draw = (text: string) => mountRender(() => { box.log.push(`render ${text}`); return () => void box.log.push(`cleanup ${text}`); }, JSON.stringify(text), box, () => assert.fail('no error'));
  draw('one')();
  draw('two')();
  assert.deepEqual(box.log, ['empty', 'render one', 'cleanup one', 'empty', 'empty', 'render two', 'cleanup two', 'empty']);
});

test('a renderer that changes its copy changes nothing: the next draw gets the same data', () => {
  const box = container();
  const text = JSON.stringify({ steps: ['Read'] });
  const seen: unknown[] = [];
  const render = (copy: { steps: string[] }) => {
    seen.push(structuredClone(copy));
    copy.steps.push('changed');
  };
  mountRender(render, text, box, () => assert.fail('no error'))();
  mountRender(render, text, box, () => assert.fail('no error'))();
  assert.deepEqual(seen, [{ steps: ['Read'] }, { steps: ['Read'] }]);
});

test('a value that is not a function is not a cleanup', () => {
  const box = container();
  const dispose = mountRender((() => 'not a function') as never, '1', box, () => assert.fail('no error'));
  dispose();
  assert.deepEqual(box.log, ['empty', 'empty']);
});

test('a throw in render is reported once, the container is emptied, and dispose then does nothing', () => {
  const box = container();
  const errors: unknown[] = [];
  const dispose = mountRender(() => { throw new Error('boom'); }, '{}', box, (error) => errors.push(error));
  assert.equal((errors[0] as Error).message, 'boom');
  assert.equal(errors.length, 1);
  assert.deepEqual(box.log, ['empty', 'empty']);
  dispose();
  assert.equal(errors.length, 1);
  assert.deepEqual(box.log, ['empty', 'empty']);
});

test('a throw in the cleanup is reported once and the container is still emptied', () => {
  const box = container();
  const errors: unknown[] = [];
  const dispose = mountRender(() => () => { throw new Error('late boom'); }, '{}', box, (error) => errors.push(error));
  dispose();
  assert.equal((errors[0] as Error).message, 'late boom');
  assert.equal(errors.length, 1);
  assert.deepEqual(box.log, ['empty', 'empty']);
});
