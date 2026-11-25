// A2UI v0.9 and 1.0 surfaces of a headless session (feature 018, spec 020). The page's surface session over
// @a2ui/web_core's own basic catalogs, with no React and no DOM. Nothing renders, so media load nothing; openUrl is refused as in the page.
// An action is built the way the renderer's binder builds it (research.md, section 9): a function call runs through the
// data context, an event resolves its context against the data model and is dispatched.
import { Catalog, ComponentContext, type ComponentApi, type SurfaceModel } from '@a2ui/web_core';
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog';
import { basicCatalog as basicCatalogV10 } from '@a2ui/web_core/catalogs/basic/v1';
import type { A2uiAction, CatalogAliases, InspectionSession, JsonValue } from '../contracts.ts';
import { deniedOpenUrl, type ReportBlocked } from '../core/a2ui/actions.ts';
import { A2UI_ACTIVITY_TYPE, createSurfaceSession, type AliasIds, type SurfaceIssue, type SurfaceSession } from '../core/a2ui/index.ts';
import { projectConversation } from '../core/projection/index.ts';

export interface ComponentView {
  readonly id: string;
  readonly type: string;
  /** Properties as the stream set them; a `{ path }` binding reads from the data model. */
  readonly props: Readonly<Record<string, JsonValue>>;
}

export interface SurfaceView {
  /** The activity message that carries the surface. */
  readonly activityId: string;
  readonly surfaceId: string;
  readonly catalogId?: string;
  readonly components: readonly ComponentView[];
  readonly dataModel: JsonValue;
  readonly issues: readonly SurfaceIssue[];
}

export interface HeadlessSurfaces {
  views(): SurfaceView[];
  set(surfaceId: string, pointer: string, value: JsonValue): void;
  /** The action the component sent, or undefined when its action was a function call that sends nothing. */
  fire(surfaceId: string, componentId: string): Promise<A2uiAction | undefined>;
}

interface Activity {
  readonly session: SurfaceSession<ComponentApi>;
  operations: JsonValue;
  action?: A2uiAction;
}

function catalogs(report: ReportBlocked, aliasIds: AliasIds): Catalog<ComponentApi>[] {
  const under = (source: typeof basicCatalog | typeof basicCatalogV10, ids: readonly string[]) => {
    const components = [...source.components.values()];
    const functions = [...source.functions.values()].map((fn) => (fn.name === 'openUrl' ? deniedOpenUrl(report, fn) : fn));
    return [source.id, ...ids].map((id) => new Catalog<ComponentApi>(id, source.protocolVersion, components, functions, source.themeSchema));
  };
  return [...under(basicCatalog, aliasIds['v0.9']), ...under(basicCatalogV10, aliasIds['1.0'])];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const json = (value: unknown): JsonValue => (value === undefined ? null : (JSON.parse(JSON.stringify(value)) as JsonValue));

function catalogIdOf(operations: JsonValue, surfaceId: string): string | undefined {
  if (!Array.isArray(operations)) return undefined;
  for (const operation of operations) {
    const create = isRecord(operation) ? operation['createSurface'] : undefined;
    if (isRecord(create) && create['surfaceId'] === surfaceId && typeof create['catalogId'] === 'string') return create['catalogId'];
  }
  return undefined;
}

/** A binding (`{ path }` in v0.9, `{ "@path" }` in 1.0) reads from the data model; everything else stays as sent, so reading never runs a function. */
function propsOf(surface: SurfaceModel<ComponentApi>, id: string, properties: Record<string, unknown>): Record<string, JsonValue> {
  const context = new ComponentContext(surface, id);
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => {
      const binding = isRecord(value) && Object.keys(value).length === 1 && (typeof value['path'] === 'string' || typeof value['@path'] === 'string');
      return [key, json(binding ? context.dataContext.resolveDynamicValue(value) : value)];
    }),
  );
}

export function createHeadlessSurfaces(snapshot: () => InspectionSession, aliases?: CatalogAliases): HeadlessSurfaces {
  const activities = new Map<string, Activity>();

  /** Brings every A2UI activity's surface session up to date with the recording. Unchanged lists do nothing. */
  function sync(): void {
    for (const entry of projectConversation(snapshot()).entries) {
      if (entry.kind !== 'activity' || entry.activityType !== A2UI_ACTIVITY_TYPE || !isRecord(entry.content)) continue;
      const operations = (entry.content['a2ui_operations'] ?? null) as JsonValue;
      let activity = activities.get(entry.messageId);
      if (activity === undefined) {
        const record: { action?: A2uiAction } = {};
        const session = createSurfaceSession<ComponentApi>({ catalog: catalogs, onAction: (action) => void (record.action = action), ...(aliases !== undefined && { aliases }) });
        activity = Object.assign(record, { session, operations });
        activities.set(entry.messageId, activity);
      }
      activity.operations = operations;
      activity.session.apply(operations);
    }
  }

  /** The newest activity that holds the surface. */
  function find(surfaceId: string): { activity: Activity; surface: SurfaceModel<ComponentApi> } {
    sync();
    for (const activity of [...activities.values()].reverse()) {
      const surface = activity.session.snapshot().surfaces.find((candidate) => candidate.id === surfaceId);
      if (surface !== undefined) return { activity, surface };
    }
    throw new Error('No surface with that id');
  }

  return {
    views() {
      sync();
      return [...activities.entries()].flatMap(([activityId, activity]) => {
        const { surfaces, issues } = activity.session.snapshot();
        return surfaces.map((surface): SurfaceView => {
          const catalogId = catalogIdOf(activity.operations, surface.id);
          return {
            activityId,
            surfaceId: surface.id,
            ...(catalogId !== undefined && { catalogId }),
            components: [...surface.componentsModel.entries].map(([id, component]) => ({ id, type: component.type, props: propsOf(surface, id, component.properties) })),
            dataModel: json(surface.dataModel.get('/')),
            issues: issues.filter((issue) => issue.surfaceId === undefined || issue.surfaceId === surface.id).map((issue) => ({ ...issue })),
          };
        });
      });
    },
    set(surfaceId, pointer, value) {
      find(surfaceId).surface.dataModel.set(pointer, value);
    },
    async fire(surfaceId, componentId) {
      const { activity, surface } = find(surfaceId);
      const component = surface.componentsModel.get(componentId);
      if (component === undefined) throw new Error('No component with that id on the surface');
      const action: unknown = component.properties['action'];
      if (!isRecord(action)) throw new Error('The component has no action');
      const context = new ComponentContext(surface, componentId);
      const call = isRecord(action['functionCall']) ? action['functionCall'] : action;
      if (typeof call['call'] === 'string') {
        context.dataContext.resolveDynamicValue(call);
        return undefined;
      }
      activity.action = undefined;
      await context.dispatchAction(context.dataContext.resolveAction(action as never) as Record<string, unknown>);
      return activity.action;
    },
  };
}
