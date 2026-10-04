// F07 (US2, FR-010 to FR-012, SC-003): capability findings on the production page. The agent is scripted and
// model-free (examples/reference-agent/rule-fixtures.ts); the configuration, runtime, frame reader and views are the
// real ones. An agent whose declaration its stream breaks gets a finding on each contradicting frame, shown in that
// frame's detail with its rule id, and the same finding is in the exported session. Omitted or true flags give none.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, expectAllowlisted, open, send, test } from './support';

const DECLARED_FALSE = { reasoning: { supported: false }, state: { deltas: false }, humanInTheLoop: { interrupts: false } };
const DECLARED_TRUE = { reasoning: { supported: true }, state: { deltas: true }, humanInTheLoop: { interrupts: true } };

const config = (capabilities: (origins: { agent: { origin: string } }) => object | string | undefined) => (origins: { agent: { origin: string } }) => ({
  version: 0,
  agents: [{ id: 'contradicting', name: 'Contradicting agent', url: `${origins.agent.origin}/contradiction`, ...(capabilities(origins) !== undefined && { capabilities: capabilities(origins) }) }],
});

async function exportedFindings(page: Page): Promise<Array<{ kind: string; rule?: string; message: string; subject: { type: string; id: string } }>> {
  await page.getByRole('button', { name: 'Export session' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export session' }).click()]);
  return (JSON.parse(readFileSync((await download.path())!, 'utf8')) as { session: { findings: never[] } }).session.findings;
}

/** Opens a frame by its type and returns what its detail says about findings. */
async function findingsOf(page: Page, type: string): Promise<{ rules: string[]; warning: number; error: number }> {
  const row = page.locator('[data-frame-row]', { hasText: type }).first();
  await row.click();
  const detail = page.locator(`[data-frame-detail="${await row.getAttribute('data-frame-row')}"]`);
  await expect(detail).toBeVisible();
  return {
    rules: await detail.locator('.agui-finding code').allTextContents(),
    warning: await detail.locator('.agui-finding--warn').count(),
    error: await detail.locator('.agui-finding--err').count(),
  };
}

const CONTRADICTIONS: Array<[type: string, rule: string]> = [
  ['REASONING_START', 'capability.reasoning-unsupported'],
  ['STATE_DELTA', 'capability.state-delta-unsupported'],
  ['RUN_FINISHED', 'capability.interrupt-unsupported'],
];

test('an agent that declares reasoning, state deltas and interrupts false gets a finding on each frame that breaks it, from an inline declaration and from a URL', async ({ page, openSite, requested }) => {
  for (const [name, declared] of [['inline', () => DECLARED_FALSE], ['URL', (o: { agent: { origin: string } }) => `${o.agent.origin}/capabilities-contradicted`]] as const) {
    const site = await openSite({ config: config(declared) });
    await open(page, site);
    // A URL is read when the agent is selected, and the stream is judged against what has loaded by then.
    if (name === 'URL') {
      const panes = page.getByRole('group', { name: 'Inspection pane' });
      await panes.getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByText('Declared capabilities, read from')).toBeVisible();
      await panes.getByRole('button', { name: 'Inspection' }).click();
    }

    await send(page, 'break what you declared');
    await expect(page.getByRole('button', { name: /RUN_FINISHED/ })).toBeVisible();

    for (const [type, rule] of CONTRADICTIONS) {
      const found = await findingsOf(page, type);
      expect(found.rules, `${name}: ${type}`).toEqual([rule]);
      expect(found.warning, `${name}: ${type} uses the warning styling`).toBe(1);
      expect(found.error).toBe(0);
    }
    // The reasoning span has two events, so two frames carry the reasoning rule; the end event is one of them.
    expect((await findingsOf(page, 'REASONING_END')).rules).toEqual(['capability.reasoning-unsupported']);

    const findings = await exportedFindings(page);
    const capability = findings.filter((finding) => finding.rule?.startsWith('capability.')).map((finding) => [finding.kind, finding.rule, finding.subject.type].join(' '));
    expect(capability.sort(), `${name}: the export holds the findings with their rules`).toEqual([
      'capability capability.interrupt-unsupported frame',
      'capability capability.reasoning-unsupported frame',
      'capability capability.reasoning-unsupported frame',
      'capability capability.state-delta-unsupported frame',
    ]);
    expect(await page.locator('[data-issues-chip] .agui-count').textContent(), `${name}: the Issues chip counts the frames`).toBe('4');
    expectAllowlisted(requested.splice(0), [site.page.origin, site.agent.origin]);
  }
});

test('the same stream from an agent that declares true, or nothing, gets no finding', async ({ page, openSite }) => {
  for (const [name, declared] of [['true', () => DECLARED_TRUE], ['nothing', () => undefined]] as const) {
    const site = await openSite({ config: config(declared) });
    await open(page, site);
    await send(page, 'break what you declared');
    await expect(page.getByRole('button', { name: /RUN_FINISHED/ })).toBeVisible();
    for (const [type] of CONTRADICTIONS) expect((await findingsOf(page, type)).rules, `${name}: ${type}`).toEqual([]);
    expect(await exportedFindings(page), `${name}: no finding in the export`).toEqual([]);
  }
});
