// Applies the theme maps from `config.json` (FR-041, G-09). The values were validated when the
// configuration was read; here they only become custom properties on the root element, which is where
// the stylesheet declares the public `--agui-*` defaults, so a host stylesheet and a map override the
// same declarations. They are set through the CSS object model, which the content security policy
// (`style-src 'self'`) does not restrict, and follow the stylesheet's own light/dark choice: an
// explicit `data-theme` on the root, otherwise the system preference.
import type { ThemeConfig } from '../../contracts';

/** The two browser features `applyTheme` needs; a test supplies small stand-ins. */
export interface ThemeWindow {
  readonly matchMedia: Window['matchMedia'];
  readonly MutationObserver: typeof MutationObserver;
}

/** Sets the map for the current mode, now and whenever the mode changes. Nothing is touched without a map. */
export function applyTheme(root: HTMLElement, theme: ThemeConfig | undefined, win: ThemeWindow): void {
  if (theme?.light === undefined && theme?.dark === undefined) return;
  const system = win.matchMedia('(prefers-color-scheme: dark)');
  let applied: string[] = [];
  const update = () => {
    const chosen = root.dataset.theme;
    const mode = chosen === 'light' || chosen === 'dark' ? chosen : system.matches ? 'dark' : 'light';
    for (const name of applied) root.style.removeProperty(name);
    const map = theme[mode] ?? {};
    applied = Object.keys(map);
    for (const [name, value] of Object.entries(map)) root.style.setProperty(name, value);
  };
  system.addEventListener('change', update);
  new win.MutationObserver(update).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  update();
}
