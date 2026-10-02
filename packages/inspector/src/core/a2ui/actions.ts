// What a surface may and may not do on its own (FR-025, FR-037): an action leaves as the five fields
// the contract names, and nothing a surface asks for reaches outside the page.
import { OpenUrlApi, createFunctionImplementation, type ActionPayload, type FunctionImplementation } from '@a2ui/web_core/v0_9';
import type { A2uiAction, JsonObject } from '../../contracts';

/** What was refused: a media component's source, or an `openUrl` call. */
export interface BlockedResource {
  readonly kind: 'Image' | 'Video' | 'AudioPlayer' | 'openUrl';
  readonly url: string;
}

export type ReportBlocked = (blocked: BlockedResource) => void;

/** The renderer's action, trimmed to the envelope forwardedProps.a2uiAction.userAction carries. */
export function toA2uiAction(payload: ActionPayload): A2uiAction {
  return {
    name: payload.name,
    surfaceId: payload.surfaceId,
    sourceComponentId: payload.sourceComponentId,
    context: payload.context as JsonObject,
    timestamp: payload.timestamp,
  };
}

export const blockedMessage = ({ kind, url }: BlockedResource): string =>
  kind === 'openUrl'
    ? `Blocked openUrl ${url}: the inspector never opens an address for a surface.`
    : `Blocked ${kind} ${url}: the inspector never loads a resource for a surface.`;

/** Replaces the official `openUrl`, which would open a new browser tab. It only reports. */
export function deniedOpenUrl(report: ReportBlocked): FunctionImplementation {
  return createFunctionImplementation(OpenUrlApi, (args) => {
    report({ kind: 'openUrl', url: String(args.url) });
  });
}
