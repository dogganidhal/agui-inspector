// Test support for the L02 end-to-end spec; never part of the shipped app. It wires the real runtime to
// the real connection controls, the reply editors and L03's read-only conversation view over one
// session store, the way the assembly will, and exposes the runtime and store on window so the spec can
// read exactly what was recorded.
//
// Query string: mode=embedded|hosted, allow=<origins, comma separated> (the startup allowlist),
// agent=<support|plain|protobuf|failing>, agentBase=<origin the agents live on>, target=<endpoint typed by the user>.
import { useSyncExternalStore, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentConfig, A2uiAction, ClientProfileSettings, ConversationViewProps, InspectionSession, TransportPolicy } from '../../src/contracts';
import { defaultProfile } from '../../src/core/profiles/index';
import { createRuntime, type Runtime, type RuntimeSettings } from '../../src/core/runtime/index';
import { createSessionStore } from '../../src/core/store/index';
import { Composer, RepliesView, TargetControls } from '../../src/views/connection/index';
import { ConversationView } from '../../src/views/conversation/index';
import { Button, ToastRegion, useToasts } from '../../src/views/theme/index';
import '../../src/views/conversation/conversation.css';
import '../../src/views/connection/connection.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'hosted' ? 'hosted' : 'embedded';
const policy: TransportPolicy = {
  mode,
  pageOrigin: location.origin,
  allowedOrigins: (params.get('allow') ?? '').split(',').filter(Boolean),
};
const base = params.get('agentBase') ?? '';

const agents: Record<string, AgentConfig> = {
  support: {
    id: 'support',
    name: 'Support assistant',
    url: `${base}/agent`,
    preset: {
      variables: { user: { default: 'u-{{uuid}}' } },
      forwardedProps: { tenant: 'acme', user: '{{user}}' },
      prepare: [
        { method: 'PUT', path: '/prepare/sessions/{{threadId}}', body: { user: '{{user}}' } },
        { method: 'POST', path: '/prepare/warm', body: { run: '{{runId}}' } },
      ],
      quickMessages: ['/help', 'interrupt', 'tools'],
    },
  },
  plain: { id: 'plain', name: 'Plain agent', url: `${base}/agent` },
  // An agent whose preset says that its server speaks protobuf (spec 013).
  protobuf: { id: 'protobuf', name: 'Protobuf agent', url: `${base}/agent`, preset: { encoding: 'protobuf', quickMessages: ['interrupt', 'tools'] } },
};

let settings: RuntimeSettings = { profile: defaultProfile(), variables: {} };
const store = createSessionStore();
const runtime: Runtime = createRuntime({ store, policy, settings: () => settings });

const boot = params.get('agent');
if (boot !== null && agents[boot]) runtime.selectAgent(agents[boot]);
else if (params.get('target')) runtime.setTarget(params.get('target') as string);

/** A valid A2UI v0.9 user-action envelope, as the renderer's callback would hand it over. */
export const TEST_ACTION: A2uiAction = {
  name: 'approve_refund',
  surfaceId: 'surface-refund',
  sourceComponentId: 'btn-approve',
  context: { orderId: 'o-1042', amount: 25, nested: { ok: true } },
  timestamp: '2026-10-02T09:30:00.250Z',
};

declare global {
  interface Window {
    __harness: {
      runtime: Runtime;
      session(): InspectionSession;
      setProfile(patch: Partial<ClientProfileSettings>): void;
      action: A2uiAction;
    };
  }
}

window.__harness = {
  runtime,
  session: () => store.snapshot(),
  setProfile(patch) {
    settings = { ...settings, profile: { ...settings.profile, ...patch } };
  },
  action: TEST_ACTION,
};

function Page(): ReactElement {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);
  const { toasts, toast } = useToasts();
  const replies: ConversationViewProps = {
    store,
    threadId: state.threadId,
    interrupts: state.interrupts,
    toolResults: state.toolResults,
    onDraftInterrupt: (id, draft) => runtime.draftInterrupt(id, draft),
    onAnswerInterrupt: (id, status) => void runtime.answerInterrupt(id, status),
    onDraftToolResult: (id, text) => runtime.draftToolResult(id, text),
    onSubmitToolResult: (id) => void runtime.submitToolResult(id),
    onContinue: () => void runtime.continueRun(),
  };
  const cleared = (wasCleared: boolean) => wasCleared && toast('Token cleared because the target changed.');

  return (
    <main style={{ background: 'var(--bg)', color: 'var(--fg)', minHeight: '100vh', display: 'grid', gap: 16, padding: 16, alignContent: 'start' }}>
      <TargetControls
        connection={state.connection}
        mode={mode}
        onChangeTarget={(url) => cleared(runtime.setTarget(url))}
        onChangeAuth={(auth) => runtime.setAuth(auth)}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Agents">
        {Object.values(agents).map((agent) => (
          <Button key={agent.id} small aria-pressed={state.connection.agentId === agent.id} onClick={() => cleared(runtime.selectAgent(agent))}>
            Use {agent.name}
          </Button>
        ))}
      </div>
      <ConversationView {...replies} />
      <RepliesView {...replies} running={state.running} />
      <section aria-label="Scripted surface" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <small>Stands in for an A2UI surface: its button hands the runtime a valid v0.9 action.</small>
        <Button small onClick={() => void runtime.sendA2uiAction(TEST_ACTION)} disabled={state.running}>
          Send test action
        </Button>
      </section>
      <Composer
        running={state.running}
        quickMessages={state.quickMessages}
        {...(state.error !== undefined && { error: state.error })}
        {...(state.notice !== undefined && { notice: state.notice })}
        onSend={(text) => void runtime.send(text)}
        onStop={() => runtime.stop()}
        onNewThread={() => runtime.newThread()}
      />
      <ToastRegion toasts={toasts} />
    </main>
  );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<Page />);
