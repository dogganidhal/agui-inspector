// Settings: the agent picker, the selected agent's declared capabilities and the client profile
// (design.md: Top bar, Agent, Client profile; FR-006, FR-029 to FR-032).
//
// The view owns no state that matters: agents, the profile and variable values come in as props and
// every change goes out through a callback, so what a control shows is what the next run will carry.
// A control that holds text the profile cannot accept yet (half-typed JSON, an empty protocol version)
// keeps that draft, says why it is not applied, and leaves the last valid value in use.
//
// Composes F06 primitives only. It never holds, asks for or shows a credential: the token field lives
// in the connection view, and nothing here reaches storage.
import { useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { AgentConfig, ClientProfileSettings, InterruptReply, JsonValue, SettingsViewProps } from '../../contracts';
import { describeCapabilities, type CapabilityGroupView, type LoadedCapabilities } from '../../core/config/index';
import { isJsonObject } from '../../core/config/validation';
import { parseProfileSettings, removeTool, setInterruptPayload, setToolResult } from '../../core/profiles/index';
import { Button, CodeBlock, Editor, Field, Finding, Icon, Label, Popover, SegmentedControl, Switch, Tag } from '../theme/primitives';

/** What the caller has learned about the selected agent's declared capabilities. */
export type CapabilitiesState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly capabilities: LoadedCapabilities };

/**
 * Extra, optional data beyond the frozen props. Inline capabilities are read from the selected agent
 * itself; only a capabilities url needs the caller to fetch it through the guarded transport.
 */
export interface SettingsViewExtras {
  readonly capabilities?: CapabilitiesState;
}

const pretty = (value: JsonValue): string => JSON.stringify(value, null, 2);
const problem = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ---------------------------------------------------------------------------------------------
// Drafts: text a control holds until the profile can accept it
// ---------------------------------------------------------------------------------------------

interface Draft {
  text: string;
  /** The external value this draft was last in step with; a different one resets the draft. */
  seen: string;
  error?: string;
}

function TextSetting({ label, value, commit, describedBy, rows }: { label: string; value: string; commit: (text: string) => string | undefined; describedBy?: string; rows?: number }): ReactElement {
  const errorId = useId();
  const [draft, setDraft] = useState<Draft>({ text: value, seen: value });
  let current = draft;
  if (draft.seen !== value) {
    current = { text: value, seen: value };
    setDraft(current);
  }
  const control = {
    'aria-label': label,
    'aria-describedby': current.error ? errorId : describedBy,
    invalid: current.error !== undefined,
    value: current.text,
    onChange: (event: { target: { value: string } }) => {
      const text = event.target.value;
      const error = commit(text);
      setDraft(error ? { text, seen: value, error } : { text, seen: text });
    },
  };
  return (
    <div className="agui-settings-ctl">
      {rows === undefined ? <Field {...control} /> : <Editor {...control} rows={rows} />}
      {current.error && (
        <div id={errorId} role="alert">
          <Finding variant="err">{current.error}</Finding>
        </div>
      )}
    </div>
  );
}

function JsonSetting({ label, value, commit, rows = 4 }: { label: string; value: JsonValue; commit: (value: JsonValue) => string | undefined; rows?: number }): ReactElement {
  const errorId = useId();
  const canonical = JSON.stringify(value);
  const [draft, setDraft] = useState<Draft>({ text: pretty(value), seen: canonical });
  let current = draft;
  if (draft.seen !== canonical) {
    current = { text: pretty(value), seen: canonical };
    setDraft(current);
  }
  return (
    <div className="agui-settings-ctl">
      <Editor
        aria-label={label}
        aria-describedby={current.error ? errorId : undefined}
        invalid={current.error !== undefined}
        rows={rows}
        value={current.text}
        onChange={(event) => {
          const text = event.target.value;
          let parsed: JsonValue;
          try {
            parsed = JSON.parse(text) as JsonValue;
          } catch (error) {
            setDraft({ text, seen: canonical, error: `Not valid JSON, so not applied: ${problem(error)}. The last valid value stays in use.` });
            return;
          }
          const error = commit(parsed);
          setDraft(error ? { text, seen: canonical, error } : { text, seen: JSON.stringify(parsed) });
        }}
      />
      {current.error && (
        <div id={errorId} role="alert">
          <Finding variant="err">{current.error}</Finding>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------------------------

const Group = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }): ReactElement => (
  <div className="agui-settings-group">
    <div className="agui-settings-head">
      <h3>{title}</h3>
      {action}
    </div>
    {children}
  </div>
);

const Row = ({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children?: ReactNode }): ReactElement => (
  <div className="agui-settings-row">
    <div className="agui-settings-row-t">
      {title}
      {hint && <small>{hint}</small>}
    </div>
    {children}
  </div>
);

// ---------------------------------------------------------------------------------------------
// Agent picker and declared capabilities
// ---------------------------------------------------------------------------------------------

/**
 * Lists the configured agents and reports the choice. The Settings view and the top bar each render
 * one over the same agents and callback, so a choice behaves the same wherever it is made. With
 * agents configured but none selected, the endpoint was typed by hand.
 */
export function AgentPicker({ agents, selectedId, onSelect, inBar }: { agents: readonly AgentConfig[]; selectedId?: string; onSelect: (id: string) => void; inBar?: boolean }): ReactElement {
  const id = useId();
  const selected = agents.find((agent) => agent.id === selectedId);
  return (
    <div className={inBar ? 'agui-settings-picker agui-settings-picker--bar' : 'agui-settings-picker'}>
      <Button popoverTarget={id} disabled={agents.length === 0}>
        <Icon name="branch" />
        {inBar && <span className="agui-settings-picker-label">Agent</span>}
        <span className="agui-settings-picker-name">{selected ? (selected.name ?? selected.id) : agents.length === 0 ? 'No agents loaded' : 'Custom URL'}</span>
        <Icon name="down" size={14} />
      </Button>
      <Popover id={id} aria-label="Agents">
        <Label>Agents</Label>
        <ul className="agui-settings-agents">
          {agents.map((agent) => (
            <li key={agent.id}>
              <Button
                variant="ghost"
                aria-pressed={agent.id === selected?.id}
                onClick={(event) => {
                  onSelect(agent.id);
                  event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
                }}
              >
                <span className="agui-settings-agent">
                  <span>{agent.name ?? agent.id}</span>
                  <small>{agent.url}</small>
                </span>
                {agent.id === selected?.id && <Icon name="check" size={14} />}
              </Button>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}

function formatValue(value: JsonValue): string {
  if (Array.isArray(value)) return value.length === 0 ? 'none' : value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(', ');
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

function CapabilityGroups({ groups }: { groups: readonly CapabilityGroupView[] }): ReactElement {
  return (
    <div className="agui-settings-grid">
      {groups.map(({ group, entries }) => (
        <div className="agui-settings-grid-row" key={group}>
          <div className="agui-settings-key">{group}</div>
          <div className="agui-settings-vals">
            {entries.length === 0 && <span className="agui-settings-muted">Not declared</span>}
            {entries.map(({ key, value }) =>
              value === true ? (
                <Tag key={key} variant="ok">
                  {key}
                  <span className="agui-settings-sr">: true</span>
                </Tag>
              ) : value === false ? (
                <span key={key} className="agui-settings-off">
                  <Tag>
                    {key}
                    <span className="agui-settings-sr">: false</span>
                  </Tag>
                </span>
              ) : (
                <Tag key={key} variant="line">{`${key}: ${formatValue(value)}`}</Tag>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentPanel({ agent, capabilities }: { agent: AgentConfig; capabilities?: CapabilitiesState }): ReactElement {
  const declared = agent.capabilities;
  let body: ReactNode;
  let source: ReactNode;

  if (declared === undefined) {
    source = 'This agent declares no capabilities in the configuration.';
    body = <CapabilityGroups groups={describeCapabilities({})} />;
  } else if (typeof declared !== 'string') {
    source = 'Declared capabilities, from the configuration. They are shown as declared; checking them against observed events comes in 1.0.';
    body = <CapabilityGroups groups={describeCapabilities(declared)} />;
  } else if (capabilities?.status === 'ready') {
    source = (
      <>
        Declared capabilities, read from <span className="agui-settings-mono">{declared}</span>. They are shown as declared; checking them against observed events comes in 1.0.
      </>
    );
    body = <CapabilityGroups groups={capabilities.capabilities.groups} />;
  } else if (capabilities?.status === 'error') {
    source = (
      <>
        Declared at <span className="agui-settings-mono">{declared}</span>.
      </>
    );
    body = (
      <div role="alert">
        <Finding variant="err">{capabilities.message}</Finding>
      </div>
    );
  } else {
    source = (
      <>
        Declared at <span className="agui-settings-mono">{declared}</span>.
      </>
    );
    body =
      capabilities?.status === 'loading' ? (
        <p role="status" className="agui-settings-muted">
          Loading declared capabilities…
        </p>
      ) : (
        <Finding variant="neutral">These capabilities have not been loaded.</Finding>
      );
  }

  return (
    <Group
      title={agent.name ?? agent.id}
      action={<Tag>{agent.id}</Tag>}
    >
      <p className="agui-settings-note">{source}</p>
      {body}
    </Group>
  );
}

// ---------------------------------------------------------------------------------------------
// Client profile
// ---------------------------------------------------------------------------------------------

type ModeChoice = 'preset' | 'full' | 'turn';

function AddTool({ profile, commit }: { profile: ClientProfileSettings; commit: (next: ClientProfileSettings) => string | undefined }): ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [schema, setSchema] = useState('{\n  "type": "object",\n  "properties": {}\n}');
  const [error, setError] = useState<string>();
  const ids = { name: useId(), description: useId(), schema: useId() };
  return (
    <form
      className="agui-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        let parameters: JsonValue;
        try {
          parameters = JSON.parse(schema) as JsonValue;
        } catch (cause) {
          return setError(`The JSON Schema is not valid JSON: ${problem(cause)}`);
        }
        if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) return setError('The JSON Schema must be a JSON object.');
        if (name.trim() === '') return setError('Give the tool a name.');
        const failed = commit({ ...profile, tools: [...profile.tools, { name: name.trim(), description, parameters }] });
        setError(failed);
        if (!failed) {
          setName('');
          setDescription('');
        }
      }}
    >
      <Label htmlFor={ids.name}>Tool name</Label>
      <Field id={ids.name} value={name} onChange={(event) => setName(event.target.value)} />
      <Label htmlFor={ids.description}>Tool description</Label>
      <Field id={ids.description} value={description} onChange={(event) => setDescription(event.target.value)} />
      <Label htmlFor={ids.schema}>Tool JSON Schema</Label>
      <Editor id={ids.schema} rows={4} value={schema} onChange={(event) => setSchema(event.target.value)} />
      {error && (
        <div role="alert">
          <Finding variant="err">{error}</Finding>
        </div>
      )}
      <div>
        <Button type="submit" small>
          <Icon name="plus" size={14} />
          Add tool
        </Button>
      </div>
    </form>
  );
}

function AddContext({ profile, commit }: { profile: ClientProfileSettings; commit: (next: ClientProfileSettings) => string | undefined }): ReactElement {
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const ids = { description: useId(), value: useId() };
  return (
    <form
      className="agui-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (description.trim() === '') return setError('Describe what the context is.');
        const failed = commit({ ...profile, context: [...profile.context, { description: description.trim(), value }] });
        setError(failed);
        if (!failed) {
          setDescription('');
          setValue('');
        }
      }}
    >
      <Label htmlFor={ids.description}>Context description</Label>
      <Field id={ids.description} value={description} onChange={(event) => setDescription(event.target.value)} />
      <Label htmlFor={ids.value}>Context value</Label>
      <Field id={ids.value} value={value} onChange={(event) => setValue(event.target.value)} />
      {error && (
        <div role="alert">
          <Finding variant="err">{error}</Finding>
        </div>
      )}
      <div>
        <Button type="submit" small>
          <Icon name="plus" size={14} />
          Add context
        </Button>
      </div>
    </form>
  );
}

function AddPayload({ profile, commit }: { profile: ClientProfileSettings; commit: (next: ClientProfileSettings) => string | undefined }): ReactElement {
  const [reason, setReason] = useState('');
  const [payload, setPayload] = useState('{\n  "approved": true\n}');
  const [error, setError] = useState<string>();
  const ids = { reason: useId(), payload: useId() };
  return (
    <form
      className="agui-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim() === '') return setError('Give the interrupt reason, for example approval.');
        let parsed: JsonValue;
        try {
          parsed = JSON.parse(payload) as JsonValue;
        } catch (cause) {
          return setError(`The payload is not valid JSON: ${problem(cause)}`);
        }
        const failed = commit(setInterruptPayload(profile, reason.trim(), parsed));
        setError(failed);
        if (!failed) setReason('');
      }}
    >
      <Label htmlFor={ids.reason}>Interrupt reason</Label>
      <Field id={ids.reason} value={reason} onChange={(event) => setReason(event.target.value)} />
      <Label htmlFor={ids.payload}>Payload</Label>
      <Editor id={ids.payload} rows={3} value={payload} onChange={(event) => setPayload(event.target.value)} />
      {error && (
        <div role="alert">
          <Finding variant="err">{error}</Finding>
        </div>
      )}
      <div>
        <Button type="submit" small>
          <Icon name="plus" size={14} />
          Add payload
        </Button>
      </div>
    </form>
  );
}

function ProfilePanel({ props, agent }: { props: SettingsViewProps; agent?: AgentConfig }): ReactElement {
  const { profile } = props;
  const [readError, setReadError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const protocolHint = useId();

  /** Applies a change only if the whole profile is still valid; otherwise returns what is wrong. */
  const commit = (next: ClientProfileSettings): string | undefined => {
    const checked = parseProfileSettings(next);
    if (!checked.ok) return checked.error;
    props.onChangeProfile(checked.value);
    return undefined;
  };

  const preset = agent?.preset;
  const presetMode = preset?.messages ?? 'full';
  const mode: ModeChoice = profile.messageMode ?? 'preset';
  const variables = Object.entries(preset?.variables ?? {});

  return (
    <>
      <Group title="Client profile">
        <p className="agui-settings-note">What the inspector sends in the next conversation run. Every change shows up in that run&apos;s recorded input.</p>
        <div className="agui-settings-box">
          <Row title="Protocol version" hint={<span id={protocolHint}>Sent as protocolVersion</span>}>
            <TextSetting
              label="Protocol version"
              value={profile.protocolVersion}
              describedBy={protocolHint}
              commit={(text) => (text.trim() === '' ? 'The protocol version cannot be empty, so it is not applied. The last valid value stays in use.' : commit({ ...profile, protocolVersion: text }))}
            />
          </Row>
          <Row title="Messages" hint={`Preset default: ${presetMode === 'turn' ? 'current turn' : 'full transcript'}`}>
            <SegmentedControl
              label="Message mode"
              value={mode}
              options={[
                { value: 'preset', label: 'Preset default' },
                { value: 'full', label: 'Full transcript' },
                { value: 'turn', label: 'Current turn' },
              ]}
              onChange={(choice) => {
                const { messageMode: _previous, ...rest } = profile;
                commit(choice === 'preset' ? rest : { ...rest, messageMode: choice as 'full' | 'turn' });
              }}
            />
          </Row>
          <Row title="Render A2UI surfaces" hint="Off: surfaces stay inspectable as JSON. The run input does not change.">
            <Switch aria-label="Render A2UI surfaces" checked={profile.renderA2ui} onChange={(renderA2ui) => commit({ ...profile, renderA2ui })} />
          </Row>
          <Row title="Inject render_a2ui tool" hint="Adds the tool through @ag-ui/a2ui-middleware">
            <Switch aria-label="Inject render_a2ui tool" checked={profile.injectA2uiTool} onChange={(injectA2uiTool) => commit({ ...profile, injectA2uiTool })} />
          </Row>
          <Row title="Interrupt replies" hint="Resolve or cancel every interrupt for you, then continue the run. The next run is the one your own reply would send. After 10 automatic replies in a row the inspector waits for you.">
            <SegmentedControl
              label="Interrupt replies"
              value={profile.interruptReply ?? 'manual'}
              options={[
                { value: 'manual', label: 'By hand' },
                { value: 'resolve', label: 'Resolve' },
                { value: 'cancel', label: 'Cancel' },
              ]}
              onChange={(choice) => {
                const { interruptReply: _previous, ...rest } = profile;
                commit(choice === 'manual' ? rest : { ...rest, interruptReply: choice as InterruptReply });
              }}
            />
          </Row>
        </div>
      </Group>

      <Group title="Interrupt payloads">
        <p className="agui-settings-note">
          Used when Interrupt replies is Resolve. Interrupts with the reason you name get this payload, sent as written whatever their response schema says. Other interrupts get the starting answer from their schema.
        </p>
        {Object.keys(profile.interruptPayloads ?? {}).length === 0 ? (
          <p className="agui-settings-muted">No payloads. Resolve sends the starting answer from each response schema.</p>
        ) : (
          <div className="agui-settings-box">
            {Object.entries(profile.interruptPayloads ?? {}).map(([reason, payload]) => (
              <Row key={reason} title={<span className="agui-settings-mono agui-settings-strong">{reason}</span>} hint="Interrupt reason">
                <JsonSetting label={`Payload for ${reason}`} value={payload} commit={(value) => commit(setInterruptPayload(profile, reason, value))} rows={3} />
                <Button variant="ghost" small iconOnly aria-label={`Remove payload for ${reason}`} onClick={() => commit(setInterruptPayload(profile, reason, undefined))}>
                  <Icon name="x" size={14} />
                </Button>
              </Row>
            ))}
          </div>
        )}
        <AddPayload profile={profile} commit={commit} />
      </Group>

      <Group title="Client tools">
        {profile.tools.length === 0 ? (
          <p className="agui-settings-muted">No client tools. Add one to script its result. Replies to tool calls stay by hand.</p>
        ) : (
          <div className="agui-settings-box">
            {profile.tools.map((tool) => {
              const script = profile.toolResults !== undefined && Object.hasOwn(profile.toolResults, tool.name) ? (profile.toolResults[tool.name] as string) : '';
              return (
                <Row
                  key={tool.name}
                  title={<span className="agui-settings-mono agui-settings-strong">{tool.name}</span>}
                  hint={`${tool.description || 'No description'} · ${script === '' ? 'answered by hand' : 'answered with a scripted result'}`}
                >
                  <TextSetting
                    label={`Scripted result for ${tool.name}`}
                    value={script}
                    rows={2}
                    commit={(text) => commit(setToolResult(profile, tool.name, text === '' ? undefined : text))}
                  />
                  {tool.parameters !== undefined && <Tag variant="line">JSON Schema</Tag>}
                  <Button variant="ghost" small iconOnly aria-label={`Remove tool ${tool.name}`} onClick={() => commit(removeTool(profile, tool.name))}>
                    <Icon name="x" size={14} />
                  </Button>
                </Row>
              );
            })}
          </div>
        )}
        <AddTool profile={profile} commit={commit} />
      </Group>

      <Group title="Context">
        {profile.context.length === 0 ? (
          <p className="agui-settings-muted">No context entries.</p>
        ) : (
          <div className="agui-settings-box">
            {profile.context.map((entry, index) => (
              <Row key={`${index}-${entry.description}`} title={entry.description} hint={<span className="agui-settings-mono">{entry.value}</span>}>
                <Button
                  variant="ghost"
                  small
                  iconOnly
                  aria-label={`Remove context ${entry.description}`}
                  onClick={() => commit({ ...profile, context: profile.context.filter((_, at) => at !== index) })}
                >
                  <Icon name="x" size={14} />
                </Button>
              </Row>
            ))}
          </div>
        )}
        <AddContext profile={profile} commit={commit} />
      </Group>

      <Group title="Forwarded properties">
        <p className="agui-settings-note">Merged over the preset&apos;s properties of the same name in every conversation run.</p>
        <JsonSetting
          label="Forwarded properties"
          value={profile.forwardedProps}
          commit={(value) =>
            isJsonObject(value) ? commit({ ...profile, forwardedProps: value }) : 'Forwarded properties must be a JSON object, so this is not applied.'
          }
        />
      </Group>

      {preset && (
        <Group title="Preset">
          {variables.length > 0 && (
            <>
              <div className="agui-settings-box">
                {variables.map(([name, definition]) => {
                  const current = props.variables[name] ?? definition.default;
                  return (
                    <Row key={name} title={<span className="agui-settings-mono agui-settings-strong">{name}</span>} hint={definition.type === 'json' ? 'JSON' : 'Text'}>
                      {definition.type === 'json' ? (
                        <JsonSetting label={`Variable ${name}`} value={current} commit={(value) => (props.onChangeVariable(name, value), undefined)} rows={3} />
                      ) : (
                        <TextSetting label={`Variable ${name}`} value={typeof current === 'string' ? current : JSON.stringify(current)} commit={(text) => (props.onChangeVariable(name, text), undefined)} />
                      )}
                    </Row>
                  );
                })}
              </div>
              <p className="agui-settings-note">Placeholders such as {'{{uuid}}'} are filled in when the run starts.</p>
            </>
          )}
          {(preset.prepare?.length ?? 0) > 0 && (
            <>
              <Label>Preparation requests, in order</Label>
              <div className="agui-settings-vals">
                {preset.prepare?.map((request, index) => (
                  <Tag key={index} variant="line">{`${request.method} ${request.path}`}</Tag>
                ))}
              </div>
            </>
          )}
          {preset.forwardedProps && (
            <>
              <Label>Preset forwarded properties</Label>
              <CodeBlock text={pretty(preset.forwardedProps)} aria-label="Preset forwarded properties" />
            </>
          )}
        </Group>
      )}

      <div className="agui-settings-actions">
        <Button onClick={props.onExportProfile}>
          <Icon name="export" size={15} />
          Export profile
        </Button>
        <Button onClick={() => fileInput.current?.click()}>
          <Icon name="import" size={15} />
          Import profile
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Profile file"
          hidden
          onChange={async (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            try {
              setReadError(undefined);
              props.onImportProfile(await file.text());
            } catch (error) {
              setReadError(`The profile file could not be read: ${problem(error)}`);
            }
            input.value = '';
          }}
        />
        <span className="agui-settings-muted">Saved in this browser. Tokens are never saved.</span>
      </div>
      {readError && (
        <div role="alert">
          <Finding variant="err">{readError}</Finding>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------------------------

export function SettingsView(props: SettingsViewProps & SettingsViewExtras): ReactElement {
  const agent = props.agents.find((candidate) => candidate.id === props.selectedAgentId);
  return (
    <section aria-labelledby="settings-heading" data-view="settings" className="agui-settings">
      <h2 id="settings-heading">Settings</h2>
      {props.error && (
        <div role="alert">
          <Finding variant="err">{props.error}</Finding>
        </div>
      )}
      <AgentPicker agents={props.agents} selectedId={props.selectedAgentId} onSelect={props.onSelectAgent} />
      {agent && <AgentPanel agent={agent} capabilities={props.capabilities} />}
      <ProfilePanel props={props} agent={agent} />
    </section>
  );
}
