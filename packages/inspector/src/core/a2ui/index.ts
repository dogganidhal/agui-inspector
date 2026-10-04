// A2UI surfaces over the official renderer core (FR-020, FR-030). A session is the one place that reads an
// activity's `a2ui_operations`: it finds the version of each entry, turns v0.9 entries into surface models,
// checks v0.8 entries and keeps them in order for the v0.8 renderer, and keeps all of it up to date as the
// list changes. The v0.8 renderer owns its message processor, so the session cannot apply v0.8 messages
// itself: it validates them and hands the accepted ones on in `v08`. Framework-free: the catalog, and so
// the v0.9 components, are supplied by the view. The received list is never altered and every entry that
// cannot be applied is reported with its position.
import {
  MessageProcessor,
  type Catalog,
  type ComponentApi,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import { A2uiMessageSchema } from '@a2ui/web_core/v0_8';
import type { A2uiAction, CatalogAliases, JsonValue, Unsubscribe } from '../../contracts';
import { blockedMessage, toA2uiAction, type ReportBlocked } from './actions';
import { BASIC_V09, STANDARD_V08, catalogIds, resolves } from './catalogs';
import { classify, surfaceKey, type Entry } from './operations';

/** The activity type that carries A2UI operations. Every other type stays JSON. */
export const A2UI_ACTIVITY_TYPE = 'a2ui-surface';

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

/** The v0.8 messages that passed validation and the catalog check, in order, for the v0.8 renderer to apply. */
export interface V08Feed {
  /** Grows on every rebuild. The renderer's surfaces are cleared and the messages replayed when it changes. */
  readonly epoch: number;
  /** Each message as received, with its position in the list. The renderer is given copies. */
  readonly messages: readonly { readonly index: number; readonly message: JsonValue }[];
}

export interface SurfaceSnapshot<T extends ComponentApi> {
  /** The v0.9 surfaces. The v0.8 ones live in the v0.8 renderer, fed by `v08`. */
  readonly surfaces: readonly SurfaceModel<T>[];
  readonly issues: readonly SurfaceIssue[];
  readonly v08: V08Feed;
  /** `<version>:<surface id>` of every surface the list names, first named first. */
  readonly order: readonly string[];
}

export interface SurfaceSession<T extends ComponentApi> {
  /** Idempotent: an unchanged list does nothing, an extended list applies only its new tail, any other change rebuilds. */
  apply(operations: JsonValue): void;
  /** The same object until something changes. */
  snapshot(): SurfaceSnapshot<T>;
  subscribe(listener: () => void): Unsubscribe;
  /** The v0.8 renderer refused a message the session accepted. Adds an issue at that message's position. */
  refused(index: number, operation: JsonValue, error: unknown): void;
}

export interface SurfaceSessionOptions<T extends ComponentApi> {
  /**
   * Builds the catalog (or the same catalog under several ids) v0.9 surfaces resolve against; `report` hears about
   * every refused resource. `aliasIds` are the ids besides the catalog's own that stand for it: the built-in
   * alias and the config's.
   */
  catalog(report: ReportBlocked, aliasIds: readonly string[]): Catalog<T> | readonly Catalog<T>[];
  /** Called only for an action a user triggered on a surface. */
  onAction(action: A2uiAction): void;
  /** The config's catalog aliases. */
  aliases?: CatalogAliases;
}

/**
 * Why a v0.8 message cannot be applied, or undefined when it can. The processor ignores `catalogId`, so the
 * catalog check is the inspector's: no id means the v0.8 standard catalog, as the protocol says.
 */
function v08Problem(operation: JsonValue, aliases: CatalogAliases | undefined): string | undefined {
  const parsed = A2uiMessageSchema.safeParse(operation);
  if (!parsed.success) {
    return parsed.error.issues
      .slice(0, 3)
      .map(({ path, message }) => (path.length > 0 ? `${path.join('.')}: ${message}` : message))
      .join('; ');
  }
  const id = parsed.data.beginRendering?.catalogId ?? STANDARD_V08;
  return parsed.data.beginRendering !== undefined && !resolves('v0.8', id, aliases) ? `Catalog not found: ${id}` : undefined;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createSurfaceSession<T extends ComponentApi>(options: SurfaceSessionOptions<T>): SurfaceSession<T> {
  const { aliases } = options;
  const listeners = new Set<() => void>();
  let processor: MessageProcessor<T> | undefined;
  /** The list processed so far, as text so equality is by value. */
  let applied: string[] = [];
  /** True once a list has been applied since the last release, so an unchanged list can do nothing. */
  let ready = false;
  let issues: SurfaceIssue[] = [];
  let order: string[] = [];
  let epoch = 0;
  let accepted: { index: number; message: JsonValue }[] = [];
  let current: SurfaceSnapshot<T> = { surfaces: [], issues: [], v08: { epoch, messages: [] }, order: [] };
  let batching = false;

  const publish = () => {
    if (batching) return;
    current = {
      surfaces: processor ? [...processor.getSurfaces().values()] : [],
      issues: [...issues],
      v08: { epoch, messages: [...accepted] },
      order: [...order],
    };
    for (const listener of [...listeners]) listener();
  };

  const note = (issue: SurfaceIssue) => {
    issues.push(issue);
    publish();
  };

  const catalog = options.catalog(
    (blocked) => note({ source: 'blocked', message: blockedMessage(blocked) }),
    catalogIds('v0.9', aliases).filter((id) => id !== BASIC_V09),
  );

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

  const apply = ({ index, version, operation }: Entry) => {
    if (version === 'v0.8') {
      const problem = v08Problem(operation, aliases);
      if (problem === undefined) accepted.push({ index, message: operation });
      else issues.push({ source: 'operation', message: problem, index, operation });
      return;
    }
    try {
      // The renderer keeps what it is given: the data model root is the `value` of an updateDataModel, so
      // a typed character would otherwise rewrite the recorded operation. Each entry is copied once, as it
      // is applied; an appended tail copies only itself.
      (processor ?? start()).processMessages([structuredClone(operation) as never]);
    } catch (error) {
      issues.push({ source: 'operation', message: reason(error), index, operation });
    }
  };

  const run = (operations: readonly JsonValue[], offset: number) => {
    const { entries, refused } = classify(operations, offset);
    const refusals = new Map(refused.map((issue) => [issue.index, issue]));
    let next = 0;
    for (let index = offset; index < offset + operations.length; index++) {
      const refusal = refusals.get(index);
      if (refusal !== undefined) {
        issues.push(refusal);
        continue;
      }
      const entry = entries[next++]!;
      const key = surfaceKey(entry);
      if (key !== undefined && !order.includes(key)) order.push(key);
      apply(entry);
    }
  };

  return {
    apply(operations) {
      if (!Array.isArray(operations)) {
        release();
        applied = [];
        ready = false;
        epoch++;
        order = [];
        accepted = [];
        issues = [{ source: 'operation', message: 'The operations are not a list.', operation: operations }];
        return publish();
      }
      const keys = operations.map((operation) => JSON.stringify(operation));
      const appended = keys.length >= applied.length && applied.every((key, at) => key === keys[at]);
      if (appended && keys.length === applied.length && ready) return;
      if (keys.length === 0 && applied.length === 0 && issues.length === 0) return;

      batching = true;
      try {
        if (!appended || !ready) {
          release();
          issues = [];
          order = [];
          accepted = [];
          epoch++;
          run(operations, 0);
        } else {
          run(operations.slice(applied.length), applied.length);
        }
        applied = keys;
        ready = true;
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
    refused(index, operation, error) {
      note({ source: 'operation', message: reason(error), index, operation });
    },
  };
}
