// L05 T042: the browser fixture host. It renders the real A2UI view with the real theme and A2UI
// stylesheets and exposes a small script API on window, so the Playwright spec can feed operations,
// switch rendering off, read the action envelopes the callback received and let a scripted
// continuation (not L02's runtime) answer them. Test support, never part of the shipped app.
import { useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { A2uiSurface, basicCatalog, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import type { A2uiAction, JsonValue } from '../../src/contracts';
import { A2uiView, a2uiActivity } from '../../src/views/a2ui/index';
import { continuation, type Operation } from '../../../../examples/reference-agent/a2ui-scenarios';
import '../../src/views/theme/index';
import '../../src/views/a2ui/a2ui.css';

interface State {
  operations: JsonValue;
  renderEnabled: boolean;
  /** When on, each action is answered by the scripted continuation. */
  continuing: boolean;
  control?: JsonValue;
  /** When set, the view is reached the way the conversation view reaches it: through the whole activity content. */
  activity?: JsonValue;
}

const state: State = { operations: null, renderEnabled: true, continuing: false };
const actions: A2uiAction[] = [];

declare global {
  interface Window {
    __a2ui: {
      set(operations: JsonValue): void;
      render(enabled: boolean): void;
      continueWith(on: boolean): void;
      actions(): A2uiAction[];
      /** The official renderer with its stock catalog, to show what the guard prevents. */
      control(operations: JsonValue): void;
      /** An `a2ui-surface` activity's whole content, so a lifecycle snapshot (`status`, no operations) can be shown. */
      activity(content: JsonValue): void;
    };
  }
}

/** The official renderer exactly as shipped: no guard. */
function Control({ operations }: { operations: JsonValue }): ReactElement {
  const [processor] = useState(() => {
    const created = new MessageProcessor<ReactComponentImplementation>([basicCatalog]);
    created.processMessages(operations as never);
    return created;
  });
  return (
    <div data-testid="control">
      {[...processor.getSurfaces().values()].map((surface) => (
        <A2uiSurface key={surface.id} surface={surface} />
      ))}
    </div>
  );
}

function onAction(action: A2uiAction): void {
  actions.push(action);
  if (state.continuing) {
    state.operations = continuation(state.operations as unknown as readonly Operation[], action) as unknown as JsonValue;
    draw();
  }
}

const container = document.getElementById('root')!;
const root = createRoot(container);

function draw(): void {
  root.render(
    <main style={{ background: 'var(--bg)', color: 'var(--fg)', minHeight: '100vh', padding: 16 }}>
      {state.activity === undefined ? (
        <A2uiView activityId="a2ui-surface-1" operations={state.operations} renderEnabled={state.renderEnabled} onAction={onAction} />
      ) : (
        a2uiActivity({ messageId: 'a2ui-surface-1', activityType: 'a2ui-surface', content: state.activity }, { renderEnabled: state.renderEnabled, onAction })
      )}
      {state.control !== undefined && <Control operations={state.control} />}
    </main>,
  );
}

window.__a2ui = {
  set(operations) {
    state.operations = operations;
    state.activity = undefined;
    draw();
  },
  render(enabled) {
    state.renderEnabled = enabled;
    draw();
  },
  continueWith(on) {
    state.continuing = on;
  },
  actions: () => [...actions],
  control(operations) {
    state.control = operations;
    draw();
  },
  activity(content) {
    state.activity = content;
    draw();
  },
};

draw();
