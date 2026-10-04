// F01 T002: the frozen boundary types. Most checks are compile-time (`npm run typecheck`);
// the runtime assertions pin the constants and a representative session round trip.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentCapabilities } from '@ag-ui/core';
import {
  CAPABILITY_GROUPS,
  DEFAULT_AUTH_HEADER,
  FORMAT_VERSION,
  type AgentConfig,
  type ClientProfileSettings,
  type ConfigFile,
  type DerivedEntry,
  type Exchange,
  type Finding,
  type GuardedTransport,
  type InspectionSession,
  type JsonValue,
  type Preset,
  type ProfileEnvelope,
  type RawFrame,
  type RecordedRequest,
  type Recorder,
  type Run,
  type SessionEnvelope,
  type SessionStore,
  type TransportRequest,
  type VolatileAuth,
  type VolatileConnectionState,
  type RenderContainer,
} from '../../src/contracts';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type NoKeys<T, K extends string> = [Extract<keyof T, K>] extends [never] ? true : false;

/** Names that would carry authentication or request/response header state. */
type AuthLike =
  | 'auth' | 'authorization' | 'token' | 'headerName' | 'header' | 'headers'
  | 'requestHeaders' | 'responseHeaders' | 'cookie' | 'cookies' | 'credentials' | 'password' | 'secret';

// Auth state is volatile: no persisted, exported, recorded or configured entity can carry it.
export type PersistedEntitiesCarryNoAuth = [
  Expect<NoKeys<AgentConfig, AuthLike>>,
  Expect<NoKeys<ConfigFile, AuthLike>>,
  Expect<NoKeys<Preset, AuthLike>>,
  Expect<NoKeys<ClientProfileSettings, AuthLike>>,
  Expect<NoKeys<ProfileEnvelope, AuthLike>>,
  Expect<NoKeys<Exchange, AuthLike>>,
  Expect<NoKeys<Run, AuthLike>>,
  Expect<NoKeys<RawFrame, AuthLike>>,
  Expect<NoKeys<Finding, AuthLike>>,
  Expect<NoKeys<DerivedEntry, AuthLike>>,
  Expect<NoKeys<InspectionSession, AuthLike>>,
  Expect<NoKeys<SessionEnvelope, AuthLike>>,
  // The recorder is told about the request but never about headers.
  Expect<NoKeys<RecordedRequest, AuthLike>>,
  Expect<NoKeys<TransportRequest, AuthLike>>,
];

// The volatile state is the only place a token lives, and it is not part of any session.
export type VolatileStateHoldsAuth = Expect<Equal<'auth' extends keyof VolatileConnectionState ? true : false, true>>;
export type SessionHasNoVolatileState = Expect<NoKeys<InspectionSession, keyof VolatileConnectionState>>;

// Transport status and observed protocol outcome are separate facts on separate entities.
export type TransportAndOutcomeAreSeparate = [
  Expect<NoKeys<Exchange, 'outcome'>>,
  Expect<NoKeys<Run, 'transport' | 'transportError' | 'status'>>,
];

// Raw evidence and derived data carry different, explicit provenance.
export type ProvenanceIsExplicit = [
  Expect<Equal<RawFrame['provenance'], 'raw'>>,
  Expect<Equal<DerivedEntry['provenance'], 'derived'>>,
];

// The eleven documented capability groups are exactly the upstream declaration's groups.
export type CapabilityGroupsMatchUpstream = Expect<Equal<(typeof CAPABILITY_GROUPS)[number], keyof AgentCapabilities>>;

// Only the guarded transport accepts credentials, and only as a separate argument.
export type TransportTakesCredentialsSeparately = Expect<
  Equal<Parameters<GuardedTransport['send']>, [request: TransportRequest, auth?: VolatileAuth]>
>;

// Recording is per request: the recorder returns the original response and takes no headers.
export type RecorderReturnsOriginalResponse = Expect<
  Equal<ReturnType<Recorder['record']>, Promise<Response>>
>;

// The store is the framework-free append/update/read/subscribe seam and nothing more.
export type StoreSeamIsFixed = Expect<
  Equal<
    keyof SessionStore,
    'appendExchange' | 'updateExchange' | 'appendFrame' | 'addFinding' | 'upsertRun' | 'appendDerived' | 'snapshot' | 'subscribe'
  >
>;

// JSON values are inert data.
// @ts-expect-error functions are not JSON
export const noFunctions: JsonValue = () => 1;
// @ts-expect-error undefined is not JSON
export const noUndefined: JsonValue = undefined;
// @ts-expect-error class instances are not JSON
export const noDates: JsonValue = new Date();
// @ts-expect-error bigint is not JSON
export const noBigint: JsonValue = 1n;

const frame: RawFrame = {
  id: 'f1',
  exchangeId: 'x1',
  index: 0,
  classification: 'data',
  envelope: 'data: {"type":"RUN_STARTED"}\r\n\r\n',
  data: '{"type":"RUN_STARTED"}',
  offsetMs: 12.5,
  eventType: 'RUN_STARTED',
  summary: 'run started',
  jsonVerdict: 'valid',
  schemaVerdict: 'invalid',
  parsed: { type: 'RUN_STARTED' },
  provenance: 'raw',
};

const session: InspectionSession = {
  id: 's1',
  exchanges: [
    {
      id: 'x1',
      kind: 'conversation',
      runId: 'run-record-1',
      method: 'POST',
      path: '/agents/support/stream',
      requestBody: '{"threadId":"t1"}',
      status: 200,
      startedAt: 1_790_000_000_000,
      elapsedMs: 40,
      transport: 'completed',
      frameIds: ['f1'],
    },
  ],
  runs: [
    {
      id: 'run-record-1',
      threadId: 't1',
      runId: 'r1',
      input: { threadId: 't1', runId: 'r1', state: {}, messages: [], tools: [], context: [], forwardedProps: {} },
      exchangeId: 'x1',
      startedAt: 1_790_000_000_000,
      outcome: { kind: 'unknown' },
    },
  ],
  frames: [frame],
  findings: [{ id: 'n1', kind: 'schema', message: 'schema mismatch', subject: { type: 'frame', id: 'f1' } }],
  derived: [
    {
      id: 'd1',
      provenance: 'derived',
      derivation: 'chunk-expansion',
      sources: ['f1'],
      attribution: 'identified',
      eventType: 'TEXT_MESSAGE_START',
      label: 'expanded from a chunk',
    },
  ],
};

test('format version zero and the default auth header name are fixed', () => {
  assert.equal(FORMAT_VERSION, 0);
  assert.equal(DEFAULT_AUTH_HEADER, 'Authorization');
});

test('eleven capability groups are declared once each', () => {
  assert.equal(CAPABILITY_GROUPS.length, 11);
  assert.equal(new Set(CAPABILITY_GROUPS).size, 11);
});

test('a session envelope is plain JSON that carries no auth or header fields', () => {
  const envelope: SessionEnvelope = { version: FORMAT_VERSION, session };
  const text = JSON.stringify(envelope);
  assert.deepEqual(JSON.parse(text), envelope);
  assert.doesNotMatch(text, /authorization|token|headers?"/i);
  assert.equal(JSON.parse(text).session.frames[0].envelope, frame.envelope, 'raw envelope text survives unchanged');
});

test('a profile envelope holds the seven settings, the three optional automation settings and nothing volatile', () => {
  const settings: ClientProfileSettings = {
    protocolVersion: '1.0',
    tools: [{ name: 'lookup', description: 'Look up', parameters: { type: 'object' } }],
    context: [{ description: 'locale', value: 'fr-FR' }],
    renderA2ui: true,
    injectA2uiTool: false,
    messageMode: 'turn',
    forwardedProps: { user: 'u1' },
    interruptReply: 'resolve',
    interruptPayloads: { approval: { approved: true } },
    toolResults: { lookup: 'found' },
  };
  const envelope: ProfileEnvelope = { version: FORMAT_VERSION, profile: settings };
  assert.deepEqual(Object.keys(envelope.profile).sort(), [
    'context', 'forwardedProps', 'injectA2uiTool', 'interruptPayloads', 'interruptReply', 'messageMode', 'protocolVersion', 'renderA2ui', 'toolResults', 'tools',
  ]);
  assert.doesNotMatch(JSON.stringify(envelope), /authorization|token|headers?"/i);
});

// A plugin renderer draws into an element wherever the DOM types are loaded (spec 014).
export type RenderContainerIsAnElement = Expect<Equal<RenderContainer, HTMLElement>>;
