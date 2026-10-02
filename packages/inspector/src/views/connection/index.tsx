// Connection and replies (design.md: Top bar, Conversation: tool call, interrupt, composer; FR-003,
// FR-004, FR-011, FR-023, FR-024).
//
// Three pieces, all driven by props and callbacks so the runtime owns every fact they show:
//   TargetControls  the endpoint field and the authentication popover (the top bar's right half).
//   Composer        the message box, quick messages, New thread and Stop.
//   RepliesView     in-place answers for what a finished run is waiting on: interrupt payload editors
//                   with Resolve and Cancel, and manual result editors for pending client tool calls.
// ConnectionView is the frozen entry export; it is TargetControls and Composer together.
//
// Composes F06 primitives only. The token field is the only place a credential is typed. The view
// echoes the header name and a mask, never the token, and keeps nothing in browser storage.
//
// Styling: this module imports no stylesheet, so importing it never changes what the build emits. The
// assembly loads the theme (views/theme/index.ts) and ./connection.css; see docs/conversation.md.
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import type { ConnectionViewProps, ConversationViewProps, DeploymentMode, InterruptAnswer, JsonValue, ToolResultDraft } from '../../contracts';
import { checkAgainstSchema } from '../../core/runtime/schema';
import { headerNameProblem } from '../../core/runtime/transport';
import { DEFAULT_AUTH_HEADER } from '../../contracts';
import { Button, Card, CardBody, CardFooter, CardHeader, CodeBlock, Editor, Field, FamilyDot, Finding, Icon, Label, Popover, Tag } from '../theme/primitives';

/** Optional data beyond the frozen props. */
export interface ConnectionViewExtras {
  /** Why the composer is disabled while answers are owed; the runtime's `notice`. */
  readonly notice?: string;
  /** Names the deployment in the target bar; the assembly knows it from the startup policy. */
  readonly mode?: DeploymentMode;
}

const pretty = (value: JsonValue): string => JSON.stringify(value, null, 2) ?? '';

// ---------------------------------------------------------------------------------------------
// Endpoint and authentication
// ---------------------------------------------------------------------------------------------

function Authentication({ auth, onChange }: { auth: ConnectionViewProps['connection']['auth']; onChange: ConnectionViewProps['onChangeAuth'] }): ReactElement {
  const popoverId = useId();
  const headerId = useId();
  const tokenId = useId();
  const errorId = useId();
  // The header name is kept here while there is no token, since a name alone is not a credential.
  const [typedName, setTypedName] = useState(DEFAULT_AUTH_HEADER);
  const headerName = auth?.headerName ?? typedName;
  const problem = headerNameProblem(headerName);

  const apply = (name: string, token: string) => onChange(token === '' ? undefined : { headerName: name, token });
  return (
    <div className="agui-conn-auth">
      <Button popoverTarget={popoverId} aria-label={auth ? `Authentication: ${auth.headerName} set` : 'Authentication: no token'}>
        <Icon name="lock" />
        {auth ? (
          <>
            <span className="agui-conn-mono">{auth.headerName}</span>
            <span className="agui-conn-mask" aria-hidden="true">
              ••••••
            </span>
          </>
        ) : (
          'No token'
        )}
      </Button>
      <Popover id={popoverId} aria-label="Authentication">
        <div className="agui-conn-pop">
          <Label>Authentication</Label>
          <label className="agui-conn-field" htmlFor={headerId}>
            <span>Header name</span>
            <Field
              id={headerId}
              value={headerName}
              spellCheck={false}
              autoComplete="off"
              invalid={problem !== undefined}
              aria-describedby={problem ? errorId : undefined}
              onChange={(event) => {
                setTypedName(event.target.value);
                if (auth) apply(event.target.value, auth.token);
              }}
            />
          </label>
          {problem && (
            <div id={errorId} role="alert">
              <Finding variant="err">{problem}</Finding>
            </div>
          )}
          <label className="agui-conn-field" htmlFor={tokenId}>
            <span>Token</span>
            <Field id={tokenId} type="password" autoComplete="off" spellCheck={false} value={auth?.token ?? ''} onChange={(event) => apply(headerName, event.target.value)} />
          </label>
          <p className="agui-conn-note">
            The token stays in memory. It is cleared on reload or when the target changes, and it is never recorded or exported.
          </p>
          <div className="agui-conn-actions">
            <Button small disabled={auth === undefined} onClick={() => onChange(undefined)}>
              Clear token
            </Button>
          </div>
        </div>
      </Popover>
    </div>
  );
}

export function TargetControls({ connection, mode, onChangeTarget, onChangeAuth }: Pick<ConnectionViewProps, 'connection' | 'onChangeTarget' | 'onChangeAuth'> & Pick<ConnectionViewExtras, 'mode'>): ReactElement {
  const fieldId = useId();
  const target = connection.targetUrl ?? '';
  // A typed endpoint is applied when the user says so; a half-typed URL must not clear the token or end the thread.
  const [draft, setDraft] = useState({ text: target, seen: target });
  let current = draft;
  if (draft.seen !== target) {
    current = { text: target, seen: target };
    setDraft(current);
  }
  const apply = () => {
    if (current.text.trim() !== '') onChangeTarget(current.text.trim());
  };
  return (
    <div className="agui-conn-target" data-mode={mode}>
      <form
        className="agui-conn-endpoint"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label htmlFor={fieldId} className="agui-conn-sr">
          Endpoint URL
        </label>
        <Field
          id={fieldId}
          type="text"
          inputMode="url"
          placeholder={mode === 'hosted' ? 'https://agent.example/run' : '/agents/support/stream'}
          spellCheck={false}
          autoComplete="off"
          value={current.text}
          onChange={(event) => setDraft({ text: event.target.value, seen: target })}
        />
        <Button type="submit" small disabled={current.text.trim() === '' || current.text.trim() === target}>
          Use endpoint
        </Button>
      </form>
      {mode && <Tag variant="line">{mode}</Tag>}
      <Authentication auth={connection.auth} onChange={onChangeAuth} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------------------------

export function Composer({ running, quickMessages, notice, onSend, onStop, onNewThread, error }: Pick<ConnectionViewProps, 'running' | 'quickMessages' | 'onSend' | 'onStop' | 'onNewThread' | 'error'> & Pick<ConnectionViewExtras, 'notice'>): ReactElement {
  const boxId = useId();
  const [text, setText] = useState('');
  const sent = useRef(false);
  const wasRunning = useRef(false);

  // The text stays in the box until the run it started has ended without an error, so a refused or
  // failed send can be retried without retyping.
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (wasRunning.current && sent.current) {
      wasRunning.current = false;
      sent.current = false;
      if (error === undefined) setText('');
    }
  }, [running, error]);

  const blocked = running || notice !== undefined;
  const reason = running ? 'A run is streaming. Stop it to send another message.' : notice;
  const submit = () => {
    if (blocked || text.trim() === '') return;
    sent.current = true;
    onSend(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <div className="agui-conn-composer" data-view="composer">
      {error && (
        <div role="alert" className="agui-conn-error">
          <Finding variant="err">{error}</Finding>
        </div>
      )}
      <div className="agui-conn-bar">
        <p className="agui-conn-notice" role="status">
          {reason ?? 'Enter sends. Shift+Enter adds a line.'}
        </p>
        <div className="agui-conn-actions">
          <Button small onClick={onNewThread} aria-label="New thread">
            <Icon name="plus" size={14} />
            New thread
          </Button>
          <Button small disabled={!running} onClick={onStop} aria-label="Stop">
            <Icon name="stop" size={14} />
            Stop
          </Button>
        </div>
      </div>
      <div className="agui-conn-send">
        <label htmlFor={boxId} className="agui-conn-sr">
          Message
        </label>
        <Editor id={boxId} rows={2} disabled={blocked} value={text} placeholder="Message the agent" onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
        <Button variant="primary" iconOnly aria-label="Send message" disabled={blocked || text.trim() === ''} onClick={submit}>
          <Icon name="send" />
        </Button>
      </div>
      {quickMessages.length > 0 && (
        <div className="agui-conn-chips" role="group" aria-label="Quick messages">
          {quickMessages.map((message) => (
            <Button key={message} small disabled={blocked} onClick={() => onSend(message)}>
              {message}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The frozen entry export: the endpoint and authentication controls, then the composer. */
export function ConnectionView(props: ConnectionViewProps & ConnectionViewExtras): ReactElement {
  const { connection, running, quickMessages, error, notice, mode, onChangeTarget, onChangeAuth, onSend, onStop, onNewThread } = props;
  return (
    <section aria-labelledby="connection-heading" data-view="connection" className="agui-conn">
      <h2 id="connection-heading">Connection</h2>
      <TargetControls connection={connection} onChangeTarget={onChangeTarget} onChangeAuth={onChangeAuth} {...(mode !== undefined && { mode })} />
      <Composer running={running} quickMessages={quickMessages} onSend={onSend} onStop={onStop} onNewThread={onNewThread} {...(error !== undefined && { error })} {...(notice !== undefined && { notice })} />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Replies: interrupts and pending client tool calls
// ---------------------------------------------------------------------------------------------

/** One line naming what the schema asks for, for the editor's hint. */
function schemaHint(schema: InterruptAnswer['responseSchema']): string | undefined {
  if (schema === undefined) return undefined;
  const parts: string[] = [];
  const type = schema.type;
  if (typeof type === 'string') parts.push(type);
  if (Array.isArray(schema.required) && schema.required.length > 0) parts.push(`required: ${schema.required.map(String).join(', ')}`);
  const properties = schema.properties;
  if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
    const names = Object.keys(properties);
    if (names.length > 0) parts.push(`fields: ${names.join(', ')}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'any JSON value';
}

type ReplyProps = Pick<ConversationViewProps, 'interrupts' | 'toolResults' | 'onDraftInterrupt' | 'onAnswerInterrupt' | 'onDraftToolResult' | 'onSubmitToolResult'>;

interface InterruptInfo {
  readonly reason: string;
  readonly message?: string;
}

/** Reason and prompt of each reported interrupt, read from the observed outcomes in the store. */
function useInterruptInfo(store: ConversationViewProps['store']): ReadonlyMap<string, InterruptInfo> {
  const session = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const info = new Map<string, InterruptInfo>();
  for (const run of session.runs) {
    if (run.outcome.kind !== 'interrupt') continue;
    for (const interrupt of run.outcome.interrupts) info.set(interrupt.id, { reason: interrupt.reason, ...(interrupt.message !== undefined && { message: interrupt.message }) });
  }
  return info;
}

function InterruptCard({ answer, info, waiting, total, onDraft, onAnswer }: { answer: InterruptAnswer; info: InterruptInfo | undefined; waiting: number; total: number; onDraft: ReplyProps['onDraftInterrupt']; onAnswer: ReplyProps['onAnswerInterrupt'] }): ReactElement {
  const editorId = useId();
  const errorId = useId();
  const hint = schemaHint(answer.responseSchema);
  const canonical = JSON.stringify(answer.draft);
  const [text, setText] = useState({ value: pretty(answer.draft), seen: canonical });
  let current = text;
  if (text.seen !== canonical) {
    // The draft changed from outside (the runtime re-seeded it): show it.
    current = { value: pretty(answer.draft), seen: canonical };
    setText(current);
  }

  let parsed: { value: JsonValue } | { error: string };
  try {
    parsed = { value: JSON.parse(current.value) as JsonValue };
  } catch (error) {
    parsed = { error: `Not valid JSON, so it cannot be sent: ${error instanceof Error ? error.message : String(error)}` };
  }
  const miss = 'value' in parsed ? checkAgainstSchema(parsed.value, answer.responseSchema) : undefined;

  if (answer.status !== 'unanswered') {
    return (
      <Card data-entry="interrupt" data-interrupt={answer.interruptId} data-status={answer.status}>
        <CardHeader>
          <Icon name="hand" size={14} />
          <b>Interrupt</b>
          <Tag variant="neutral">{answer.interruptId}</Tag>
          <Tag variant={answer.status === 'resolved' ? 'ok' : 'neutral'}>{answer.status === 'resolved' ? 'Resolved' : 'Cancelled'}</Tag>
          {answer.status === 'resolved' && <span className="agui-conn-mono agui-conn-clip">{JSON.stringify(answer.draft)}</span>}
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card interrupt data-entry="interrupt" data-interrupt={answer.interruptId} data-status="unanswered">
      <CardHeader>
        <Icon name="hand" size={14} />
        <b>Interrupt</b>
        {info && <Tag variant="line">{info.reason}</Tag>}
        <Tag variant="neutral">{answer.interruptId}</Tag>
        <Tag variant="accent">{waiting} of {total} waiting</Tag>
      </CardHeader>
      <CardBody>
        {info?.message !== undefined && <p className="agui-conn-prompt">{info.message}</p>}
        <label className="agui-conn-field" htmlFor={editorId}>
          <span>Answer</span>
          <Editor
            id={editorId}
            rows={Math.min(8, Math.max(3, current.value.split('\n').length))}
            value={current.value}
            invalid={'error' in parsed}
            aria-label={`Answer for interrupt ${answer.interruptId}`}
            aria-describedby={'error' in parsed || miss ? errorId : undefined}
            onChange={(event) => {
              const value = event.target.value;
              setText({ value, seen: canonical });
              try {
                const next = JSON.parse(value) as JsonValue;
                onDraft(answer.interruptId, next);
              } catch {
                // Kept as text; the error below says why it cannot be sent.
              }
            }}
          />
        </label>
        {hint && <small className="agui-conn-hint">Response schema: {hint}</small>}
        <div id={errorId} role={'error' in parsed ? 'alert' : undefined}>
          {'error' in parsed && <Finding variant="err">{parsed.error}</Finding>}
          {miss && <Finding variant="warn">{miss} You can still send it.</Finding>}
        </div>
        <div className="agui-conn-actions">
          <Button variant="primary" small aria-label={`Resolve interrupt ${answer.interruptId}`} disabled={'error' in parsed} onClick={() => onAnswer(answer.interruptId, 'resolved')}>
            Resolve
          </Button>
          <Button small aria-label={`Cancel interrupt ${answer.interruptId}`} onClick={() => onAnswer(answer.interruptId, 'cancelled')}>
            Cancel interrupt
          </Button>
        </div>
      </CardBody>
      <CardFooter>The next run carries resume answers once every interrupt has one. Resolve sends your answer; Cancel sends a cancellation.</CardFooter>
    </Card>
  );
}

function ToolResultCard({ draft, waiting, total, onDraft, onSubmit }: { draft: ToolResultDraft; waiting: number; total: number; onDraft: ReplyProps['onDraftToolResult']; onSubmit: ReplyProps['onSubmitToolResult'] }): ReactElement {
  const editorId = useId();
  const name = draft.toolName === '' ? draft.toolCallId : draft.toolName;
  if (draft.status === 'answered') {
    return (
      <Card data-entry="tool-result" data-tool-call={draft.toolCallId} data-status="answered">
        <CardHeader>
          <FamilyDot family="tool" />
          <b className="agui-conn-mono">{name}</b>
          <Tag variant="neutral">{draft.toolCallId}</Tag>
          <Tag variant="ok">Result entered</Tag>
          <span className="agui-conn-mono agui-conn-clip">{draft.resultDraft}</span>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card interrupt data-entry="tool-result" data-tool-call={draft.toolCallId} data-status="pending">
      <CardHeader>
        <FamilyDot family="tool" />
        <b className="agui-conn-mono">{name}</b>
        <Tag variant="line">client tool</Tag>
        <Tag variant="neutral">{draft.toolCallId}</Tag>
        <Tag variant="accent">{waiting} of {total} waiting</Tag>
      </CardHeader>
      <CardBody>
        <div>
          <Label>Arguments</Label>
          {draft.argumentsParsed !== undefined ? (
            <CodeBlock text={pretty(draft.argumentsParsed)} aria-label={`Arguments of ${name}`} />
          ) : (
            <CodeBlock text={draft.argumentsText} format="raw" aria-label={`Arguments of ${name}, as streamed`} />
          )}
          {draft.argumentsError !== undefined && (
            <Finding variant="err" kind="Arguments">
              {draft.argumentsError}
            </Finding>
          )}
        </div>
        <label className="agui-conn-field" htmlFor={editorId}>
          <span>Result</span>
          <Editor id={editorId} rows={3} value={draft.resultDraft} aria-label={`Result for ${name} (${draft.toolCallId})`} onChange={(event) => onDraft(draft.toolCallId, event.target.value)} />
        </label>
        <div className="agui-conn-actions">
          <Button variant="primary" small aria-label={`Submit result for ${draft.toolCallId}`} onClick={() => onSubmit(draft.toolCallId)}>
            Submit result
          </Button>
        </div>
      </CardBody>
      <CardFooter>The next run starts once every pending call has a result, and carries each as a tool message. Nothing is answered for you.</CardFooter>
    </Card>
  );
}

/** In-place answers for what the last run left waiting. Renders nothing when nothing is owed. */
export function RepliesView({ store, interrupts, toolResults, running, onDraftInterrupt, onAnswerInterrupt, onDraftToolResult, onSubmitToolResult, onContinue }: ConversationViewProps & { readonly running?: boolean }): ReactElement | null {
  const info = useInterruptInfo(store);
  if (interrupts.length === 0 && toolResults.length === 0) return null;
  const waitingInterrupts = interrupts.filter((answer) => answer.status === 'unanswered');
  const waitingTools = toolResults.filter((draft) => draft.status === 'pending');
  // Answers are all in but their run is not on its way: the continuation failed before it was sent.
  const stalled = waitingInterrupts.length + waitingTools.length === 0;
  const section = (children: ReactNode) => (
    <section aria-label="Replies" data-view="replies" className="agui-conn-replies">
      {children}
    </section>
  );
  return section(
    <>
      {interrupts.map((answer) => (
        <InterruptCard
          key={answer.interruptId}
          answer={answer}
          info={info.get(answer.interruptId)}
          waiting={waitingInterrupts.length}
          total={interrupts.length}
          onDraft={onDraftInterrupt}
          onAnswer={onAnswerInterrupt}
        />
      ))}
      {toolResults.map((draft) => (
        <ToolResultCard key={draft.toolCallId} draft={draft} waiting={waitingTools.length} total={toolResults.length} onDraft={onDraftToolResult} onSubmit={onSubmitToolResult} />
      ))}
      {stalled && (
        <div className="agui-conn-actions">
          <Button variant="primary" small disabled={running === true} onClick={onContinue}>
            Send the continuation again
          </Button>
          <small className="agui-conn-hint">Every answer is in. The continuation did not go out; fix the cause above and send it again.</small>
        </div>
      )}
    </>,
  );
}
