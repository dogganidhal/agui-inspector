// L04 T034 (FR-010, FR-012, FR-017; US1.2 to US1.4): frames in a real browser. Every check compares
// what the page shows or copies with the recording behind it.
import { baselineFrames, concat, protobufScenarios } from '../../../examples/reference-agent/protobuf-fixtures.ts';
import { scenarioBytes } from '../../../examples/reference-agent/recorder-fixtures.ts';
import { expect, open, run, runProtobuf, snapshot, test, expectAllowlisted } from './support.ts';

test.beforeEach(async ({ page, site }) => {
  await open(page, site);
});

const headers = (page: import('@playwright/test').Page) => page.locator('[data-exchange-header]');
const rowsOf = (page: import('@playwright/test').Page, exchange: string) => page.locator(`[data-exchange="${exchange}"] [data-frame-row]`);

test('an empty session says so, and the view has no exchanges to open', async ({ page }) => {
  await expect(page.getByText('No exchanges yet')).toBeVisible();
  await expect(headers(page)).toHaveCount(0);
  await expect(page.getByTestId('frames')).toHaveAttribute('data-frame-total', '0');
});

test('exchanges appear newest first, the newest is expanded, and every frame shows in arrival order', async ({ page }) => {
  await run(page, 'baselineRun');
  await run(page, 'invalidFrames');
  await run(page, 'controlEvidence');

  await expect(headers(page)).toHaveCount(3);
  await expect(headers(page).nth(0)).toHaveAttribute('data-exchange-header', 'exchange-3');
  await expect(headers(page).nth(1)).toHaveAttribute('data-exchange-header', 'exchange-2');
  await expect(headers(page).nth(2)).toHaveAttribute('data-exchange-header', 'exchange-1');
  await expect(headers(page).nth(0)).toHaveAttribute('aria-expanded', 'true');
  await expect(headers(page).nth(1)).toHaveAttribute('aria-expanded', 'false');
  await expect(headers(page).nth(2)).toHaveAttribute('aria-expanded', 'false');

  const session = await snapshot(page);
  const newest = session.frames.filter((frame) => frame.exchangeId === 'exchange-3');
  const shown = await rowsOf(page, 'exchange-3').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-frame-row')));
  expect(shown).toEqual(newest.map((frame) => frame.id));
  // Each row carries its offset, type and summary.
  const first = rowsOf(page, 'exchange-3').filter({ hasText: 'RUN_STARTED' });
  await expect(first).toContainText(/\+\d+\.\d{3}/);
  await expect(first).toContainText('r-proto');
  await expect(page.locator('[data-exchange="exchange-2"] [data-frame-row]')).toHaveCount(0);

  // Opening an older exchange shows its frames; the newest stays open.
  await headers(page).nth(2).click();
  await expect(headers(page).nth(2)).toHaveAttribute('aria-expanded', 'true');
  await expect(rowsOf(page, 'exchange-1')).toHaveCount(30);
  await expect(headers(page).nth(0)).toHaveAttribute('aria-expanded', 'true');
});

test('filters by event family, content and issues, and the counts follow them', async ({ page }) => {
  await run(page, 'baselineRun');
  await run(page, 'invalidFrames');
  await headers(page).nth(1).click();
  const baseline = rowsOf(page, 'exchange-1');
  await expect(baseline).toHaveCount(30);

  // Family chips.
  await page.locator('[data-family-chip="tool"]').click();
  await expect(baseline).toHaveCount(5);
  for (const type of await baseline.locator('.agui-fr-ty').allTextContents()) expect(type).toMatch(/^TOOL_CALL_/);
  await expect(page.locator('[data-exchange-header="exchange-1"]')).toContainText('5/30 frames');
  await expect(page.locator('[data-family-chip="tool"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-family-chip="reasoning"]').click();
  await expect(baseline).toHaveCount(5 + 7);
  await page.locator('[data-family-chip="tool"]').click();
  await page.locator('[data-family-chip="reasoning"]').click();
  await expect(baseline).toHaveCount(30);

  // Content search matches the raw text, not only the type.
  const search = page.getByRole('searchbox', { name: 'Filter frames by type or content' });
  await search.fill('SYNTHETIC-RESEARCHER');
  await expect(baseline).toHaveCount(1);
  await expect(baseline.first()).toContainText('SUBAGENT_STARTED');
  await search.fill('nothing says this');
  await expect(baseline).toHaveCount(0);
  await expect(page.getByText('No frames match the filter.').first()).toBeVisible();
  await search.fill('');
  await expect(baseline).toHaveCount(30);

  // Issues: only frames with a finding, in every exchange; the chip counts them.
  const session = await snapshot(page);
  await expect(page.locator('[data-issues-chip] .agui-count')).toHaveText('5');
  await page.locator('[data-issues-chip]').click();
  await expect(baseline).toHaveCount(0);
  const invalid = rowsOf(page, 'exchange-2');
  await expect(invalid).toHaveCount(5);
  await expect(invalid.locator('.agui-tag--err')).toHaveCount(5);
  expect(session.frames.filter((frame) => frame.exchangeId === 'exchange-2' && frame.jsonVerdict === 'invalid')).toHaveLength(2);
  await page.locator('[data-issues-chip]').click();
  await expect(baseline).toHaveCount(30);
});

test('a frame opens to its raw text, formatted JSON or exactly as received', async ({ page }) => {
  await run(page, 'invalidFrames');
  const session = await snapshot(page);
  const frames = session.frames.filter((frame) => frame.exchangeId === 'exchange-1');

  // Valid JSON is formatted for reading and says so; the copy button and label stay on the raw text.
  const valid = frames.find((frame) => frame.eventType === 'RUN_STARTED')!;
  await page.locator(`[data-frame-row="${valid.id}"]`).click();
  const detail = page.locator(`[data-frame-detail="${valid.id}"]`);
  await expect(detail).toContainText('as received');
  await expect(detail.locator('pre')).toHaveText(JSON.stringify(valid.parsed, null, 2));

  // Data that is not JSON is shown character for character, with the finding beside it.
  for (const bad of frames.filter((frame) => frame.jsonVerdict === 'invalid')) {
    await page.locator(`[data-frame-row="${bad.id}"]`).click();
    const text = page.locator(`[data-frame-detail="${bad.id}"]`);
    await expect(text.locator('pre')).toHaveText(bad.data!);
    await expect(text).toContainText('Data is not valid JSON');
    await expect(page.locator(`[data-frame-row="${bad.id}"]`)).toContainText('unparsed');
  }

  // Unknown types and schema failures keep their type, their verdict and their text.
  const unknown = frames.find((frame) => frame.eventType === 'SYNTHETIC_FUTURE_EVENT')!;
  await page.locator(`[data-frame-row="${unknown.id}"]`).click();
  await expect(page.locator(`[data-frame-detail="${unknown.id}"]`)).toContainText('not in the supported baseline');
  const wrongField = frames.find((frame) => frame.eventType === 'TEXT_MESSAGE_CONTENT' && frame.parsed && (frame.parsed as { delta?: unknown }).delta === 7)!;
  await page.locator(`[data-frame-row="${wrongField.id}"]`).click();
  await expect(page.locator(`[data-frame-detail="${wrongField.id}"]`)).toContainText('Does not match the AG-UI event schema');
  await expect(page.locator(`[data-frame-detail="${wrongField.id}"] pre`)).toContainText('"delta": 7');

  // Closing a frame removes its detail.
  await page.locator(`[data-frame-row="${valid.id}"]`).click();
  await expect(detail).toHaveCount(0);
});

test('control evidence is listed with its envelope, not as an event', async ({ page }) => {
  await run(page, 'controlEvidence');
  const session = await snapshot(page);
  const control = session.frames.filter((frame) => frame.classification === 'control');
  expect(control.length).toBeGreaterThan(0);
  const row = page.locator(`[data-frame-row="${control[0]!.id}"]`);
  await expect(row).toContainText('control');
  await row.click();
  await expect(page.locator(`[data-frame-detail="${control[0]!.id}"] pre`)).toHaveText(control[0]!.envelope);
  await expect(page.getByTestId('frames')).toHaveAttribute('data-frame-total', '3');
});

test('copying an exchange puts its original frame records, in order, on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await run(page, 'baselineRun');
  await run(page, 'invalidFrames');
  const session = await snapshot(page);
  const expected = session.frames.filter((frame) => frame.exchangeId === 'exchange-1');

  await page.getByRole('button', { name: /Copy the frames of POST \/scenario\/baselineRun as JSON/ }).click();
  await expect(page.getByText('Copied 30 frames')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied)).toEqual(expected);
  expect(copied).toBe(JSON.stringify(expected, null, 2));

  // A filter changes the view, not the recording that gets copied.
  await page.locator('[data-family-chip="tool"]').click();
  await page.getByRole('button', { name: /Copy the frames of POST \/scenario\/baselineRun as JSON/ }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(copied);

  // One frame's raw text copies exactly as received.
  await page.locator('[data-exchange-header="exchange-1"]').click();
  const first = expected.find((frame) => frame.eventType === 'TOOL_CALL_ARGS')!;
  await page.locator(`[data-frame-row="${first.id}"]`).click();
  await page.locator(`[data-frame-detail="${first.id}"]`).getByRole('button', { name: 'Copy the frame as received' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first.data);
});

test('without clipboard access the text is offered for copying by hand', async ({ page, context }) => {
  await context.clearPermissions();
  await run(page, 'baselineRun');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
  });
  await page.getByRole('button', { name: /Copy the frames of/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy by hand' });
  await expect(dialog).toBeVisible();
  expect(JSON.parse(await dialog.getByRole('textbox').inputValue())).toHaveLength(30);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('original chunk events stay in the list with their client-derived expansion beside them', async ({ page }) => {
  await run(page, 'baselineRun');
  const session = await snapshot(page);
  const chunk = session.frames.find((frame) => frame.eventType === 'TEXT_MESSAGE_CHUNK')!;
  await page.evaluate((source) => {
    (window as unknown as { __host: { store(): { appendDerived(entry: unknown): void } } }).__host.store().appendDerived({
      id: 'derived-1',
      provenance: 'derived',
      derivation: 'chunk-expansion',
      sources: [source],
      attribution: 'identified',
      eventType: 'TEXT_MESSAGE_CONTENT',
      label: 'Expanded from TEXT_MESSAGE_CHUNK',
      value: { messageId: 'm2', delta: 'héllo' },
    });
  }, chunk.id);

  const original = page.locator(`[data-frame-row="${chunk.id}"]`);
  await expect(original).toContainText('TEXT_MESSAGE_CHUNK');
  const derived = page.locator('[data-derived-row="derived-1"]');
  await expect(derived).toBeVisible();
  await expect(derived).toHaveAttribute('data-derived-from', chunk.id);
  await expect(derived).toContainText('derived');
  await expect(derived.locator('.agui-fr-off')).toHaveText('');
  // It follows the chunk directly.
  expect(await original.locator('xpath=..').evaluate((item) => item.nextElementSibling?.querySelector('[data-derived-row]')?.getAttribute('data-derived-row'))).toBe('derived-1');
  await derived.click();
  await expect(page.getByText(/Not on the wire/)).toBeVisible();
  // The original is untouched and still listed once.
  await expect(page.locator(`[data-frame-row="${chunk.id}"]`)).toHaveCount(1);
  // Counts and copies are of received frames only.
  await expect(page.getByTestId('frames')).toHaveAttribute('data-frame-total', '30');
});

test('the list is keyboard accessible: headers and rows toggle with Enter and Space', async ({ page }) => {
  await run(page, 'baselineRun');
  await run(page, 'invalidFrames');
  const older = page.locator('[data-exchange-header="exchange-1"]');
  // The store tells the view once per animation frame, so the run resolving does not mean the list
  // already shows it. Until the second exchange is listed and the first has collapsed, "older" is
  // still the newest and open, and a key press would close it instead of opening it.
  await expect(headers(page)).toHaveCount(2);
  await expect(older).toHaveAttribute('aria-expanded', 'false');
  await older.focus();
  await page.keyboard.press('Enter');
  await expect(older).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Space');
  await expect(older).toHaveAttribute('aria-expanded', 'false');

  const row = page.locator('[data-exchange="exchange-2"] [data-frame-row]').first();
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Space');
  await expect(row).toHaveAttribute('aria-expanded', 'false');

  // Filters are reachable by keyboard too.
  const chip = page.locator('[data-family-chip="text"]');
  await chip.focus();
  await page.keyboard.press('Enter');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
});

test('on a phone the summary column goes away and rows keep type and verdict', async ({ page }) => {
  await run(page, 'baselineRun');
  await page.setViewportSize({ width: 400, height: 800 });
  const row = page.locator('[data-frame-row]').first();
  await expect(row.locator('.agui-fr-sum')).toBeHidden();
  await expect(row.locator('.agui-fr-ty')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the page asks for nothing outside its own origin and the scripted agent', async ({ page, site, network }) => {
  await run(page, 'baselineRun');
  expectAllowlisted(network, site);
  expect(network.some((url) => /fonts\.|googleapis|gstatic/.test(url))).toBe(false);
});

// ---- protobuf exchanges (spec 013, US1) -------------------------------------------------------------

const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

test('a protobuf run lists one frame for each message the server sent, in order, with the bytes it wrote (SC-001)', async ({ page }) => {
  const id = await runProtobuf(page, 'baselineRun');
  const session = await snapshot(page);
  const exchange = session.exchanges.find((candidate) => candidate.id === id)!;
  const frames = session.frames.filter((frame) => frame.exchangeId === id);

  expect(exchange.encoding).toBe('protobuf');
  expect(frames).toHaveLength(baselineFrames.length);
  expect(frames.map((frame) => frame.index)).toEqual(baselineFrames.map((_, at) => at));
  expect(frames.every((frame) => frame.classification === 'data' && frame.bytes !== undefined && frame.data === undefined)).toBe(true);
  expect(Buffer.from(concat(frames.map((frame) => fromBase64(frame.bytes!))))).toEqual(Buffer.from(scenarioBytes(protobufScenarios.baselineRun)));
  expect(frames.map((frame) => frame.offsetMs)).toEqual([...frames.map((frame) => frame.offsetMs)].sort((a, b) => a - b));
  expect(session.findings.filter((finding) => finding.subject.id === id)).toEqual([]);

  await expect(page.locator(`[data-exchange-header="${id}"]`)).toContainText('protobuf');
  const rows = page.locator(`[data-exchange="${id}"] [data-frame-row]`);
  await expect(rows).toHaveCount(baselineFrames.length);
  const first = rows.first();
  await expect(first).toContainText('RUN_STARTED');
  await expect(first).toContainText('r-proto');
  await expect(first).toContainText(/\+\d+\.\d{3}/);
  await expect(first.locator('.agui-tag', { hasText: 'binary' })).toBeVisible();
  await expect(rows.filter({ hasText: 'TEXT_MESSAGE_CONTENT' }).first()).toContainText('héllo wörld');
});

test('expanding a binary frame shows the decoded event and the bytes, and both copy buttons give what is shown', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const id = await runProtobuf(page, 'baselineRun');
  const frame = (await snapshot(page)).frames.find((candidate) => candidate.exchangeId === id && candidate.eventType === 'TEXT_MESSAGE_CONTENT')!;
  await page.locator(`[data-frame-row="${frame.id}"]`).click();
  const detail = page.locator(`[data-frame-detail="${frame.id}"]`);

  const bytes = fromBase64(frame.bytes!);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  await expect(detail).toContainText(`Bytes · ${bytes.length} B as received`);
  const dump = detail.getByRole('region', { name: 'Frame bytes as hexadecimal text' });
  await expect(dump).toContainText(hex.slice(0, 4).join(' '), { useInnerText: true });
  expect(hex.slice(0, 3)).toEqual(['00', '00', '00']);
  await expect(detail.getByRole('region', { name: 'Decoded event' })).toContainText('"messageId": "m1"');

  await detail.getByRole('button', { name: 'Copy all the bytes of the frame as hexadecimal text' }).click();
  const copiedBytes = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedBytes.split(/\s+/)).toEqual(hex);
  await detail.getByRole('button', { name: 'Copy the decoded event as JSON' }).click();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(frame.parsed);
});

test('a binary frame over 4,096 bytes shows the first 4,096 and says how many are not shown, and Copy gives all of them', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const id = await runProtobuf(page, 'largeFrame');
  const frame = (await snapshot(page)).frames.find((candidate) => candidate.exchangeId === id && candidate.eventType === 'TEXT_MESSAGE_CONTENT')!;
  const total = fromBase64(frame.bytes!).length;
  expect(total).toBeGreaterThan(4096);
  await page.locator(`[data-frame-row="${frame.id}"]`).click();
  const detail = page.locator(`[data-frame-detail="${frame.id}"]`);

  await expect(detail).toContainText(`the first 4096 shown, ${total - 4096} not shown`);
  const shown = (await detail.getByRole('region', { name: 'Frame bytes as hexadecimal text' }).innerText()).trim().split(/\s+/);
  expect(shown).toHaveLength(4096);
  await detail.getByRole('button', { name: 'Copy all the bytes of the frame as hexadecimal text' }).click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).split(/\s+/)).toHaveLength(total);
});

test('the filter finds a binary frame by event type and by decoded content', async ({ page }) => {
  const id = await runProtobuf(page, 'baselineRun');
  const search = page.getByRole('searchbox', { name: 'Filter frames by type or content' });
  await search.fill('reasoning_encrypted_value');
  await expect(page.locator(`[data-exchange="${id}"] [data-frame-row]`)).toHaveCount(1);
  await search.fill('synthetic-researcher');
  await expect(page.locator(`[data-exchange="${id}"] [data-frame-row]`)).toHaveCount(1);
  await expect(page.locator(`[data-exchange="${id}"] [data-frame-row]`)).toContainText('SUBAGENT_STARTED');
});

test('a protobuf run asks for nothing outside the page and the scripted agent', async ({ page, site, network }) => {
  await runProtobuf(page, 'baselineRun');
  expectAllowlisted(network, site);
});

// ---- damaged protobuf streams (spec 013, US4; SC-006) ----------------------------------------------------------

const DAMAGED = [
  ['undecodablePayload', 'binary', /not a valid protobuf event/],
  ['zeroLength', 'binary', /not a valid protobuf event/],
  ['unknownEvent', 'schema', /not in the supported baseline/],
  ['invalidEvent', 'schema', /Does not match the AG-UI event schema/],
  ['truncatedFrame', undefined, undefined],
  ['truncatedLength', undefined, undefined],
  ['oversizedLength', 'binary', /larger than 10 MB/],
  ['answeredInSse', 'binary', /another encoding/],
] as const;

for (const [name, kind, message] of DAMAGED) {
  test(`protobuf ${name}: every byte the server sent is in the recording with its finding, and capture goes on`, async ({ page, site, network }) => {
    const id = await runProtobuf(page, name);
    const session = await snapshot(page);
    const exchange = session.exchanges.find((candidate) => candidate.id === id)!;
    const frames = session.frames.filter((frame) => frame.exchangeId === id);

    expect(exchange.transport).toBe('completed');
    expect(exchange.encoding).toBe('protobuf');
    expect(Buffer.from(concat(frames.map((frame) => fromBase64(frame.bytes!)))), 'every byte, in order').toEqual(Buffer.from(scenarioBytes(protobufScenarios[name])));
    expect(frames.map((frame) => frame.index)).toEqual(frames.map((_, at) => at));

    const own = session.findings.filter((finding) => finding.subject.type === 'frame' && frames.some((frame) => frame.id === finding.subject.id));
    if (kind === undefined) {
      expect(own, 'a stream cut inside a frame keeps the bytes as a partial frame and says nothing more').toEqual([]);
      expect(frames.at(-1)?.classification).toBe('partial');
    } else {
      expect(own.map((finding) => finding.kind)).toContain(kind);
      expect(own.map((finding) => finding.message).join('\n')).toMatch(message);
      const flagged = frames.find((frame) => own.some((finding) => finding.subject.id === frame.id))!;
      const row = page.locator(`[data-frame-row="${flagged.id}"]`);
      await expect(row.locator('.agui-tag--err')).toBeVisible();
      await row.click();
      await expect(page.locator(`[data-frame-detail="${flagged.id}"]`)).toContainText(message);
      for (const finding of own.filter((candidate) => candidate.subject.id === flagged.id)) await expect(page.locator(`[data-frame-detail="${flagged.id}"]`)).toContainText(finding.rule!);
      await expect(page.locator(`[data-frame-detail="${flagged.id}"]`)).toContainText('Capture continued.');
    }
    // The frames before the damage and after it are still listed.
    await expect(page.locator(`[data-exchange="${id}"] [data-frame-row]`)).toHaveCount(frames.length);
    expectAllowlisted(network, site);
  });
}

test('after damaged protobuf the next run is still recorded: capture does not stop', async ({ page }) => {
  await runProtobuf(page, 'undecodablePayload');
  const next = await runProtobuf(page, 'baselineRun');
  const session = await snapshot(page);
  expect(session.frames.filter((frame) => frame.exchangeId === next)).toHaveLength(baselineFrames.length);
  expect(session.findings.filter((finding) => finding.subject.id.startsWith(next))).toEqual([]);
});
