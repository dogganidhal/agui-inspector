// The one static application (design.md: Layout, Footer; T049). It assembles the fixed view entries
// around a shared session store and the real runtime, and it owns nothing those lanes own:
//
//   startup.ts   reads hosting-config.json, adds the content security policy, builds the runtime
//   <Root>       holds the page's state and turns each view callback into one call on a core module
//   <App>        lays the views out; it takes plain props and knows nothing about the runtime
//
// Every request goes through the runtime's guarded transport. The token is typed into the
// connection controls, handed to `runtime.setAuth` and read again only by that transport: nothing
// here keeps it in React state, storage, the store, a profile or a file.
import { StrictMode, useCallback, useEffect, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root as ReactRoot } from 'react-dom/client';
import type { A2uiAction, AppProps, ClientProfileSettings, DeploymentMode, InspectionSession, SessionStore } from '../contracts';
import { loadCapabilities } from '../core/config/index';
import { exportProfile, importProfile, saveProfile, type StorageLike } from '../core/profiles/index';
import { publishChunkExpansions, type ActivityEntry } from '../core/projection/index';
import { guardedFetchText } from '../core/runtime/index';
import { parseSession, restoreSession, serializeSession, SESSION_FILE_NAME } from '../core/session-files/index';
import { a2uiActivity } from '../views/a2ui/index';
import { Composer, RepliesView, TargetControls } from '../views/connection/index';
import { ConversationView } from '../views/conversation/index';
import { StateView } from '../views/conversation/state';
import { InspectionView } from '../views/inspection/index';
import { SettingsView, type CapabilitiesState } from '../views/settings/index';
import { Button, Finding, Icon, SegmentedControl, ToastRegion, useToasts } from '../views/theme/index';
import '../views/a2ui/a2ui.css';
import '../views/connection/connection.css';
import '../views/conversation/conversation.css';
import '../views/settings/settings.css';
import './app.css';
import { startPage, type StartupEnvironment, type Started } from './startup';

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

/** What the layout needs beyond the frozen view props. */
export interface AppExtras {
  readonly mode?: DeploymentMode;
  /** The deployment's allowed target origins, named in the footer. */
  readonly allowedOrigins?: readonly string[];
  readonly capabilities?: CapabilitiesState;
  /** Why the composer is disabled while something is owed or an imported recording is open. */
  readonly notice?: string;
  /** An imported recording is open: inspection only, nothing can be sent. */
  readonly recording?: boolean;
  readonly renderActivity?: (entry: ActivityEntry) => ReactNode;
}

type Pane = 'conversation' | 'inspection';
type Tab = 'inspection' | 'state' | 'settings';

const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

function requestScope(mode: DeploymentMode | undefined, allowedOrigins: readonly string[]): string {
  return mode === 'hosted' && allowedOrigins.length > 0 ? `this origin and ${allowedOrigins.join(', ')}` : 'this origin';
}

/** The inspection pane's closing line: counts for the session on screen, then the privacy facts for this mode. */
function Footer({ store, mode, allowedOrigins, recording }: { store: SessionStore; mode?: DeploymentMode; allowedOrigins: readonly string[]; recording?: boolean }): ReactElement {
  const session: InspectionSession = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const frames = session.frames.reduce((count, frame) => count + (frame.classification === 'data' ? 1 : 0), 0);
  return (
    <footer className="agui-app-footer" data-view="footer">
      <Icon name="lock" size={13} />
      <span>
        {plural(session.exchanges.length, 'exchange')} · {plural(frames, 'frame')} · requests only to {requestScope(mode, allowedOrigins)} · no telemetry · headers never recorded
        {recording ? ' · imported recording, inspection only' : ''}
      </span>
    </footer>
  );
}

function ThemeSwitch(): ReactElement {
  const [dark, setDark] = useState(() => globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  return (
    <Button
      iconOnly
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => {
        document.documentElement.dataset.theme = dark ? 'light' : 'dark';
        setDark(!dark);
      }}
    >
      <Icon name={dark ? 'sun' : 'moon'} />
    </Button>
  );
}

/**
 * The app shell: a fixed top bar above two panes that scroll on their own, conversation left and
 * inspection right. Under 960 px one pane shows and a segmented control switches between them.
 */
export function App({ settings, connection, conversation, inspection, mode, allowedOrigins = [], capabilities, notice, recording, renderActivity }: AppProps & AppExtras): ReactElement {
  const [pane, setPane] = useState<Pane>('conversation');
  const [tab, setTab] = useState<Tab>('inspection');

  return (
    <div className="agui-app" data-pane={pane} {...(mode !== undefined && { 'data-mode': mode })}>
      <header className="agui-app-bar">
        <span className="agui-app-brand">
          <span className="agui-app-mark" aria-hidden="true">
            <Icon name="wire" size={16} />
          </span>
          <h1>agui-inspector</h1>
        </span>
        <div className="agui-app-target" role="group" aria-label="Connection target">
          <TargetControls connection={connection.connection} onChangeTarget={connection.onChangeTarget} onChangeAuth={connection.onChangeAuth} {...(mode !== undefined && { mode })} />
        </div>
        <ThemeSwitch />
      </header>

      <div className="agui-app-switch">
        <SegmentedControl
          label="Pane"
          value={pane}
          options={[
            { value: 'conversation', label: 'Conversation' },
            { value: 'inspection', label: 'Inspection' },
          ]}
          onChange={(value) => setPane(value as Pane)}
        />
      </div>

      <div className="agui-app-panes">
        <div className="agui-app-pane agui-app-conversation">
          <div className="agui-app-column">
            <div className="agui-app-transcript">
              <ConversationView {...conversation} {...(renderActivity !== undefined && { renderActivity })} />
              <RepliesView {...conversation} running={connection.running} />
            </div>
            <section className="agui-app-composer" aria-label="Composer" data-view="connection">
              <Composer
                running={connection.running}
                quickMessages={connection.quickMessages}
                onSend={connection.onSend}
                onStop={connection.onStop}
                onNewThread={connection.onNewThread}
                {...(connection.error !== undefined && { error: connection.error })}
                {...(notice !== undefined && { notice })}
              />
            </section>
          </div>
        </div>

        <div className="agui-app-pane agui-app-inspection">
          <div className="agui-app-tabs">
            <SegmentedControl
              label="Inspection pane"
              value={tab}
              options={[
                { value: 'inspection', label: 'Inspection' },
                { value: 'state', label: 'State' },
                { value: 'settings', label: 'Settings' },
              ]}
              onChange={(value) => setTab(value as Tab)}
            />
            {recording && (
              <Finding variant="warn">Imported recording: inspection only. Reload the page to send requests again.</Finding>
            )}
          </div>
          {/* The frames list keeps its filters and open rows while another tab shows; the state view
              recomputes from the store, so it is mounted only while it is the one on screen. */}
          <div className="agui-app-body" hidden={tab !== 'inspection'}>
            <InspectionView {...inspection} />
          </div>
          {tab === 'state' && (
            <div className="agui-app-body">
              <StateView store={conversation.store} />
            </div>
          )}
          <div className="agui-app-body" hidden={tab !== 'settings'}>
            <SettingsView {...settings} {...(capabilities !== undefined && { capabilities })} />
          </div>
          <Footer store={inspection.store} allowedOrigins={allowedOrigins} {...(mode !== undefined && { mode })} {...(recording !== undefined && { recording })} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------

const RECORDING_NOTICE = 'An imported recording is open for inspection. Reload the page to send requests again.';

/** Saves `text` as a file through a temporary link; the page makes no request for it. */
function download(text: string, name: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

const PROFILE_FILE_NAME = 'agui-inspector-profile.json';
// ponytail: one trailing timer, not one projection per animation frame; lower it if expansions must appear sooner.
const EXPANSION_DELAY_MS = 250;

function Root({ started, storage }: { started: Started; storage?: StorageLike }): ReactElement {
  const { runtime, store: live, settings, agents, policy } = started;
  const state = useSyncExternalStore(runtime.subscribe, runtime.getState);
  const [selectedId, setSelectedId] = useState(started.selectedAgentId);
  const [profile, setProfile] = useState(settings.profile);
  const [variables, setVariables] = useState(settings.variables);
  const [settingsError, setSettingsError] = useState(started.error);
  const [capabilities, setCapabilities] = useState<CapabilitiesState>();
  const [shown, setShown] = useState<SessionStore>(live);
  const [recording, setRecording] = useState(false);
  const [inspectionError, setInspectionError] = useState<string>();
  const { toasts, toast } = useToasts();
  const agent = agents.find((candidate) => candidate.id === selectedId);

  // Chunk expansions are derived from the live capture and added to the same store.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      timer = undefined;
      publishChunkExpansions(live);
    };
    const unsubscribe = live.subscribe(() => (timer ??= setTimeout(publish, EXPANSION_DELAY_MS)));
    return () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [live]);

  // A capabilities URL is read through the guarded transport like every other request.
  useEffect(() => {
    setCapabilities(undefined);
    if (agent === undefined || typeof agent.capabilities !== 'string') return;
    let current = true;
    setCapabilities({ status: 'loading' });
    void loadCapabilities(agent, guardedFetchText(runtime.transport)).then((result) => {
      if (current) setCapabilities(result.ok ? { status: 'ready', capabilities: result.value } : { status: 'error', message: result.error });
    });
    return () => {
      current = false;
    };
  }, [agent, runtime]);

  const targetChanged = (cleared: boolean) => cleared && toast('Token cleared: it applies to one target only');
  const resetVariables = () => {
    settings.variables = {};
    setVariables({});
  };
  /** Nothing is sent while a recording is open; the user is told why, once. */
  const sending = <A extends unknown[]>(action: (...args: A) => void) => (...args: A) => (recording ? toast(RECORDING_NOTICE) : action(...args));

  const changeProfile = useCallback(
    (next: ClientProfileSettings) => {
      settings.profile = next;
      setProfile(next);
      if (storage === undefined) return;
      const saved = saveProfile(storage, next);
      setSettingsError(saved.ok ? undefined : saved.error);
    },
    [settings, storage],
  );

  const onAction = sending((action: A2uiAction) => void runtime.sendA2uiAction(action));
  const props: AppProps & AppExtras = {
    mode: policy.mode,
    allowedOrigins: policy.allowedOrigins,
    recording,
    capabilities,
    renderActivity: (entry) => a2uiActivity(entry, { renderEnabled: profile.renderA2ui, onAction }),
    ...(recording ? { notice: RECORDING_NOTICE } : state.notice !== undefined && { notice: state.notice }),
    settings: {
      agents,
      ...(selectedId !== undefined && { selectedAgentId: selectedId }),
      profile,
      variables,
      ...(settingsError !== undefined && { error: settingsError }),
      onSelectAgent(id) {
        const next = agents.find((candidate) => candidate.id === id);
        if (next === undefined) return;
        resetVariables();
        setSelectedId(id);
        targetChanged(runtime.selectAgent(next));
      },
      onChangeProfile: changeProfile,
      onChangeVariable(name, value) {
        settings.variables = { ...settings.variables, [name]: value };
        setVariables(settings.variables);
      },
      onImportProfile(text) {
        const imported = importProfile(text);
        if (imported.ok) {
          changeProfile(imported.value);
          setSettingsError(undefined);
        } else setSettingsError(imported.error);
      },
      onExportProfile: () => download(exportProfile(profile), PROFILE_FILE_NAME),
    },
    connection: {
      connection: state.connection,
      running: state.running,
      quickMessages: state.quickMessages,
      ...(state.error !== undefined && { error: state.error }),
      onChangeTarget(url) {
        resetVariables();
        setSelectedId(undefined);
        targetChanged(runtime.setTarget(url));
      },
      onChangeAuth: runtime.setAuth,
      onSend: sending((text) => void runtime.send(text)),
      onStop: runtime.stop,
      onNewThread: runtime.newThread,
    },
    conversation: {
      store: shown,
      interrupts: state.interrupts,
      toolResults: state.toolResults,
      onDraftInterrupt: runtime.draftInterrupt,
      onAnswerInterrupt: sending((id, status) => void runtime.answerInterrupt(id, status)),
      onDraftToolResult: runtime.draftToolResult,
      onSubmitToolResult: sending((id) => void runtime.submitToolResult(id)),
      onContinue: sending(() => void runtime.continueRun()),
    },
    inspection: {
      store: shown,
      ...(inspectionError !== undefined && { error: inspectionError }),
      onSendRaw: sending((text) => {
        setInspectionError(undefined);
        void runtime.sendRaw(text).then(() => setInspectionError(runtime.getState().error));
      }),
      onExportSession: () => download(serializeSession(shown.snapshot()), SESSION_FILE_NAME),
      onImportSession(text) {
        const parsed = parseSession(text);
        if (!parsed.ok) return setInspectionError(`Import failed: ${parsed.error}`);
        setInspectionError(undefined);
        // A recording is only read: a new store, no request, and the live capture carries on unseen.
        setShown(restoreSession(parsed.session));
        setRecording(true);
      },
    },
  };
  return (
    <>
      <App {...props} />
      <ToastRegion toasts={toasts} />
    </>
  );
}

function StartupFailure({ message }: { message: string }): ReactElement {
  return (
    <main className="agui-app-failure">
      <h1>agui-inspector</h1>
      <div role="alert">
        <Finding variant="err">The inspector could not start. {message}</Finding>
      </div>
      <p>Nothing else was requested. Fix the file this page is served with, then reload.</p>
    </main>
  );
}

function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    // Blocked storage only means the profile is not remembered.
    return undefined;
  }
}

/** Starts the page and renders it. Returns once the first render is queued. */
export async function mountApp(container: Element, env: StartupEnvironment): Promise<ReactRoot> {
  const root = createRoot(container);
  const started = await startPage(env);
  root.render(
    <StrictMode>
      {started.ok ? <Root started={started} {...(env.storage !== undefined && { storage: env.storage })} /> : <StartupFailure message={started.error} />}
    </StrictMode>,
  );
  return root;
}

if (typeof document !== 'undefined') {
  const container = document.getElementById('root');
  if (container) {
    // The page's own fetch, bound: calling it as a method of another object is an illegal invocation.
    const storage = browserStorage();
    void mountApp(container, {
      document,
      origin: location.origin,
      baseUrl: document.baseURI,
      fetch: globalThis.fetch.bind(globalThis),
      ...(storage !== undefined && { storage }),
    });
  }
}
