// Frozen boundary types for the 0.1.0 MVP (specs/001-inspector-mvp/contracts/mvp.md and
// data-model.md). Framework-free: no React imports. Protocol shapes come from the pinned
// @ag-ui/core types; nothing here redefines them. All persisted formats are pre-stable version 0.
//
// Credentials never appear in an entity that is stored, exported, recorded or configured. The only
// type that can hold a token is VolatileConnectionState, which no session or settings type references.
import type {
  AgentCapabilities,
  Context,
  Interrupt,
  ResumeEntry,
  RunAgentInput,
  Tool,
} from '@ag-ui/core';

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** Version of every config, profile and session format in 0.1.0. */
export const FORMAT_VERSION = 0 as const;

/** Header carrying the in-memory token unless the user names another one. */
export const DEFAULT_AUTH_HEADER = 'Authorization';

/** The eleven documented capability groups, in declaration order. */
export const CAPABILITY_GROUPS = [
  'identity',
  'transport',
  'tools',
  'output',
  'state',
  'multiAgent',
  'reasoning',
  'multimodal',
  'execution',
  'humanInTheLoop',
  'custom',
] as const satisfies readonly (keyof AgentCapabilities)[];

// ---------------------------------------------------------------------------------------------
// JSON: inert data only (no functions, undefined, bigint or class instances)
// ---------------------------------------------------------------------------------------------

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

// ---------------------------------------------------------------------------------------------
// Configuration, presets and client profile
// ---------------------------------------------------------------------------------------------

/** Inline declaration of the eleven groups, or a permitted URL to fetch it from. */
export type CapabilitiesSource = AgentCapabilities | string;

export type MessageMode = 'full' | 'turn';

export interface PresetVariable {
  /** Strings may contain `{{name}}` templates; a whole-string JSON variable is inserted as JSON. */
  readonly default: JsonValue;
  /** Missing means text. */
  readonly type?: 'text' | 'json';
}

/** An ordered HTTP request sent before every conversation run or continuation. */
export interface PreparationRequest {
  readonly method: string;
  readonly path: string;
  readonly body?: JsonValue;
}

export interface Preset {
  readonly variables?: Readonly<Record<string, PresetVariable>>;
  readonly forwardedProps?: JsonObject;
  /** Defaults to `full`. */
  readonly messages?: MessageMode;
  readonly prepare?: readonly PreparationRequest[];
  readonly quickMessages?: readonly string[];
}

export interface AgentConfig {
  /** Unique, nonempty. */
  readonly id: string;
  readonly name?: string;
  /** Relative to the page origin when embedded; absolute and allowlisted when hosted. */
  readonly url: string;
  readonly capabilities?: CapabilitiesSource;
  readonly preset?: Preset;
}

/** The ten public theme properties (FR-041): the only names a `theme` map may set. */
export const THEME_PROPERTIES = [
  '--agui-accent',
  '--agui-accent-contrast',
  '--agui-tint-hue',
  '--agui-tint-chroma',
  '--agui-bg',
  '--agui-fg',
  '--agui-radius',
  '--agui-density',
  '--agui-font-sans',
  '--agui-font-mono',
] as const;

export type ThemeProperty = (typeof THEME_PROPERTIES)[number];

/** Values for some public properties; an omitted property keeps its default. */
export type ThemeMap = { readonly [Name in ThemeProperty]?: string };

/** Optional per-mode overrides. Each map applies under the existing automatic or manual light/dark choice. */
export interface ThemeConfig {
  readonly light?: ThemeMap;
  readonly dark?: ThemeMap;
}

/** `version` may be omitted in a historical file and is then read as 0. */
export interface ConfigFile {
  readonly version?: typeof FORMAT_VERSION;
  readonly agents: readonly AgentConfig[];
  readonly theme?: ThemeConfig;
}

/** The seven persisted and exported client-profile settings. */
export interface ClientProfileSettings {
  readonly protocolVersion: string;
  readonly tools: readonly Tool[];
  readonly context: readonly Context[];
  readonly renderA2ui: boolean;
  readonly injectA2uiTool: boolean;
  /** Overrides the preset's mode when set. */
  readonly messageMode?: MessageMode;
  /** Overrides same-named preset properties. */
  readonly forwardedProps: JsonObject;
}

export interface ProfileEnvelope {
  readonly version: typeof FORMAT_VERSION;
  readonly profile: ClientProfileSettings;
}

// ---------------------------------------------------------------------------------------------
// Volatile connection state: memory only, never part of a profile, config, session or export
// ---------------------------------------------------------------------------------------------

export interface VolatileAuth {
  /** Defaults to DEFAULT_AUTH_HEADER. */
  readonly headerName: string;
  readonly token: string;
}

export interface VolatileConnectionState {
  readonly agentId?: string;
  readonly targetUrl?: string;
  /** Cleared on reload and whenever the target changes. */
  readonly auth?: VolatileAuth;
  readonly abortController?: AbortController;
}

// ---------------------------------------------------------------------------------------------
// Transport and recorder seams: headers exist only inside the guarded transport
// ---------------------------------------------------------------------------------------------

export type DeploymentMode = 'embedded' | 'hosted';

/** Fixed at startup; configuration cannot widen it. */
export interface TransportPolicy {
  readonly mode: DeploymentMode;
  readonly pageOrigin: string;
  /** Absolute origins of the explicit deployment allowlist (hosted). */
  readonly allowedOrigins: readonly string[];
  /**
   * The deployer's startup opt-in (hosted only; false when absent): visitor-chosen HTTPS origins and
   * plain HTTP to localhost / 127.0.0.1 on any port. Fixed origins must already be inside that boundary.
   */
  readonly allowVisitorTargets?: boolean;
}

/** The caller says what body to expect; nothing inspects Content-Type or any header. */
export type ResponseKind = 'sse' | 'response';

export interface TransportRequest {
  readonly url: string;
  readonly method: string;
  /** Exact text to send. */
  readonly body?: string;
  readonly responseKind: ResponseKind;
}

export interface GuardedTransport {
  /**
   * Rejects userinfo URLs, disallowed targets and redirects. Credentials arrive separately, are
   * injected here only, and are never visible to the recorder, store, logs or exports.
   */
  send(request: TransportRequest, auth?: VolatileAuth): Promise<Response>;
}

export type ExchangeKind = 'preparation' | 'conversation' | 'raw';

/** What the recorder is told about a request: no headers. */
export interface RecordedRequest {
  readonly kind: ExchangeKind;
  readonly method: string;
  readonly path: string;
  readonly body?: string;
  readonly responseKind: ResponseKind;
  readonly runId?: RunRecordId;
}

export interface Recorder {
  /**
   * Starts an exchange, calls `send`, drains a clone of the response into the store on its own,
   * and resolves with the untouched original response for the protocol client.
   */
  record(request: RecordedRequest, send: () => Promise<Response>): Promise<Response>;
}

// ---------------------------------------------------------------------------------------------
// Inspection entities
// ---------------------------------------------------------------------------------------------

export type ExchangeId = string;
export type FrameId = string;
export type FindingId = string;
export type RunRecordId = string;
export type DerivedId = string;

/** created, sending, then streaming or reading, then one terminal state. */
export type TransportState =
  | 'created'
  | 'sending'
  | 'streaming'
  | 'reading'
  | 'completed'
  | 'transport-error'
  | 'user-stopped';

/** A request and what the transport did with it. Says nothing about the protocol outcome. */
export interface Exchange {
  readonly id: ExchangeId;
  readonly kind: ExchangeKind;
  readonly runId?: RunRecordId;
  readonly method: string;
  readonly path: string;
  /** Exact request-body text as sent. */
  readonly requestBody?: string;
  /** Companion for inspection only. */
  readonly requestBodyJson?: JsonValue;
  readonly status?: number;
  /** Non-event-stream response body, retained as evidence. */
  readonly responseBody?: string;
  /** Wall-clock start, epoch milliseconds. */
  readonly startedAt: number;
  readonly elapsedMs?: number;
  readonly transport: TransportState;
  readonly transportError?: string;
  /** Frames in arrival order. */
  readonly frameIds: readonly FrameId[];
}

/** `data` frames count toward retained-frame totals; control and partial evidence do not. */
export type FrameClassification = 'data' | 'control' | 'partial';
export type JsonVerdict = 'valid' | 'invalid' | 'not-applicable';
export type SchemaVerdict = 'valid' | 'invalid' | 'unknown-type' | 'not-applicable';

/** Append-only wire evidence. Findings live beside it and never mutate it. */
export interface RawFrame {
  readonly id: FrameId;
  readonly exchangeId: ExchangeId;
  /** Zero-based arrival index within the exchange. */
  readonly index: number;
  readonly classification: FrameClassification;
  /** Original envelope text including delimiters. */
  readonly envelope: string;
  /** Extracted SSE data text; absent for control-only or partial evidence. */
  readonly data?: string;
  /** Monotonic milliseconds from request dispatch to completion of this envelope. */
  readonly offsetMs: number;
  /** Event type when identifiable; a string because unknown types are retained. */
  readonly eventType?: string;
  readonly summary: string;
  readonly jsonVerdict: JsonVerdict;
  readonly schemaVerdict: SchemaVerdict;
  readonly parsed?: JsonValue;
  readonly provenance: 'raw';
}

export type FindingKind = 'json' | 'schema' | 'sequence' | 'terminal' | 'transport' | 'capture' | 'projection';

export type FindingSubject =
  | { readonly type: 'frame'; readonly id: FrameId }
  | { readonly type: 'run'; readonly id: RunRecordId }
  | { readonly type: 'exchange'; readonly id: ExchangeId };

export interface Finding {
  readonly id: FindingId;
  readonly kind: FindingKind;
  readonly message: string;
  readonly subject: FindingSubject;
}

/** What the stream showed. `unknown` when it ended without a terminal event; never fabricated. */
export type ObservedOutcome =
  | { readonly kind: 'success'; readonly result?: JsonValue; readonly pendingToolCallIds: readonly string[] }
  | { readonly kind: 'interrupt'; readonly interrupts: readonly Interrupt[] }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'error'; readonly message: string; readonly code?: string }
  | { readonly kind: 'unknown' };

/** A conversation run. Its outcome is independent of its exchange's transport state. */
export interface Run {
  readonly id: RunRecordId;
  readonly threadId: string;
  readonly runId: string;
  readonly parentRunId?: string;
  /** Recorded input as sent. */
  readonly input: RunAgentInput;
  readonly exchangeId: ExchangeId;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly outcome: ObservedOutcome;
}

export type DerivationKind = 'client-state' | 'chunk-expansion' | 'duration' | 'projection';

/** Client-derived data. It never carries a frame index and never replaces received evidence. */
export interface DerivedEntry {
  readonly id: DerivedId;
  readonly provenance: 'derived';
  readonly derivation: DerivationKind;
  /** Source raw frames where identifiable. */
  readonly sources: readonly FrameId[];
  /** `ambiguous` when the source frame cannot be attributed with confidence. */
  readonly attribution: 'identified' | 'ambiguous';
  readonly eventType: string;
  readonly label: string;
  readonly value?: JsonValue;
}

/** In-memory capture. Exchanges are newest-last in storage; views present them newest first. */
export interface InspectionSession {
  readonly id: string;
  readonly exchanges: readonly Exchange[];
  readonly runs: readonly Run[];
  readonly frames: readonly RawFrame[];
  readonly findings: readonly Finding[];
  readonly derived: readonly DerivedEntry[];
}

export interface SessionEnvelope {
  readonly version: typeof FORMAT_VERSION;
  readonly session: InspectionSession;
}

// ---------------------------------------------------------------------------------------------
// Replies and actions
// ---------------------------------------------------------------------------------------------

export type InterruptAnswerStatus = 'unanswered' | 'resolved' | 'cancelled';

export interface InterruptAnswer {
  readonly runId: RunRecordId;
  readonly interruptId: string;
  readonly responseSchema?: JsonObject;
  readonly draft: JsonValue;
  readonly status: InterruptAnswerStatus;
}

/** The upstream resume entry; nothing is invented for Resolve or Cancel. */
export type ResumeAnswer = ResumeEntry;

export interface ToolResultDraft {
  readonly runId: RunRecordId;
  readonly toolCallId: string;
  readonly toolName: string;
  /** Streamed argument fragments joined as text. */
  readonly argumentsText: string;
  readonly argumentsParsed?: JsonValue;
  readonly argumentsError?: string;
  readonly resultDraft: string;
  readonly status: 'pending' | 'answered';
}

/** Carried unchanged in forwardedProps.a2uiAction.userAction. */
export interface A2uiAction {
  readonly name: string;
  readonly surfaceId: string;
  readonly sourceComponentId: string;
  readonly context: JsonObject;
  /** From the renderer's action. */
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------------------------
// Store: framework-free; every append is immediate, notifications are batched per animation frame
// ---------------------------------------------------------------------------------------------

export type ExchangePatch = Partial<Omit<Exchange, 'id' | 'frameIds'>>;
export type Unsubscribe = () => void;

/** Injected so tests need no browser: normally requestAnimationFrame. */
export type Scheduler = (callback: () => void) => void;

export interface SessionStore {
  appendExchange(exchange: Exchange): void;
  updateExchange(id: ExchangeId, patch: ExchangePatch): void;
  appendFrame(frame: RawFrame): void;
  addFinding(finding: Finding): void;
  upsertRun(run: Run): void;
  appendDerived(entry: DerivedEntry): void;
  snapshot(): InspectionSession;
  /** Called at most once per scheduled frame, however many appends occurred. */
  subscribe(listener: () => void): Unsubscribe;
}

export type ImportResult =
  | { readonly ok: true; readonly session: InspectionSession }
  | { readonly ok: false; readonly error: string };

// ---------------------------------------------------------------------------------------------
// React entry seams: fixed exports that take typed data and callbacks, found by direct import
// ---------------------------------------------------------------------------------------------

export interface SettingsViewProps {
  readonly agents: readonly AgentConfig[];
  readonly selectedAgentId?: string;
  readonly profile: ClientProfileSettings;
  readonly variables: Readonly<Record<string, JsonValue>>;
  readonly error?: string;
  onSelectAgent(agentId: string): void;
  onChangeProfile(profile: ClientProfileSettings): void;
  onChangeVariable(name: string, value: JsonValue): void;
  onImportProfile(text: string): void;
  onExportProfile(): void;
}

export interface ConnectionViewProps {
  readonly connection: VolatileConnectionState;
  readonly running: boolean;
  readonly quickMessages: readonly string[];
  readonly error?: string;
  onChangeTarget(url: string): void;
  onChangeAuth(auth: VolatileAuth | undefined): void;
  /** Ordinary conversation message, including quick messages. */
  onSend(text: string): void;
  /** Transport/user control, not a protocol answer. */
  onStop(): void;
  onNewThread(): void;
}

export interface ConversationViewProps {
  readonly store: SessionStore;
  readonly interrupts: readonly InterruptAnswer[];
  readonly toolResults: readonly ToolResultDraft[];
  onDraftInterrupt(interruptId: string, draft: JsonValue): void;
  onAnswerInterrupt(interruptId: string, status: 'resolved' | 'cancelled'): void;
  onDraftToolResult(toolCallId: string, result: string): void;
  onSubmitToolResult(toolCallId: string): void;
  /** Only meaningful once every interrupt and tool result is answered. */
  onContinue(): void;
}

export interface InspectionViewProps {
  readonly store: SessionStore;
  readonly error?: string;
  /** Sends exactly the entered text outside the conversation. */
  onSendRaw(text: string): void;
  /** The view shows the sensitive-data warning before calling this. */
  onExportSession(): void;
  onImportSession(text: string): void;
}

export interface A2uiViewProps {
  readonly activityId: string;
  /** The activity content's `a2ui_operations`. */
  readonly operations: JsonValue;
  /** When false the operations stay inspectable as JSON. */
  readonly renderEnabled: boolean;
  onAction(action: A2uiAction): void;
}

export interface AppProps {
  readonly settings: SettingsViewProps;
  readonly connection: ConnectionViewProps;
  readonly conversation: ConversationViewProps;
  readonly inspection: InspectionViewProps;
}
