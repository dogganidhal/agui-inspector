import type { ReactElement } from 'react';
import { Catalog } from '@a2ui/web_core/v0_9';
import { basicCatalog, createComponentImplementation, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import { deniedOpenUrl, type BlockedResource, type ReportBlocked } from '../../core/a2ui/actions';

const MEDIA = new Set<string>(['Image', 'Video', 'AudioPlayer']);

/** Stands in for a component that would load its `url`: it names the address as plain text and loads nothing. */
function blocked(original: ReactComponentImplementation): ReactComponentImplementation {
  const kind = original.name as BlockedResource['kind'];
  return createComponentImplementation(original, ({ props }): ReactElement => (
    <span className="agui-a2ui-blocked" role="note" data-blocked={kind}>
      Blocked {kind}: {String((props as { url?: unknown }).url ?? '')}
    </span>
  ));
}

/**
 * The official v0.9 basic catalog, bundled with the page, minus what would reach outside it: media
 * components do not load their address and `openUrl` does not open one. The id stays the official
 * one, so operations written for the basic catalog apply unchanged; any other catalog id is an error.
 */
export function createBundledCatalog(report: ReportBlocked): Catalog<ReactComponentImplementation> {
  return new Catalog(
    basicCatalog.id,
    basicCatalog.protocolVersion,
    [...basicCatalog.components.values()].map((component) => (MEDIA.has(component.name) ? blocked(component) : component)),
    [...basicCatalog.functions.values()].map((fn) => (fn.name === 'openUrl' ? deniedOpenUrl(report) : fn)),
    basicCatalog.themeSchema,
  );
}
