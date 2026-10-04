// The A2UI catalogs the inspector bundles and the ids that stand for them (FR-011, FR-014, FR-015). One
// table holds the known catalogs and the built-in aliases, and a config's aliases are read against the same
// table, so the middleware's default id of 0.1.0 is one row rather than a special case. Nothing here
// fetches a catalog or rewrites an operation: an id only picks which bundled catalog a surface draws with.
// Framework-free, and it imports no package, so config parsing can use it. A test compares the literals
// with the renderer packages.
import type { CatalogAliases } from '../../contracts';

export type A2uiVersion = 'v0.8' | 'v0.9';

/** The v0.9 basic catalog, as the renderer names it. */
export const BASIC_V09 = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/** The v0.8 standard catalog, the default the v0.8 protocol names for a surface that names none. */
export const STANDARD_V08 = 'https://a2ui.org/specification/v0_8/standard_catalog_definition.json';

/** The catalogs the inspector bundles, and the A2UI version each one draws. */
export const KNOWN_CATALOGS: { readonly [id: string]: A2uiVersion } = { [BASIC_V09]: 'v0.9', [STANDARD_V08]: 'v0.8' };

/** Built in, and not configurable: the id the A2UI middleware (0.0.11) puts on its default catalog. */
export const BUILT_IN_ALIASES: CatalogAliases = { 'https://a2ui.org/specification/v0_9/basic_catalog.json': BASIC_V09 };

const has = (table: object, id: string): boolean => Object.hasOwn(table, id);

/** True for an id that is a known catalog or a built-in alias, which a config may not redefine. */
export const isBuiltIn = (id: string): boolean => has(KNOWN_CATALOGS, id) || has(BUILT_IN_ALIASES, id);

/** The known catalog an id stands for, or undefined. Matching is exact, and an alias never chains. */
function catalogOf(id: string, configured: CatalogAliases | undefined): string | undefined {
  if (has(KNOWN_CATALOGS, id)) return id;
  if (has(BUILT_IN_ALIASES, id)) return BUILT_IN_ALIASES[id];
  return configured !== undefined && has(configured, id) ? configured[id] : undefined;
}

/** True when `id` is the known catalog of `version`, a built-in alias of it or a configured one. */
export function resolves(version: A2uiVersion, id: string, configured?: CatalogAliases): boolean {
  const target = catalogOf(id, configured);
  return target !== undefined && KNOWN_CATALOGS[target] === version;
}

/** Every id that stands for the catalog of `version`: its own id first, then the built-in and configured aliases. */
export function catalogIds(version: A2uiVersion, configured?: CatalogAliases): readonly string[] {
  const own = Object.keys(KNOWN_CATALOGS).filter((id) => KNOWN_CATALOGS[id] === version);
  const aliases = [...Object.keys(BUILT_IN_ALIASES), ...(configured === undefined ? [] : Object.keys(configured))];
  return [...new Set([...own, ...aliases.filter((id) => resolves(version, id, configured))])];
}
