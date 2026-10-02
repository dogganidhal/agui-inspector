import { StrictMode, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AppProps, InspectionSession, SessionStore } from '../contracts';
import { ConnectionView } from '../views/connection/index';
import { ConversationView } from '../views/conversation/index';
import { InspectionView } from '../views/inspection/index';
import { SettingsView } from '../views/settings/index';

/** Scaffold only: the boot and assembly surface that a later slice replaces. */
export function App(props: AppProps): ReactElement {
  return (
    <main>
      <h1>agui-inspector</h1>
      <p role="status" data-status="scaffold">
        Scaffold only, not MVP acceptance: nothing here connects, records or inspects yet.
      </p>
      <SettingsView {...props.settings} />
      <ConnectionView {...props.connection} />
      <ConversationView {...props.conversation} />
      <InspectionView {...props.inspection} />
    </main>
  );
}

const unavailable = (): never => {
  throw new Error('Not implemented: this is the F01 scaffold');
};

const emptySession: InspectionSession = { id: 'scaffold', exchanges: [], runs: [], frames: [], findings: [], derived: [] };

const scaffoldStore: SessionStore = {
  appendExchange: unavailable,
  updateExchange: unavailable,
  appendFrame: unavailable,
  addFinding: unavailable,
  upsertRun: unavailable,
  appendDerived: unavailable,
  snapshot: () => emptySession,
  subscribe: () => () => {},
};

/** Inert data and callbacks that refuse to fake an outcome. */
export const scaffoldAppProps: AppProps = {
  settings: {
    agents: [],
    profile: { protocolVersion: '1.0', tools: [], context: [], renderA2ui: true, injectA2uiTool: false, forwardedProps: {} },
    variables: {},
    onSelectAgent: unavailable,
    onChangeProfile: unavailable,
    onChangeVariable: unavailable,
    onImportProfile: unavailable,
    onExportProfile: unavailable,
  },
  connection: {
    connection: {},
    running: false,
    quickMessages: [],
    onChangeTarget: unavailable,
    onChangeAuth: unavailable,
    onSend: unavailable,
    onStop: unavailable,
    onNewThread: unavailable,
  },
  conversation: {
    store: scaffoldStore,
    interrupts: [],
    toolResults: [],
    onDraftInterrupt: unavailable,
    onAnswerInterrupt: unavailable,
    onDraftToolResult: unavailable,
    onSubmitToolResult: unavailable,
    onContinue: unavailable,
  },
  inspection: {
    store: scaffoldStore,
    onSendRaw: unavailable,
    onExportSession: unavailable,
    onImportSession: unavailable,
  },
};

export function mountApp(container: Element, props: AppProps = scaffoldAppProps): Root {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App {...props} />
    </StrictMode>,
  );
  return root;
}

if (typeof document !== 'undefined') {
  const container = document.getElementById('root');
  if (container) mountApp(container);
}
