// Spec 020: an A2UI 1.0 card in a browser. The reference agent's card names its own catalog id, which a configured
// alias maps to the 1.0 basic catalog. It draws with the official renderer under the page's style policy, the
// component the catalog lacks is a flagged error in place with its properties, and the button sends the five-field
// envelope with its @path context resolved at the click.
import { expect } from '@playwright/test';
import { AGENT_V10_CATALOG_ID, BASIC_V10_CATALOG_ID, formSurface, v10Card } from '../../../examples/reference-agent/a2ui-scenarios';
import { actions, feed, open, test } from './support';

const ALIASES = { [AGENT_V10_CATALOG_ID]: BASIC_V10_CATALOG_ID };

test('the 1.0 card draws on an aliased catalog id, flags the unknown component in place, and its button sends the envelope', async ({ page, site }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  await open(page, site, { strict: true });
  await page.evaluate((map) => window.__a2ui.aliases(map), ALIASES);
  await feed(page, v10Card);

  const card = page.locator('[data-surface="visit"]');
  await expect(card).toHaveAttribute('data-version', '1.0');
  await expect(card.getByText('Book a visit')).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'Name' })).toHaveValue('Ada');
  await expect(card.getByRole('button', { name: 'Confirm' })).toBeVisible();
  await expect(page.locator('.agui-a2ui-issues')).toHaveCount(0);

  const unknown = card.getByRole('alert');
  await expect(unknown).toHaveCount(1);
  await expect(unknown).toContainText('Unknown component type: StarRating');
  await expect(unknown).toContainText('Component rating');
  await unknown.getByText('As received').click();
  await expect(unknown.getByRole('region', { name: 'Received component rating' })).toContainText('"stars": 4');

  await card.getByRole('button', { name: 'Confirm' }).click();
  await card.getByRole('textbox', { name: 'Name' }).fill('Grace');
  await card.getByRole('button', { name: 'Confirm' }).click();
  const sent = await actions(page);
  expect(sent).toHaveLength(2);
  expect(Object.keys(sent[0]!).sort()).toEqual(['context', 'name', 'sourceComponentId', 'surfaceId', 'timestamp']);
  expect(sent[0]).toMatchObject({ name: 'confirm_booking', surfaceId: 'visit', sourceComponentId: 'confirm', context: { name: 'Ada', slot: ['morning'], source: 'card' } });
  expect(sent[1]!.context).toEqual({ name: 'Grace', slot: ['morning'], source: 'card' });
  expect(violations).toEqual([]);
});

test('without the alias the agent catalog id is "Catalog not found", and a 1.0 and a v0.9 surface draw side by side', async ({ page, site }) => {
  await open(page, site);
  await feed(page, v10Card);
  await expect(page.locator('.agui-a2ui-issues')).toContainText(`Catalog not found: ${AGENT_V10_CATALOG_ID}`);
  await expect(page.locator('[data-surface="visit"]')).toHaveCount(0);

  await page.evaluate((map) => window.__a2ui.aliases(map), ALIASES);
  await feed(page, [...v10Card, ...formSurface]);
  await expect(page.locator('.agui-a2ui-surface')).toHaveCount(2);
  await expect(page.locator('.agui-a2ui-surface').nth(0)).toHaveAttribute('data-version', '1.0');
  await expect(page.locator('.agui-a2ui-surface').nth(1)).toHaveAttribute('data-version', 'v0.9');
  await expect(page.getByRole('heading', { name: 'Order check' })).toBeVisible();
});
