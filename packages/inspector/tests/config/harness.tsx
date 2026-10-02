// Test support for the L01 end-to-end spec; never part of the shipped app. It wires the real core
// modules (configuration, presets, profiles) and the real settings view to a scripted request seam:
// a stand-in for L02's runtime that prepares a dispatch, composes the run input, and sends the
// preparation requests and the run request to the scripted reference server, which records them.
//
// The token field is a stand-in for the connection view's. Like the real one it is in-memory state
// only; it travels as an Authorization header and is read by no code that stores or exports anything.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Message } from '@ag-ui/core';
import type { ClientProfileSettings, JsonValue } from '../../src/contracts';
import { loadCapabilities, loadConfig, type ParsedConfig } from '../../src/core/config/index';
import { preparePreset } from '../../src/core/presets/index';
import { composeRunInput, defaultProfile, exportProfile, importProfile, loadProfile, saveProfile } from '../../src/core/profiles/index';
import { Button, Field, Finding } from '../../src/views/theme/index';
import '../../src/views/settings/settings.css';
import { SettingsView, type CapabilitiesState } from '../../src/views/settings/index';

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
  return response.text();
}

function Harness(): ReactElement {
  const [config, setConfig] = useState<ParsedConfig>();
  const [selected, setSelected] = useState<string>();
  const [profile, setProfile] = useState<ClientProfileSettings>(defaultProfile);
  const [variables, setVariables] = useState<Record<string, JsonValue>>({});
  const [capabilities, setCapabilities] = useState<CapabilitiesState>();
  const [error, setError] = useState<string>();
  const [dispatchError, setDispatchError] = useState<string>();
  const [status, setStatus] = useState('Idle');
  const [token, setToken] = useState('');
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const runs = useRef(0);

  useEffect(() => {
    void (async () => {
      const loaded = await loadConfig('/config.json', fetchText);
      if (!loaded.ok) return setError(loaded.error);
      setConfig(loaded.value);
      setSelected(loaded.value.agents[0]?.id);
      const saved = loadProfile(localStorage);
      if (!saved.ok) setError(saved.error);
      else if (saved.value) setProfile(saved.value);
    })();
  }, []);

  const agent = config?.agents.find((candidate) => candidate.id === selected);

  useEffect(() => {
    setCapabilities(undefined);
    if (!agent || typeof agent.capabilities !== 'string') return;
    let current = true;
    setCapabilities({ status: 'loading' });
    void loadCapabilities(agent, fetchText).then((result) => {
      if (current) setCapabilities(result.ok ? { status: 'ready', capabilities: result.value } : { status: 'error', message: result.error });
    });
    return () => {
      current = false;
    };
  }, [agent]);

  const change = (next: ClientProfileSettings) => {
    setProfile(next);
    const saved = saveProfile(localStorage, next);
    setError(saved.ok ? undefined : saved.error);
  };

  async function seam(method: string, path: string, body: unknown): Promise<Response> {
    return fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }

  async function send(content: string) {
    if (!agent) return;
    setDispatchError(undefined);
    runs.current += 1;
    const ids = { threadId: 'thread-1', runId: `run-${runs.current}` };
    const user: Message = { id: `user-${runs.current}`, role: 'user', content };
    const transcript = [...messages, user];
    const prepared = preparePreset(agent.preset, variables, ids);
    if (!prepared.ok) return setDispatchError(prepared.error);
    const input = composeRunInput({ ids, prepared: prepared.value, profile, transcript, turnMessages: [user] });
    if (!input.ok) return setDispatchError(input.error);
    for (const step of prepared.value.preparations) {
      const response = await seam(step.method, step.path, step.body);
      if (!response.ok) return setDispatchError(`Preparation failed: ${step.method} ${step.path} answered ${response.status}`);
    }
    await seam('POST', agent.url, input.value);
    setMessages([...transcript, { id: `assistant-${runs.current}`, role: 'assistant', content: 'Hello from the reference agent.' }]);
    setStatus(`Sent ${ids.runId}`);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([exportProfile(profile)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agui-inspector-profile.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', background: 'var(--bg)', color: 'var(--fg)', minHeight: '100vh' }}>
      <SettingsView
        agents={config?.agents ?? []}
        selectedAgentId={selected}
        profile={profile}
        variables={variables}
        {...(error !== undefined && { error })}
        capabilities={capabilities}
        onSelectAgent={(id) => {
          setSelected(id);
          setVariables({});
        }}
        onChangeProfile={change}
        onChangeVariable={(name, value) => setVariables((current) => ({ ...current, [name]: value }))}
        onImportProfile={(fileText) => {
          const imported = importProfile(fileText);
          if (imported.ok) {
            change(imported.value);
            setError(undefined);
          } else setError(imported.error);
        }}
        onExportProfile={download}
      />
      <aside data-testid="dispatch" aria-label="Scripted request seam" style={{ display: 'grid', alignContent: 'start', gap: 12, padding: 16, borderTop: '1px solid var(--line)' }}>
        <h2>Scripted run</h2>
        <label>
          Test token
          <Field value={token} onChange={(event) => setToken(event.target.value)} />
        </label>
        <label>
          Message
          <Field value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <Button variant="primary" onClick={() => void send(text)}>
          Send message
        </Button>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {agent?.preset?.quickMessages?.map((message) => (
            <Button key={message} small onClick={() => void send(message)}>
              {message}
            </Button>
          ))}
        </div>
        <p role="status" data-testid="dispatch-status">
          {status}
        </p>
        {dispatchError && (
          <div role="alert" data-testid="dispatch-error">
            <Finding variant="err">{dispatchError}</Finding>
          </div>
        )}
      </aside>
    </main>
  );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<Harness />);
