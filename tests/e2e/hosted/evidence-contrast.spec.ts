// #47: frame references and offsets are evidence, so their text must stay readable in both default themes.
// The page is the production build. Colors are read back from the browser (computed foreground and the
// background actually painted behind the text, in sRGB) and run through the WCAG relative-luminance formula,
// so a token swapped in the source or an ancestor's fill that changes the backdrop is caught the same way.
// The check covers the default themes only: an adopter's own colors are theirs to check.
import type { Locator } from '@playwright/test';
import { expect, open, send, test } from './support';

type Rgb = readonly [number, number, number];

const AA_NORMAL_TEXT = 4.5;

/** WCAG 2.2 relative luminance of an opaque sRGB color. */
function luminance([r, g, b]: Rgb): number {
  const linear = (value: number) => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

interface Painted {
  text: string;
  size: string;
  foreground: Rgb;
  background: Rgb;
}

/**
 * The foreground and the effective background of every element the locator matches. Each color goes through a
 * canvas pixel, which turns any CSS color (`color-mix`, `oklch`) into the sRGB the screen shows. The background is
 * the translucent fills from the element up to the first opaque one, composited over it. A background image
 * cannot be measured this way, so it throws instead of guessing.
 */
const paint = (locator: Locator): Promise<Painted[]> =>
  locator.evaluateAll((nodes) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const toRgba = (css: string): number[] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data as unknown as [number, number, number, number];
      return [r, g, b, a / 255];
    };
    const over = (top: number[], base: number[]): number[] => {
      const alpha = top[3] as number;
      return [0, 1, 2].map((i) => (top[i] as number) * alpha + (base[i] as number) * (1 - alpha)).concat(1);
    };
    return nodes.map((node) => {
      let opacity = 1;
      const fills: number[][] = [];
      let opaque = false;
      for (let at: Element | null = node; at && !opaque; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.backgroundImage !== 'none') throw new Error(`${at.tagName} paints a background image, which this measurement cannot read`);
        opacity *= Number(style.opacity);
        const fill = toRgba(style.backgroundColor);
        if ((fill[3] as number) > 0) fills.push(fill);
        opaque = fill[3] === 1;
      }
      if (!opaque) throw new Error('no opaque background behind the text');
      const background = fills.reverse().reduce((base, fill) => over(fill, base));
      const color = toRgba(getComputedStyle(node).color);
      const foreground = over([color[0] as number, color[1] as number, color[2] as number, (color[3] as number) * opacity], background);
      return {
        text: node.textContent ?? '',
        size: getComputedStyle(node).fontSize,
        foreground: foreground.slice(0, 3).map(Math.round) as unknown as Rgb,
        background: background.slice(0, 3).map(Math.round) as unknown as Rgb,
      };
    });
  });

test('the contrast measurement reproduces the figures in the issue', () => {
  expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  expect(contrast([0x9e, 0x9b, 0x96], [0xf4, 0xf2, 0xf0])).toBeCloseTo(2.48, 2);
  expect(contrast([0x5f, 0x5c, 0x58], [0x19, 0x17, 0x14])).toBeCloseTo(2.69, 2);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`frame references, delta offsets and subagent offsets reach 4.5:1 in the default ${scheme} theme`, async ({ page, openSite }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const site = await openSite({ config: (origins) => ({ version: 0, agents: [{ id: 'evidence', name: 'Evidence agent', url: `${origins.agent.origin}/evidence` }] }) });
    await open(page, site);
    await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);

    await send(page, 'Hello there');
    await page.getByText('5 deltas').click();

    const deltas = page.getByRole('list', { name: 'Deltas of msg-1' });
    const subagent = page.locator('[data-entry="subagent"]');
    const offset = /^\+\d+\.\d{3}$/;
    const frame = /^frame #\d+$/;
    const evidence: Array<[string, Locator, number]> = [
      ['delta offsets', deltas.getByText(offset), 5],
      ['delta frame references', deltas.getByText(frame), 5],
      ['subagent offsets', subagent.getByText(offset), 2],
      ['subagent frame references', subagent.getByText(frame), 2],
    ];

    for (const [name, locator, count] of evidence) {
      await expect(locator, name).toHaveCount(count);
      for (const { text, size, foreground, background } of await paint(locator)) {
        const ratio = contrast(foreground, background);
        expect.soft(ratio, `${name}: "${text}" at ${size}, rgb(${foreground}) on rgb(${background}) in ${scheme}`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    }
  });
}
