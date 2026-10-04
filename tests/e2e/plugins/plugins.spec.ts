// Spec 014 (FR-022; SC-004): the example plugin of the issue's first acceptance criterion. examples/plugin/plugin.js is
// served from the page's own origin and listed in config.json, and it uses each extension point against the reference
// agent: a header that changes on every request, an input with a counter, a card for a custom event and one for an activity.
// The header's value is in no place the inspector writes, and the frames and the export are those of a run with no plugin.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PLUGINS } from '../../../examples/reference-agent/scenarios.ts';
import { expect, test, root } from '../hosted/support';
import { embeddedWith, exportedSession, footer, hostedWith, JS, PLUGIN_RUN_FRAMES, runMessage, warningList } from './support';

const EXAMPLE = readFileSync(path.join(root, 'examples', 'plugin', 'plugin.js'), 'utf8');
const PREPARE = { preset: { prepare: [{ method: 'POST', path: '/interactive', body: { threadId: '{{threadId}}', runId: '{{runId}}' } }] } };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const framesOf = (session: Awaited<ReturnType<typeof exportedSession>>['session']) => session.frames.map((frame) => [frame.eventType, frame.envelope.replace(UUID, '<id>'), frame.data?.replace(UUID, '<id>')]);

for (const mode of ['hosted', 'embedded'] as const) {
  test(`${mode}: the example plugin uses each extension point against the reference agent`, async ({ page, openSite, violations }) => {
    const files = { '/plugins/example.js': { type: JS, body: EXAMPLE } };
    const withPlugin = await openSite(mode === 'hosted' ? hostedWith(['plugins/example.js'], files, (origin) => ({ id: 'support', url: `${origin}/interactive`, ...PREPARE })) : embeddedWith(['plugins/example.js'], files, { url: '/interactive', ...PREPARE }));
    const plain = await openSite(mode === 'hosted' ? hostedWith([], {}, (origin) => ({ id: 'support', url: `${origin}/interactive`, ...PREPARE })) : embeddedWith([], {}, { url: '/interactive', ...PREPARE }));
    const seen = (site: typeof withPlugin) => (mode === 'hosted' ? site.agent.seen : site.page.seen.filter((entry) => entry.method === 'POST'));

    await page.goto(withPlugin.page.origin);
    await expect(footer(page)).toContainText('1 plugin');
    expect(await warningList(page)).toEqual([]);
    await runMessage(page, PLUGINS, 2, PLUGIN_RUN_FRAMES);

    // The provider: a header that differs on the preparation and on the run.
    const requests = seen(withPlugin).filter((entry) => entry.path === '/interactive');
    expect(requests.map((entry) => entry.headers?.['x-example-request'])).toEqual(['1', '2']);
    // The hook: the counter is in the body that was sent, and the recording shows that body.
    const run = requests[1];
    expect((JSON.parse(run?.body ?? '{}') as { forwardedProps: unknown }).forwardedProps).toEqual({ examplePlugin: { run: 1 } });
    // The renderers.
    await expect(page.getByTestId('example-note')).toHaveText('Note: Synthetic note');
    await expect(page.getByTestId('example-plan').locator('li')).toHaveText(['Read', 'Write', 'Review']);
    expect(await violations(), 'the example runs under the page policy').toEqual([]);

    const exported = await exportedSession(page);
    const conversation = exported.session.exchanges.filter((exchange) => exchange.kind === 'conversation');
    expect(conversation.map((exchange) => exchange.requestBody)).toEqual([run?.body]);
    expect(exported.text).not.toContain('x-example-request');
    expect(exported.text.toLowerCase()).not.toContain('"headers"');

    // A run with no plugin: the same frames, the same derived entries and findings; only the request body differs.
    await page.goto(plain.page.origin);
    await runMessage(page, PLUGINS, 2, PLUGIN_RUN_FRAMES);
    const without = await exportedSession(page);
    const bodyOf = (session: typeof exported.session) => session.runs.map((entry) => entry.input.forwardedProps);
    expect(bodyOf(without.session)).toEqual([{}]);
    expect(framesOf(exported.session)).toEqual(framesOf(without.session));
    expect(exported.session.derived).toEqual(without.session.derived);
    expect(exported.session.findings).toEqual(without.session.findings);
    expect(seen(plain).every((entry) => entry.headers?.['x-example-request'] === undefined)).toBe(true);
  });
}
