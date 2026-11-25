// What a surface may and may not do on its own (FR-025, FR-037): an action leaves as the five fields
// the contract names, and nothing a surface asks for reaches outside the page.
import { createFunctionImplementation, type ActionPayload, type FunctionApi, type FunctionImplementation } from '@a2ui/web_core';
import { OpenUrlApi } from '@a2ui/web_core/v0_9';
import type { ClientToServerMessage } from '@a2ui/web_core/types/client-event';
import type { A2uiAction, JsonObject, JsonValue } from '../../contracts.ts';

/** What was refused: a media component's source, or an `openUrl` call. */
export interface BlockedResource {
  readonly kind: 'Image' | 'Video' | 'AudioPlayer' | 'openUrl';
  readonly url: string;
}

export type ReportBlocked = (blocked: BlockedResource) => void;

/** An action as the envelope carries it, and the context entries that had no JSON value (see `jsonContext`). */
export interface BuiltAction {
  readonly action: A2uiAction;
  readonly dropped: readonly string[];
}

/**
 * A context as JSON writes it, and a copy, so the envelope is what the user sent when they clicked, whatever they type
 * afterwards. A binding to a path the data model lacks resolves to `undefined`, which JSON has no value for: an object
 * entry is left out and a list item becomes `null`, as `JSON.stringify` does. `dropped` names each one, `a.b` or
 * `list[2]`. `null` stays `null`. A `Map` (the v0.8 data model's objects) is written as an object.
 */
export function jsonContext(context: unknown): { readonly context: JsonObject; readonly dropped: readonly string[] } {
  const dropped: string[] = [];
  const write = (value: unknown, at: string): JsonValue | undefined => {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || typeof value !== 'object') return value as JsonValue;
    if (Array.isArray(value)) {
      return value.map((item, index) => {
        const written = write(item, `${at}[${index}]`);
        if (written === undefined) dropped.push(`${at}[${index}]`);
        return written ?? null;
      });
    }
    const entries = value instanceof Map ? [...value].map(([key, entry]) => [String(key), entry] as const) : Object.entries(value);
    const object: Record<string, JsonValue> = {};
    for (const [key, entry] of entries) {
      const path = at === '' ? key : `${at}.${key}`;
      const written = write(entry, path);
      // defineProperty keeps a key named __proto__ as data.
      if (written === undefined) dropped.push(path);
      else Object.defineProperty(object, key, { value: written, enumerable: true, writable: true, configurable: true });
    }
    return object;
  };
  const written = write(context ?? {}, '');
  return { context: written !== null && typeof written === 'object' && !Array.isArray(written) ? (written as JsonObject) : {}, dropped };
}

const built = (action: Omit<A2uiAction, 'context'>, context: unknown): BuiltAction => {
  const json = jsonContext(context);
  return {
    action: { name: action.name, surfaceId: action.surfaceId, sourceComponentId: action.sourceComponentId, context: json.context, timestamp: action.timestamp },
    dropped: json.dropped,
  };
};

/** The renderer's action (v0.9 and 1.0), trimmed to the envelope forwardedProps.a2uiAction.userAction carries. */
export const toA2uiAction = (payload: ActionPayload): BuiltAction => built(payload, payload.context);

/**
 * What the v0.8 renderer sends for a user's action: `{ userAction }` with the same five fields. Anything else it
 * could send (a client error, capabilities) is not an action and gives undefined.
 */
export function fromV08Action(message: ClientToServerMessage): BuiltAction | undefined {
  const action = message.userAction;
  return action === undefined ? undefined : built(action, action.context);
}

/** The note for an action sent without the context entries that had no value. */
export const droppedMessage = ({ name, sourceComponentId }: A2uiAction, dropped: readonly string[]): string =>
  `Action ${name} from ${sourceComponentId} was sent without ${dropped.join(', ')}: the context bound ${dropped.length === 1 ? 'it' : 'them'} to no value, and JSON has none to send.`;

export const blockedMessage = ({ kind, url }: BlockedResource): string =>
  kind === 'openUrl'
    ? `Blocked openUrl ${url}: the inspector never opens an address for a surface.`
    : `Blocked ${kind} ${url}: the inspector never loads a resource for a surface.`;

/** Replaces the official `openUrl` of a catalog (`api`, v0.9's by default), which would open a new browser tab. It only reports. */
export function deniedOpenUrl(report: ReportBlocked, api: FunctionApi = OpenUrlApi): FunctionImplementation {
  return createFunctionImplementation(api, (args) => {
    report({ kind: 'openUrl', url: String(args.url) });
  });
}
