// Spec 013 (FR-014, FR-016): the byte helpers that the binary frame reader, the session files and the views share.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byteCountOf, fromBase64, hexDump, toBase64 } from '../../src/core/frames/bytes.ts';

const everyByte = Uint8Array.from({ length: 256 }, (_, value) => value);

test('every byte value round trips through base64, at every length from 0 to 9', () => {
  for (let length = 0; length <= 9; length += 1) {
    const bytes = everyByte.slice(250 - length, 250);
    const text = toBase64(bytes);
    assert.deepEqual(fromBase64(text), bytes, `length ${bytes.length}`);
    assert.equal(byteCountOf(text), bytes.length);
  }
  assert.deepEqual(fromBase64(toBase64(everyByte)), everyByte);
});

test('base64 is the standard alphabet with padding', () => {
  assert.equal(toBase64(new Uint8Array([0, 0, 0, 0x13])), 'AAAAEw==');
  assert.equal(toBase64(new Uint8Array([0xfb, 0xff])), '+/8=');
  assert.equal(toBase64(new Uint8Array(0)), '');
});

test('arrays above 64 KB do not overflow the stack and still round trip', () => {
  const big = new Uint8Array(3 * 1024 * 1024 + 1);
  for (let at = 0; at < big.length; at += 1) big[at] = (at * 31 + (at >> 8)) & 0xff;
  const text = toBase64(big);
  assert.equal(byteCountOf(text), big.length);
  assert.deepEqual(fromBase64(text), big);
});

test('only canonical base64 is accepted: padding, alphabet, whitespace and stray bits are checked', () => {
  for (const bad of ['AAAAEw=', 'AAAAEw', 'AAAA Ew==', 'AAAA\nEw==', 'AAAAEw===', 'AAA*', '-_8=', 'AAAAEx==', '=AAA', 'A']) {
    assert.equal(fromBase64(bad), undefined, JSON.stringify(bad));
  }
  assert.deepEqual(fromBase64(''), new Uint8Array(0));
});

test('hexDump gives two lowercase digits per byte, sixteen bytes a line, and reports shown and total', () => {
  const bytes = Uint8Array.from({ length: 20 }, (_, value) => value * 13);
  const dump = hexDump(toBase64(bytes), 4096);
  assert.equal(dump.total, 20);
  assert.equal(dump.shown, 20);
  assert.equal(dump.text, '00 0d 1a 27 34 41 4e 5b 68 75 82 8f 9c a9 b6 c3\nd0 dd ea f7');
  assert.equal(hexDump('', 4096).text, '');
});

test('hexDump stops at the limit and the count says how many bytes are not shown', () => {
  const bytes = Uint8Array.from({ length: 5000 }, (_, at) => at & 0xff);
  const dump = hexDump(toBase64(bytes), 4096);
  assert.equal(dump.shown, 4096);
  assert.equal(dump.total, 5000);
  assert.equal(dump.text.split('\n').length, 256);
  assert.equal(dump.text.split(/\s+/).length, 4096);
  const all = hexDump(toBase64(bytes), Number.POSITIVE_INFINITY);
  assert.equal(all.shown, 5000);
  assert.equal(all.text.split(/\s+/).length, 5000);
  assert.ok(all.text.startsWith(dump.text), 'the shown part is the start of the whole');
  const odd = hexDump(toBase64(bytes.slice(0, 4099)), 4097);
  assert.equal(odd.shown, 4097);
  assert.equal(odd.text.split(/\s+/).length, 4097);
});
