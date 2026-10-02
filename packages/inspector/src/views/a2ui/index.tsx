import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { A2uiSurface } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import type { A2uiAction, A2uiViewProps, JsonValue } from '../../contracts';
import { A2UI_ACTIVITY_TYPE, createSurfaceSession, type SurfaceIssue, type SurfaceSession } from '../../core/a2ui/index';
import { CodeBlock, Finding } from '../theme/primitives';
import { createBundledCatalog } from './catalog';

export { A2UI_ACTIVITY_TYPE };

const isRecord = (value: JsonValue): value is { readonly [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value);

const pretty = (value: JsonValue): string => JSON.stringify(value, null, 2);

function Issues({ issues }: { issues: readonly SurfaceIssue[] }): ReactElement {
  return (
    <div role="alert" className="agui-a2ui-issues">
      {issues.map((issue, at) => (
        <div key={at}>
          <Finding
            variant={issue.source === 'blocked' ? 'warn' : 'err'}
            kind={issue.index === undefined ? 'A2UI' : `Operation ${issue.index + 1}`}
          >
            {issue.message}
          </Finding>
          {issue.operation !== undefined && (
            <details className="agui-a2ui-received">
              <summary>As received</summary>
              <CodeBlock text={pretty(issue.operation)} aria-label={`Received operation${issue.index === undefined ? '' : ` ${issue.index + 1}`}`} />
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

/** The labelled section every state shares; the heading is for assistive technology, the activity card has the visible one. */
function Shell({ activityId, status, children }: { activityId: string; status: string; children: ReactNode }): ReactElement {
  const headingId = `a2ui-heading-${activityId}`;
  return (
    <section aria-labelledby={headingId} data-view="a2ui" data-status={status} data-activity={activityId} className="agui-a2ui">
      <h2 id={headingId} className="agui-a2ui-heading">A2UI surface {activityId}</h2>
      {children}
    </section>
  );
}

function Rendered({ activityId, operations, onAction }: Pick<A2uiViewProps, 'activityId' | 'operations' | 'onAction'>): ReactElement {
  const latest = useRef(onAction);
  useLayoutEffect(() => {
    latest.current = onAction;
  });
  const [session] = useState<SurfaceSession<ReactComponentImplementation>>(() => {
    const created = createSurfaceSession<ReactComponentImplementation>({
      catalog: createBundledCatalog,
      onAction: (action: A2uiAction) => latest.current(action),
    });
    created.apply(operations);
    return created;
  });
  useLayoutEffect(() => session.apply(operations), [session, operations]);
  const { surfaces, issues } = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);

  return (
    <Shell activityId={activityId} status="rendered">
      {issues.length > 0 && <Issues issues={issues} />}
      {surfaces.map((surface) => (
        <div key={surface.id} className="agui-a2ui-surface" data-surface={surface.id}>
          <A2uiSurface surface={surface} />
        </div>
      ))}
      {surfaces.length === 0 && issues.length === 0 && <p role="status" className="agui-a2ui-note">No surface has been created yet.</p>}
    </Shell>
  );
}

/**
 * The content of an `a2ui-surface` activity: v0.9 operations drawn by the official renderer from the
 * bundled catalog, or, with rendering off, the operations as JSON. It reads nothing but its props and
 * calls `onAction` only when a user acts on a surface.
 */
export function A2uiView({ activityId, operations, renderEnabled, onAction }: A2uiViewProps): ReactElement {
  if (!renderEnabled) {
    return (
      <Shell activityId={activityId} status="json-only">
        <p role="status" className="agui-a2ui-note">Rendering is off. The operations are shown as received.</p>
        <CodeBlock text={pretty(operations)} aria-label={`Operations of ${activityId}`} />
      </Shell>
    );
  }
  if (operations === null) {
    return (
      <Shell activityId={activityId} status="empty">
        <p role="status" className="agui-a2ui-note">No A2UI operations yet.</p>
      </Shell>
    );
  }
  return <Rendered activityId={activityId} operations={operations} onAction={onAction} />;
}

/** What the conversation view needs of an activity entry; its `ActivityEntry` fits. */
export interface ActivityLike {
  readonly messageId: string;
  readonly activityType: string;
  readonly content: JsonValue;
}

/**
 * For the conversation view's `renderActivity` hook: the A2UI view for an `a2ui-surface` activity, and
 * undefined for every other type, which then stays JSON in its card.
 */
export function a2uiActivity(
  entry: ActivityLike,
  options: { readonly renderEnabled: boolean; onAction(action: A2uiAction): void },
): ReactNode | undefined {
  if (entry.activityType !== A2UI_ACTIVITY_TYPE) return undefined;
  const { content } = entry;
  const operations = isRecord(content) ? (content['a2ui_operations'] ?? null) : null;
  return <A2uiView key={entry.messageId} activityId={entry.messageId} operations={operations} renderEnabled={options.renderEnabled} onAction={options.onAction} />;
}
