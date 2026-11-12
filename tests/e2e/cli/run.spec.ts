// Feature 018, T020: the built `agui-inspector run` records a run without a browser, and the page opens its file.
import { expect, open, runCommand, startCommand, startReferenceAgent, test } from './support.ts';

test('run writes a session file that the page served by the command imports with the same frames', async ({ page, later }) => {
  const agent = await startReferenceAgent();
  later(() => agent.stop());
  const ran = await runCommand(['run', '--target', `${agent.origin}/agent`, '--message', 'hello']);
  expect(ran.code, ran.stderr).toBe(0);
  expect(ran.stderr).toMatch(/may contain personal or sensitive data/);
  const file = JSON.parse(ran.stdout) as { session: { frames: unknown[] } };
  expect(file.session.frames.length).toBeGreaterThan(2);

  const served = await startCommand(['--target', `${agent.origin}/agent`, '--port', '0']);
  later(() => served.stop());
  await open(page, served.origin);
  await page.getByLabel('Session file to import').setInputFiles({ name: 'session.json', mimeType: 'application/json', buffer: Buffer.from(ran.stdout) });
  await expect(page.getByText('Imported recording: inspection only')).toBeVisible();
  await expect(page.locator('[data-frame-row]')).toHaveCount(file.session.frames.length);
});
