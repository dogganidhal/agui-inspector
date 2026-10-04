// The conversation view (design.md: Conversation). Composes F06 primitives; every entry comes from the
// projection, which builds it from valid received frames. Text is rendered as text: React escapes it and there
// is no HTML path. Message and reasoning text is plain unless the developer turns Markdown on (./markdown.tsx), which
// is a view of the same text. Encrypted reasoning shows metadata only.
//
// Replying (interrupt answers, tool results, the composer) is the connection lane's, so this view
// shows outcomes and pending states but offers no reply controls; see website/content/docs/event-views.mdx.
//
// Styling: this module imports no stylesheet, so importing it never changes what the build emits. The
// assembly loads the theme (views/theme/index.ts) and ./conversation.css; see website/content/docs/event-views.mdx.
import { useState, type ReactElement, type ReactNode } from 'react';
import type { ConversationViewProps, EvidenceTarget, FrameId, JsonValue, RawFrame } from '../../contracts';
import type {
  ActivityEntry,
  ConversationEntry,
  CustomEntry,
  Delta,
  EncryptedEntry,
  IssueEntry,
  MessageEntry,
  ReasoningEntry,
  RunEntry,
  RunStatus,
  StepEntry,
  ToolCallEntry,
} from '../../core/projection/index';
import { Card, CardBody, CardFooter, CardHeader, CodeBlock, FamilyDot, Finding, Icon, Label, SegmentedControl, Tag, type TagVariant } from '../theme/primitives';
import { LaneBlock, LaneNavProvider, useLaneNav } from './lanes';
import { DERIVED_NOTE, Disclosure, FrameRef, RevealProvider, formatMs, formatOffset, useProjection, useReveal } from './shared';
import { ConversationText, MarkdownModeProvider, MarkdownToggle, type TextMode } from './markdown';
import { SubagentTimeline } from './timeline';
import { SnapshotMarker } from './state';

/** Optional hooks for the assembly. */
export interface ConversationViewExtras {
  /** Draws an activity's content (an A2UI surface, or a plugin's view) inside its card. */
  renderActivity?(entry: ActivityEntry): ReactNode;
  /** Draws a custom event's value (a plugin's view). Without it, or when it returns nothing, the event is the one-line marker. */
  renderCustom?(entry: CustomEntry): ReactNode;
  /** Shows the evidence a run id or frame reference points at. Without it they stay plain text. */
  onReveal?(target: EvidenceTarget): void;
}

type Frames = ReadonlyMap<FrameId, RawFrame>;

const pretty = (value: JsonValue): string => JSON.stringify(value, null, 2) ?? '';

/** JSON gets pretty-printed and highlighted; anything else stays exactly the text it is. */
function Payload({ text, label }: { text: string; label: string }): ReactElement {
  try {
    return <CodeBlock text={pretty(JSON.parse(text) as JsonValue)} aria-label={label} />;
  } catch {
    return <CodeBlock text={text} format="raw" aria-label={label} />;
  }
}

function Deltas({ deltas, frames, label }: { deltas: readonly Delta[]; frames: Frames; label: string }): ReactElement | null {
  if (deltas.length === 0) return null;
  return (
    <Disclosure summary={<span className="agui-conv-muted">{deltas.length} {deltas.length === 1 ? 'delta' : 'deltas'}</span>} className="agui-conv-deltas">
      <ol className="agui-conv-deltalist" aria-label={label}>
        {deltas.map((delta, i) => (
          <li key={i}>
            <span className="agui-conv-mono agui-conv-evidence">{formatOffset(delta.offsetMs)}</span>
            <FrameRef frameId={delta.frameId} frames={frames} />
            <span className="agui-conv-mono agui-conv-value">{delta.text}</span>
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}

// ---- run header ----

const OUTCOME: Record<RunStatus, { label: string; variant: TagVariant }> = {
  streaming: { label: 'Streaming', variant: 'accent' },
  finished: { label: 'Finished', variant: 'ok' },
  interrupted: { label: 'Interrupted', variant: 'accent' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
  error: { label: 'Error', variant: 'err' },
  stopped: { label: 'Stopped by you', variant: 'warn' },
  'no-terminal': { label: 'No terminal event', variant: 'warn' },
};

function RunHeader({ run }: { run: RunEntry }): ReactElement {
  const reveal = useReveal();
  const outcome = OUTCOME[run.status];
  const notes = [
    run.interrupts.length > 0 && `${run.interrupts.length} ${run.interrupts.length === 1 ? 'interrupt' : 'interrupts'}`,
    run.pendingToolCallIds.length > 0 && `${run.pendingToolCallIds.length} pending tool ${run.pendingToolCallIds.length === 1 ? 'call' : 'calls'}`,
  ].filter(Boolean);
  return (
    <div className="agui-conv-run" data-entry="run" data-status={run.status}>
      <div className="agui-conv-rulehead">
        {reveal === undefined ? (
          <b className="agui-conv-mono">{run.runId ?? 'run'}</b>
        ) : (
          <button
            type="button"
            className="agui-conv-mono agui-conv-ref agui-conv-runref"
            aria-label={`Show the exchange of ${run.runId === undefined ? 'this run' : `run ${run.runId}`} in the frames list`}
            onClick={() => reveal({ exchangeId: run.exchangeId })}
          >
            <b>{run.runId ?? 'run'}</b>
          </button>
        )}
        {run.parentRunId !== undefined && <span className="agui-conv-mono agui-conv-muted" title="Parent run">← {run.parentRunId}</span>}
        <Tag variant={outcome.variant} pulse={run.status === 'streaming'}>{outcome.label}</Tag>
        {run.durationMs !== undefined && <span className="agui-conv-mono agui-conv-muted" title={DERIVED_NOTE}>{formatMs(run.durationMs)}</span>}
        {notes.length > 0 && <span className="agui-conv-muted">{notes.join(' · ')}</span>}
        <span className="agui-conv-rule" />
      </div>
      {run.carried.length > 0 && <div className="agui-conv-sub">Carried: {run.carried.map((item) => <span key={item} className="agui-conv-mono"> {item}</span>)}</div>}
      {run.error !== undefined && (
        <Finding variant="err" kind={run.error.code ?? 'RUN_ERROR'}>
          {run.error.message}
        </Finding>
      )}
      {run.transportError !== undefined && (
        <Finding variant="warn" kind="Connection">
          {run.transportError}
        </Finding>
      )}
      {run.status === 'no-terminal' && (
        <Finding variant="warn" kind="Outcome unknown">
          The stream ended without RUN_FINISHED or RUN_ERROR. No outcome is shown because none was received.
        </Finding>
      )}
      {run.result !== undefined && (
        <Disclosure summary={<span className="agui-conv-muted">Result</span>}>
          <CodeBlock text={pretty(run.result)} aria-label="Run result" />
        </Disclosure>
      )}
    </div>
  );
}

// ---- messages and reasoning ----

function MessageBlock({ entry, frames }: { entry: MessageEntry; frames: Frames }): ReactElement {
  return (
    <div className="agui-conv-msg" data-entry="message" data-role={entry.role}>
      <div className="agui-conv-who">
        <Label>{entry.role}</Label>
        <Tag variant="neutral">{entry.messageId}</Tag>
        {entry.name !== undefined && <Tag variant="line">{entry.name}</Tag>}
        {entry.fromChunk && <Tag variant="dashed" title="Opened by a chunk event; the original chunk stays in the frames list">from TEXT_MESSAGE_CHUNK</Tag>}
        {entry.origin === 'snapshot' && <Tag variant="dashed">from MESSAGES_SNAPSHOT</Tag>}
        {entry.extraParts > 0 && <Tag variant="line">{entry.extraParts} non-text {entry.extraParts === 1 ? 'part' : 'parts'}</Tag>}
      </div>
      <div className={entry.live ? 'agui-conv-body agui-caret' : 'agui-conv-body'}><ConversationText text={entry.text} role={entry.role} /></div>
      <Deltas deltas={entry.deltas} frames={frames} label={`Deltas of ${entry.messageId}`} />
    </div>
  );
}

function ReasoningBlock({ entry, frames }: { entry: ReasoningEntry; frames: Frames }): ReactElement {
  return (
    <div className="agui-conv-reason" data-entry="reasoning">
      <Disclosure
        defaultOpen
        summary={
          <>
            <FamilyDot family="reason" />
            <span>Reasoning</span>
            <Tag variant="neutral">{entry.messageId}</Tag>
            {entry.fromChunk && <Tag variant="dashed" title="Opened by a chunk event; the original chunk stays in the frames list">from REASONING_MESSAGE_CHUNK</Tag>}
            {entry.live && <Tag variant="accent" pulse>Streaming</Tag>}
          </>
        }
      >
        <div className={entry.live ? 'agui-conv-body agui-conv-reasontext agui-caret' : 'agui-conv-body agui-conv-reasontext'}><ConversationText text={entry.text} /></div>
        <Deltas deltas={entry.deltas} frames={frames} label={`Deltas of ${entry.messageId}`} />
      </Disclosure>
    </div>
  );
}

function EncryptedMarker({ entry, frames }: { entry: EncryptedEntry; frames: Frames }): ReactElement {
  return (
    <div className="agui-conv-marker" data-entry="encrypted">
      <Icon name="lock" size={14} />
      <b>Encrypted reasoning</b>
      <Tag variant="line">{entry.subtype}</Tag>
      <Tag variant="line">{entry.entityId}</Tag>
      <Tag variant="line">{entry.size} bytes</Tag>
      <span>not decoded</span>
      {entry.frames[0] !== undefined && <FrameRef frameId={entry.frames[0]} frames={frames} />}
    </div>
  );
}

// ---- tool calls ----

function ToolBlock({ entry, frames }: { entry: ToolCallEntry; frames: Frames }): ReactElement {
  const status = entry.result
    ? { label: 'Result received', variant: 'ok' as const }
    : entry.pending
      ? { label: 'Pending result', variant: 'warn' as const }
      : entry.live
        ? { label: 'Streaming arguments', variant: 'accent' as const }
        : { label: 'No result', variant: 'neutral' as const };
  return (
    <Card data-entry="tool" data-tool-call={entry.toolCallId}>
      <CardHeader>
        <FamilyDot family="tool" />
        <b className="agui-conv-mono">{entry.name}</b>
        {entry.side && <Tag variant="line">{entry.side} tool</Tag>}
        <Tag variant="neutral">{entry.toolCallId}</Tag>
        {entry.fromChunk && <Tag variant="dashed" title="Opened by a chunk event; the original chunk stays in the frames list">from TOOL_CALL_CHUNK</Tag>}
        <Tag variant={status.variant} pulse={entry.live}>{status.label}</Tag>
      </CardHeader>
      <CardBody>
        <div>
          <Label>Arguments</Label>
          {entry.argsParsed !== undefined ? (
            <CodeBlock text={pretty(entry.argsParsed)} aria-label={`Arguments of ${entry.name}`} />
          ) : (
            <CodeBlock text={entry.argsText} format="raw" aria-label={`Arguments of ${entry.name}, as streamed`} />
          )}
          {entry.argsError !== undefined && (
            <Finding variant="err" kind="Arguments">
              {entry.argsError}
            </Finding>
          )}
          <Deltas deltas={entry.argsDeltas} frames={frames} label={`Argument fragments of ${entry.toolCallId}`} />
        </div>
        {entry.result && (
          <div>
            <Label>Result{entry.result.origin === 'entered' ? (entry.result.automatic ? ' · automatic' : ' · entered by you') : ''}</Label>
            <Payload text={entry.result.content} label={`Result of ${entry.name}`} />
          </div>
        )}
      </CardBody>
      {(entry.pending || entry.result?.carriedBy !== undefined) && (
        <CardFooter>
          {entry.pending && 'Waiting for the application to supply a result in the next run.'}
          {entry.result?.carriedBy !== undefined && <>Carried by run <span className="agui-conv-mono">{entry.result.carriedBy}</span></>}
        </CardFooter>
      )}
    </Card>
  );
}

// ---- steps, subagents, activities, markers ----

function StepBlock({ entry, frames, extras }: { entry: StepEntry; frames: Frames; extras: ConversationViewExtras }): ReactElement {
  const jump = useLaneNav()?.lane;
  return (
    <div className="agui-conv-step" data-entry="step">
      <Disclosure
        defaultOpen
        {...(jump?.path.has(entry.id) && { reveal: jump.nonce })}
        summary={
          <>
            <span>Step</span>
            <b className="agui-conv-mono">{entry.stepName}</b>
            {entry.live ? <Tag variant="accent" pulse>Running</Tag> : entry.durationMs !== undefined && <span className="agui-conv-mono agui-conv-muted" title={DERIVED_NOTE}>{formatMs(entry.durationMs)}</span>}
          </>
        }
      >
        <div className="agui-conv-stepbody">
          <Entries list={entry.children} frames={frames} extras={extras} />
        </div>
      </Disclosure>
    </div>
  );
}

function ActivityBlock({ entry, extras }: { entry: ActivityEntry; extras: ConversationViewExtras }): ReactElement {
  const rendered = extras.renderActivity?.(entry);
  const [mode, setMode] = useState<'rendered' | 'json'>('rendered');
  const showRendered = rendered !== undefined && rendered !== null && mode === 'rendered';
  return (
    <Card data-entry="activity" data-activity={entry.messageId}>
      <CardHeader>
        <FamilyDot family="activity" />
        <b>Activity</b>
        <Tag variant="neutral">{entry.activityType}</Tag>
        <Tag variant="neutral">{entry.messageId}</Tag>
        {entry.patches > 0 && <Tag variant="line">{entry.patches} {entry.patches === 1 ? 'patch' : 'patches'}</Tag>}
        {rendered !== undefined && rendered !== null && (
          <SegmentedControl label="Activity display" value={mode} options={[{ value: 'rendered', label: 'Rendered' }, { value: 'json', label: 'JSON' }]} onChange={(value) => setMode(value as 'rendered' | 'json')} />
        )}
      </CardHeader>
      <CardBody>
        {showRendered ? rendered : <CodeBlock text={pretty(entry.content)} aria-label={`Content of ${entry.messageId}`} />}
        {entry.error !== undefined && (
          <Finding variant="err" kind="Activity patch">
            {entry.error}. The content shown is the last valid one.
          </Finding>
        )}
      </CardBody>
    </Card>
  );
}

/** A custom event that a plugin draws: the marker's facts in a card header, and the same Rendered/JSON switch as an activity. */
function CustomBlock({ entry, frames, rendered }: { entry: CustomEntry; frames: Frames; rendered: ReactNode }): ReactElement {
  const [mode, setMode] = useState<'rendered' | 'json'>('rendered');
  return (
    <Card data-entry="custom" data-custom={entry.name}>
      <CardHeader>
        <FamilyDot family="neutral" hollow />
        <b className="agui-conv-mono">CUSTOM</b>
        <Tag variant="neutral">{entry.name}</Tag>
        <FrameRef frameId={entry.frames[0] as FrameId} frames={frames} />
        <SegmentedControl label="Custom event display" value={mode} options={[{ value: 'rendered', label: 'Rendered' }, { value: 'json', label: 'JSON' }]} onChange={(value) => setMode(value as 'rendered' | 'json')} />
      </CardHeader>
      <CardBody>{mode === 'rendered' ? rendered : <CodeBlock text={pretty(entry.value)} aria-label={`Value of ${entry.name}`} />}</CardBody>
    </Card>
  );
}

/** The issues of one run that sit side by side, as one list a screen reader can find. */
function IssueList({ issues, frames }: { issues: readonly IssueEntry[]; frames: Frames }): ReactElement {
  return (
    <ul className="agui-conv-issues" aria-label="Projection issues">
      {issues.map((issue) => (
        <li key={issue.id}>
          <Finding variant="warn" kind="Not shown">
            {issue.message} {issue.frameId !== undefined && <FrameRef frameId={issue.frameId} frames={frames} />}. The frame is still in the frames list.
          </Finding>
        </li>
      ))}
    </ul>
  );
}

function Entries({ list, frames, extras }: { list: readonly ConversationEntry[]; frames: Frames; extras: ConversationViewExtras }): ReactElement {
  return (
    <>
      {list.map((entry, at) => {
        switch (entry.kind) {
          case 'issue': {
            // The first of a group of adjacent issues draws the whole group.
            if (list[at - 1]?.kind === 'issue') return null;
            let end = at + 1;
            while (list[end]?.kind === 'issue') end += 1;
            return <IssueList key={entry.id} issues={list.slice(at, end) as IssueEntry[]} frames={frames} />;
          }
          case 'run':
            return <RunHeader key={entry.id} run={entry} />;
          case 'message':
            return <MessageBlock key={entry.id} entry={entry} frames={frames} />;
          case 'reasoning':
            return <ReasoningBlock key={entry.id} entry={entry} frames={frames} />;
          case 'encrypted':
            return <EncryptedMarker key={entry.id} entry={entry} frames={frames} />;
          case 'tool':
            return <ToolBlock key={entry.id} entry={entry} frames={frames} />;
          case 'step':
            return <StepBlock key={entry.id} entry={entry} frames={frames} extras={extras} />;
          case 'subagent':
            return <LaneBlock key={entry.id} entry={entry} frames={frames} renderChildren={(list) => <Entries list={list} frames={frames} extras={extras} />} />;
          case 'activity':
            return <ActivityBlock key={entry.id} entry={entry} extras={extras} />;
          case 'snapshot':
            return <SnapshotMarker key={entry.id} entry={entry} frames={frames} />;
          case 'custom': {
            const rendered = extras.renderCustom?.(entry);
            if (rendered !== undefined && rendered !== null) return <CustomBlock key={entry.id} entry={entry} frames={frames} rendered={rendered} />;
            return (
              <div key={entry.id} className="agui-conv-marker" data-entry="custom">
                <FamilyDot family="neutral" hollow />
                <b className="agui-conv-mono">CUSTOM</b>
                <span className="agui-conv-mono">{entry.name}</span>
                <span className="agui-conv-mono agui-conv-muted agui-conv-value">{JSON.stringify(entry.value)}</span>
                <FrameRef frameId={entry.frames[0] as FrameId} frames={frames} />
              </div>
            );
          }
          case 'raw':
            return (
              <div key={entry.id} className="agui-conv-marker" data-entry="raw">
                <FamilyDot family="neutral" hollow />
                <b className="agui-conv-mono">RAW</b>
                {entry.source !== undefined && <span className="agui-conv-mono">{entry.source}</span>}
                <span className="agui-conv-mono agui-conv-muted agui-conv-value">{JSON.stringify(entry.value)}</span>
                <FrameRef frameId={entry.frames[0] as FrameId} frames={frames} />
              </div>
            );
        }
      })}
    </>
  );
}

/** The transcript of the current thread, built from the store and live as frames arrive. */
export function ConversationView({ store, threadId, renderActivity, renderCustom, onReveal }: ConversationViewProps & ConversationViewExtras): ReactElement {
  const { model, frames } = useProjection(store, threadId);
  const extras: ConversationViewExtras = { ...(renderActivity && { renderActivity }), ...(renderCustom && { renderCustom }) };
  // Not saved: a reload starts in plain text, and so does a page that mounts only this view.
  const [textMode, setTextMode] = useState<TextMode>('plain');
  return (
    <section aria-labelledby="conversation-heading" data-view="conversation" data-text-mode={textMode} className="agui-conv">
      <h2 id="conversation-heading">Conversation</h2>
      <MarkdownToggle mode={textMode} onChange={setTextMode} />
      {model.entries.length === 0 ? (
        <p className="agui-conv-empty">No conversation yet. Runs and messages appear here as events arrive.</p>
      ) : (
        <MarkdownModeProvider value={textMode}>
          <RevealProvider value={onReveal}>
            <LaneNavProvider entries={model.entries} lanes={model.subagents}>
              <SubagentTimeline model={model} {...(onReveal !== undefined && { onReveal })} />
              <Entries list={model.entries} frames={frames} extras={extras} />
            </LaneNavProvider>
          </RevealProvider>
        </MarkdownModeProvider>
      )}
    </section>
  );
}
