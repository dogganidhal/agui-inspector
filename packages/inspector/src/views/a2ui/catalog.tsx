import type { ReactElement } from 'react';
import { Catalog } from '@a2ui/web_core/v0_9';
import { basicCatalog, createComponentImplementation, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import { deniedOpenUrl, type ReportBlocked } from '../../core/a2ui/actions';
import { catalogIds } from '../../core/a2ui/catalogs';
import { COMPONENTS, unknownComponent } from './components';
import { BlockedView, type BlockedKind } from './parts';

const MEDIA = new Set<string>(['Image', 'Video', 'AudioPlayer']);

/** Stands in for a component that would load its `url`: see `BlockedView`. */
function blocked(original: ReactComponentImplementation): ReactComponentImplementation {
  const kind = original.name as BlockedKind;
  return createComponentImplementation(original, ({ props }): ReactElement => <BlockedView kind={kind} url={String((props as { url?: unknown }).url ?? '')} />);
}

/**
 * Answers for any component type: a listed one as itself, an unlisted one with a stand-in that shows the
 * error in place (the renderer would draw a raw red line). Only a lookup of an unlisted name answers, so
 * the components the catalog lists, and the schema it advertises, are unchanged.
 */
class Components extends Map<string, ReactComponentImplementation> {
  private readonly standIns = new Map<string, ReactComponentImplementation>();

  override get(type: string): ReactComponentImplementation {
    const listed = super.get(type);
    if (listed) return listed;
    let standIn = this.standIns.get(type);
    if (!standIn) this.standIns.set(type, (standIn = unknownComponent(type)));
    return standIn;
  }
}

const withStandIns = (catalog: Catalog<ReactComponentImplementation>): Catalog<ReactComponentImplementation> =>
  Object.defineProperty(catalog, 'components', { value: new Components(catalog.components) });

/**
 * The official v0.9 basic catalog, bundled with the page, minus what would reach outside it: media
 * components do not load their address and `openUrl` does not open one. A few components draw with the
 * inspector's own markup (see components.tsx) because the renderer's would be unstyled or unlabelled.
 * The id stays the official one, so operations written for the basic catalog apply unchanged; any other
 * catalog id is an error.
 */
export function createBundledCatalog(report: ReportBlocked): Catalog<ReactComponentImplementation> {
  return withStandIns(
    new Catalog(
      basicCatalog.id,
      basicCatalog.protocolVersion,
      [...basicCatalog.components.values()].map((component) => (MEDIA.has(component.name) ? blocked(component) : (COMPONENTS[component.name] ?? component))),
      [...basicCatalog.functions.values()].map((fn) => (fn.name === 'openUrl' ? deniedOpenUrl(report) : fn)),
      basicCatalog.themeSchema,
    ),
  );
}

/** The ids besides the basic one that stand for it with no config: the built-in alias, which is middleware 0.0.11's default id. */
const BUILT_IN_IDS = catalogIds('v0.9').filter((id) => id !== basicCatalog.id);

/**
 * What a session resolves `createSurface` against: the bundled catalog, then the same catalog under every
 * alias id (the built-in one and the config's). Nothing is fetched and the operations are not rewritten; any
 * other id is an error.
 */
export function createBundledCatalogs(report: ReportBlocked, aliasIds: readonly string[] = BUILT_IN_IDS): Catalog<ReactComponentImplementation>[] {
  const bundled = createBundledCatalog(report);
  return [
    bundled,
    ...aliasIds.map((id) => withStandIns(new Catalog(id, bundled.protocolVersion, [...bundled.components.values()], [...bundled.functions.values()], bundled.themeSchema))),
  ];
}
