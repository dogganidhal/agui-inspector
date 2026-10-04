// Shared by the plugin specs (spec 014): plugin modules as text, the page parts they leave marks on, and the session
// export read back from the browser. Self-contained like tests/e2e/hosted/support.ts, which it builds on.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, send, type SiteOptions } from '../hosted/support';

export const JS = 'text/javascript';

/** The module of a plugin that registers nothing and leaves its letter on the page, in activation order. */
export const marker = (letter: string): string =>
  `export default () => { document.documentElement.dataset.pluginLoaded = (document.documentElement.dataset.pluginLoaded ?? '') + '${letter}'; };\n`;

export const footer = (page: Page) => page.getByRole('contentinfo');
export const warnings = (page: Page) => page.getByRole('status', { name: 'Configuration warnings' });
export const warn = (page: Page) => warnings(page).locator('.agui-finding--warn');
export const metas = (page: Page) => page.locator('meta[http-equiv="Content-Security-Policy"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''));
export const loaded = (page: Page) => page.evaluate(() => document.documentElement.dataset.pluginLoaded ?? '');

/** Every warning in the warnings area as `[kind, text]`. */
export async function warningList(page: Page): Promise<Array<[string, string]>> {
  const findings = await warn(page).all();
  return Promise.all(findings.map(async (finding): Promise<[string, string]> => {
    const text = (await finding.innerText()).replace(/\s+/g, ' ').trim();
    const kind = /^(Configuration|Plugin)\b/.exec(text)?.[1] ?? '';
    return [kind, text.slice(kind.length).replace(/^\s*·\s*/, '').trim()];
  }));
}

/** An embedded page whose `config.json` lists `plugins` and whose own origin serves `files`. */
export function embeddedWith(plugins: readonly string[], files: NonNullable<SiteOptions['files']>, extra: object = {}): SiteOptions {
  return { hosting: () => null, config: () => ({ version: 0, agents: [{ id: 'support', url: '/agent', ...extra }], plugins }), files };
}

/** A hosted page with the scripted agent on another origin, and a `config.json` that lists `plugins`. */
export function hostedWith(plugins: readonly string[], files: NonNullable<SiteOptions['files']>, agent: (origin: string) => object = (origin) => ({ id: 'support', url: `${origin}/interactive` })): SiteOptions {
  return { config: (o) => ({ version: 0, agents: [agent(o.agent.origin)], plugins }), files };
}

/** The session as the page exports it. The export dialog warns first, as for every export. */
export async function exportedSession(page: Page): Promise<{ text: string; session: { exchanges: Array<{ id: string; kind: string; requestBody?: string; path: string }>; runs: Array<{ id: string; input: Record<string, unknown> }>; frames: Array<{ envelope: string; data?: string; eventType?: string; exchangeId: string }>; derived: unknown[]; findings: unknown[] } }> {
  await page.getByRole('button', { name: 'Export session' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export session' }).click()]);
  const text = readFileSync((await download.path())!, 'utf8');
  return { text, session: (JSON.parse(text) as { session: never }).session };
}

/** Sends a message to the scripted agent and waits until `exchanges` runs have ended, with `frames` frames in all (five for each plain run). */
export async function runMessage(page: Page, text: string, exchanges = 1, frames = exchanges * 5): Promise<void> {
  await send(page, text);
  await expect(footer(page)).toContainText(`${exchanges} exchange${exchanges === 1 ? '' : 's'} · ${frames} frames`);
}

/** The plugin scenario of the reference agent has eight frames. */
export const PLUGIN_RUN_FRAMES = 8;

