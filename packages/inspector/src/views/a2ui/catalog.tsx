import type { ReactElement } from 'react';
import { Catalog } from '@a2ui/web_core';
import { createComponentImplementation, type ReactCatalogComponent } from '@a2ui/react';
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog';
import { basicCatalog as basicCatalogV10 } from '@a2ui/web_core/catalogs/basic/v1';
import { deniedOpenUrl, type ReportBlocked } from '../../core/a2ui/actions';
import { catalogIds } from '../../core/a2ui/catalogs';
import type { AliasIds } from '../../core/a2ui/index';
import { COMPONENTS, unknownComponent } from './components';
import { BlockedView, type BlockedKind } from './parts';

const MEDIA = new Set<string>(['Image', 'Video', 'AudioPlayer']);

type Bundled = Catalog<ReactCatalogComponent>;

/** Stands in for a component that would load its `url`: see `BlockedView`. */
function blocked(original: ReactCatalogComponent): ReactCatalogComponent {
  const kind = original.name as BlockedKind;
  return createComponentImplementation(original, ({ props }): ReactElement => <BlockedView kind={kind} url={String((props as { url?: unknown }).url ?? '')} />);
}

/**
 * Answers for any component type: a listed one as itself, an unlisted one with a stand-in that shows the
 * error in place (the renderer would draw nothing). Only a lookup of an unlisted name answers, so the
 * components the catalog lists, and the schema it advertises, are unchanged.
 */
class Components extends Map<string, ReactCatalogComponent> {
  private readonly standIns = new Map<string, ReactCatalogComponent>();

  override get(type: string): ReactCatalogComponent {
    const listed = super.get(type);
    if (listed) return listed;
    let standIn = this.standIns.get(type);
    if (!standIn) this.standIns.set(type, (standIn = unknownComponent(type)));
    return standIn;
  }
}

const withStandIns = (catalog: Bundled): Bundled => Object.defineProperty(catalog, 'components', { value: new Components(catalog.components) });

/** The same catalog under another id. Components and functions are shared, so the guards hold under every id. */
const under = (id: string, bundled: Bundled): Bundled =>
  withStandIns(new Catalog(id, bundled.protocolVersion, [...bundled.components.values()], [...bundled.functions.values()], bundled.themeSchema));

/** A basic catalog minus what would reach outside the page: media components load nothing and `openUrl` opens nothing. */
function guarded(source: typeof basicCatalog | typeof basicCatalogV10, report: ReportBlocked, own: Readonly<Record<string, ReactCatalogComponent>>): Bundled {
  return withStandIns(
    new Catalog<ReactCatalogComponent>(
      source.id,
      source.protocolVersion,
      [...source.components.values()].map((component) => (MEDIA.has(component.name) ? blocked(component) : (own[component.name] ?? component))),
      [...source.functions.values()].map((fn) => (fn.name === 'openUrl' ? deniedOpenUrl(report, fn) : fn)),
      source.themeSchema,
    ),
  );
}

/**
 * The official v0.9 basic catalog, bundled with the page, minus what would reach outside it: media
 * components do not load their address and `openUrl` does not open one. A few components draw with the
 * inspector's own markup (see components.tsx) because the renderer's were unstyled or unlabelled.
 * The id stays the official one, so operations written for the basic catalog apply unchanged; any other
 * catalog id is an error.
 */
export const createBundledCatalog = (report: ReportBlocked): Bundled => guarded(basicCatalog, report, COMPONENTS);

/** The official 1.0 basic catalog, guarded the same way. Every component except the media ones is the renderer's own. */
export const createBundledCatalogV10 = (report: ReportBlocked): Bundled => guarded(basicCatalogV10, report, {});

/** The ids besides the basic ones that stand for them with no config: the built-in alias, which is middleware 0.0.11's default id. */
const BUILT_IN_IDS: AliasIds = { 'v0.9': catalogIds('v0.9').filter((id) => id !== basicCatalog.id), '1.0': catalogIds('1.0').filter((id) => id !== basicCatalogV10.id) };

/**
 * What a session resolves `createSurface` against: each bundled catalog, then the same catalog under every
 * alias id of its version (the built-in one and the config's). Nothing is fetched and the operations are not
 * rewritten; any other id is an error.
 */
export function createBundledCatalogs(report: ReportBlocked, aliasIds: AliasIds = BUILT_IN_IDS): Bundled[] {
  const v09 = createBundledCatalog(report);
  const v10 = createBundledCatalogV10(report);
  return [v09, ...aliasIds['v0.9'].map((id) => under(id, v09)), v10, ...aliasIds['1.0'].map((id) => under(id, v10))];
}
