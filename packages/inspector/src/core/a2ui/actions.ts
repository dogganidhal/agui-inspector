// What a surface may and may not do on its own (FR-025, FR-037): an action leaves as the five fields
// the contract names, and nothing a surface asks for reaches outside the page.
import { OpenUrlApi, createFunctionImplementation, type ActionPayload, type FunctionImplementation } from '@a2ui/web_core/v0_9';
import type { ClientToServerMessage } from '@a2ui/web_core/types/client-event';
import type { A2uiAction, JsonObject } from '../../contracts';

/** What was refused: a media component's source, or an `openUrl` call. */
export interface BlockedResource {
  readonly kind: 'Image' | 'Video' | 'AudioPlayer' | 'openUrl';
  readonly url: string;
}

export type ReportBlocked = (blocked: BlockedResource) => void;

/**
 * The renderer's action, trimmed to the envelope forwardedProps.a2uiAction.userAction carries. A context
 * entry bound to an object path is the data model's own object, so the context is copied: the envelope
 * is what the user sent when they clicked, whatever they type afterwards.
 */
export function toA2uiAction(payload: ActionPayload): A2uiAction {
  return {
    name: payload.name,
    surfaceId: payload.surfaceId,
    sourceComponentId: payload.sourceComponentId,
    context: structuredClone(payload.context) as JsonObject,
    timestamp: payload.timestamp,
  };
}

/**
 * What the v0.8 renderer sends for a user's action: `{ userAction }` with the same five fields. Anything else it
 * could send (a client error, capabilities) is not an action and gives undefined. The v0.8 data model keeps
 * objects as `Map`s, so a context entry bound to an object path would reach the envelope as a `Map`, which
 * JSON writes as `{}`. The context is rebuilt as plain objects, which is also the copy the envelope needs.
 */
export function fromV08Action(message: ClientToServerMessage): A2uiAction | undefined {
  const action = message.userAction;
  if (action === undefined) return undefined;
  return {
    name: action.name,
    surfaceId: action.surfaceId,
    sourceComponentId: action.sourceComponentId,
    context: plain(action.context ?? {}) as JsonObject,
    timestamp: action.timestamp,
  };
}

/** A deep copy with every `Map` written as an object. */
function plain(value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, entry]) => [String(key), plain(entry)]));
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plain(entry)]));
  return value;
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
