// A2UI v0.9 surfaces over the official renderer core (FR-020, FR-030). A session turns an activity's
// `a2ui_operations` into surface models and keeps them up to date as the list changes. Framework-free:
// the catalog, and so the components, are supplied by the view. Only v0.9 is accepted; the received
// list is never altered and every operation that cannot be applied is reported with its position.
import {
  MessageProcessor,
  type Catalog,
  type ComponentApi,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import type { A2uiAction, JsonValue, Unsubscribe } from '../../contracts';
import { blockedMessage, toA2uiAction, type ReportBlocked } from './actions';

/** The activity type that carries A2UI operations. Every other type stays JSON. */
export const A2UI_ACTIVITY_TYPE = 'a2ui-surface';

const SUPPORTED_VERSION = 'v0.9';

export interface SurfaceIssue {
  /** `operation`: the list or one entry could not be applied. `surface`: the renderer reported an error. `blocked`: a surface asked for something outside the page. */
  readonly source: 'operation' | 'surface' | 'blocked';
  readonly message: string;
  /** Position in the operation list. */
  readonly index?: number;
  readonly surfaceId?: string;
  /** The offending entry as received. */
  readonly operation?: JsonValue;
}

export interface SurfaceSnapshot<T extends ComponentApi> {
  readonly surfaces: readonly SurfaceModel<T>[];
  readonly issues: readonly SurfaceIssue[];
}

export interface SurfaceSession<T extends ComponentApi> {
  /** Idempotent: an unchanged list does nothing, an extended list applies only its new tail, any other change rebuilds. */
  apply(operations: JsonValue): void;
  /** The same object until something changes. */
  snapshot(): SurfaceSnapshot<T>;
  subscribe(listener: () => void): Unsubscribe;
}

export interface SurfaceSessionOptions<T extends ComponentApi> {
  /** Builds the catalog (or the same catalog under several ids) surfaces resolve against; `report` hears about every refused resource. */
  catalog(report: ReportBlocked): Catalog<T> | readonly Catalog<T>[];
  /** Called only for an action a user triggered on a surface. */
  onAction(action: A2uiAction): void;
}

const isObject = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Why an entry cannot be handed to the renderer, or undefined when it can. */
function rejection(operation: JsonValue): string | undefined {
  if (!isObject(operation)) return 'This operation is not an object.';
  const { version } = operation;
  if (version === undefined) return `This operation has no version. Only A2UI ${SUPPORTED_VERSION} is supported.`;
  if (version !== SUPPORTED_VERSION) return `This operation is A2UI ${String(version)}. Only A2UI ${SUPPORTED_VERSION} is supported.`;
  return undefined;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createSurfaceSession<T extends ComponentApi>(options: SurfaceSessionOptions<T>): SurfaceSession<T> {
  const listeners = new Set<() => void>();
  let processor: MessageProcessor<T> | undefined;
  /** The list processed so far, as text so equality is by value. */
  let applied: string[] = [];
  let issues: SurfaceIssue[] = [];
  let current: SurfaceSnapshot<T> = { surfaces: [], issues: [] };
  let batching = false;

  const publish = () => {
    if (batching) return;
    current = { surfaces: processor ? [...processor.getSurfaces().values()] : [], issues: [...issues] };
    for (const listener of [...listeners]) listener();
  };

  const note = (issue: SurfaceIssue) => {
    issues.push(issue);
    publish();
  };

  const catalog = options.catalog((blocked) => note({ source: 'blocked', message: blockedMessage(blocked) }));

  const release = () => {
    processor?.model.dispose();
    processor?.dispose();
    processor = undefined;
  };

  const start = (): MessageProcessor<T> => {
    const next = new MessageProcessor<T>([catalog].flat(), (payload) => options.onAction(toA2uiAction(payload)));
    next.onSurfaceCreated((surface) => {
      surface.onError.subscribe((error) => note({ source: 'surface', message: error.message, surfaceId: surface.id }));
    });
    processor = next;
    return next;
  };

  const run = (operations: readonly JsonValue[], offset: number) => {
    const target = processor ?? start();
    operations.forEach((operation, at) => {
      const index = offset + at;
      const refused = rejection(operation);
      if (refused !== undefined) {
        issues.push({ source: 'operation', message: refused, index, operation });
        return;
      }
      try {
        target.processMessages([operation as never]);
      } catch (error) {
        issues.push({ source: 'operation', message: reason(error), index, operation });
      }
    });
  };

  return {
    apply(operations) {
      if (!Array.isArray(operations)) {
        release();
        applied = [];
        issues = [{ source: 'operation', message: 'The operations are not a list.', operation: operations }];
        return publish();
      }
      const keys = operations.map((operation) => JSON.stringify(operation));
      const appended = keys.length >= applied.length && applied.every((key, at) => key === keys[at]);
      if (appended && keys.length === applied.length && processor !== undefined) return;
      if (keys.length === 0 && applied.length === 0 && issues.length === 0) return;

      batching = true;
      try {
        if (!appended || processor === undefined) {
          release();
          issues = [];
          run(operations, 0);
        } else {
          run(operations.slice(applied.length), applied.length);
        }
        applied = keys;
      } finally {
        batching = false;
      }
      publish();
    },
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
