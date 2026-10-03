// Session files: the version-0 export and the inspect-only import. Framework-free.
//
// Export writes an explicit list of fields for every record, so nothing outside the contract can
// reach a file, whatever an in-memory object happens to carry. Headers and credentials have no
// field in any record, and the connection state (target, token, abort controller) is never read.
// Import checks the whole file first, in memory, and only then builds a fresh store from it; a file
// that fails any check changes nothing, and neither step makes a request.
//
// The format is pre-stable (docs/recordings.md). Nothing here redacts or rewrites received bytes:
// frame text goes to the file exactly as the store holds it.
import { InterruptSchema, RunAgentInputSchema } from '@ag-ui/core/schemas';
import {
  FORMAT_VERSION,
  type DerivedEntry,
  type Exchange,
  type Finding,
  type ImportResult,
  type InspectionSession,
  type RawFrame,
  type Run,
  type SessionEnvelope,
  type SessionStore,
} from '../../contracts.ts';
import { checkEvent, type EventCheck } from '../frames/index.ts';
import { createSessionStore, type SessionStoreOptions } from '../store/index.ts';

/** Suggested name for the downloaded file. */
export const SESSION_FILE_NAME = 'agui-inspector-session.json';

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

const exchangeOut = (e: Exchange): Exchange => ({
  id: e.id,
  kind: e.kind,
  ...(e.runId !== undefined && { runId: e.runId }),
  method: e.method,
  path: e.path,
  ...(e.requestBody !== undefined && { requestBody: e.requestBody }),
  ...(e.requestBodyJson !== undefined && { requestBodyJson: e.requestBodyJson }),
  ...(e.status !== undefined && { status: e.status }),
  ...(e.responseBody !== undefined && { responseBody: e.responseBody }),
  startedAt: e.startedAt,
  ...(e.elapsedMs !== undefined && { elapsedMs: e.elapsedMs }),
  transport: e.transport,
  ...(e.transportError !== undefined && { transportError: e.transportError }),
  frameIds: e.frameIds,
});

const runOut = (r: Run): Run => ({
  id: r.id,
  threadId: r.threadId,
  runId: r.runId,
  ...(r.parentRunId !== undefined && { parentRunId: r.parentRunId }),
  input: r.input,
  exchangeId: r.exchangeId,
  startedAt: r.startedAt,
  ...(r.endedAt !== undefined && { endedAt: r.endedAt }),
  outcome: r.outcome,
});

const frameOut = (f: RawFrame): RawFrame => ({
  id: f.id,
  exchangeId: f.exchangeId,
  index: f.index,
  classification: f.classification,
  envelope: f.envelope,
  ...(f.data !== undefined && { data: f.data }),
  offsetMs: f.offsetMs,
  ...(f.eventType !== undefined && { eventType: f.eventType }),
  summary: f.summary,
  jsonVerdict: f.jsonVerdict,
  schemaVerdict: f.schemaVerdict,
  ...(f.parsed !== undefined && { parsed: f.parsed }),
  provenance: f.provenance,
});

const findingOut = (f: Finding): Finding => ({ id: f.id, kind: f.kind, message: f.message, subject: { type: f.subject.type, id: f.subject.id } });

const derivedOut = (d: DerivedEntry): DerivedEntry => ({
  id: d.id,
  provenance: d.provenance,
  derivation: d.derivation,
  sources: d.sources,
  attribution: d.attribution,
  eventType: d.eventType,
  label: d.label,
  ...(d.value !== undefined && { value: d.value }),
});

/** The file text for a session: a version-0 envelope, two-space indented, records in capture order. */
export function serializeSession(session: InspectionSession): string {
  const envelope: SessionEnvelope = {
    version: FORMAT_VERSION,
    session: {
      id: session.id,
      exchanges: session.exchanges.map(exchangeOut),
      runs: session.runs.map(runOut),
      frames: session.frames.map(frameOut),
      findings: session.findings.map(findingOut),
      derived: session.derived.map(derivedOut),
    },
  };
  return JSON.stringify(envelope, null, 2);
}

// ---------------------------------------------------------------------------------------------
// Import: validate the whole file, then build a store from it
// ---------------------------------------------------------------------------------------------

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

type Record_ = { readonly [key: string]: unknown };
const isObject = (value: unknown): value is Record_ => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A record field that would carry a header or a credential has no place in a session. */
const CREDENTIAL_FIELD = /header|authorization|cookie|credential|token|auth/i;

const EXCHANGE_KINDS = ['preparation', 'conversation', 'raw'];
const TRANSPORT_STATES = ['created', 'sending', 'streaming', 'reading', 'completed', 'transport-error', 'user-stopped'];
const CLASSIFICATIONS = ['data', 'control', 'partial'];
const JSON_VERDICTS = ['valid', 'invalid', 'not-applicable'];
const SCHEMA_VERDICTS = ['valid', 'invalid', 'unknown-type', 'not-applicable'];
const FINDING_KINDS = ['json', 'schema', 'sequence', 'terminal', 'transport', 'capture', 'projection'];
const SUBJECT_TYPES = ['frame', 'run', 'exchange'];
const DERIVATIONS = ['client-state', 'chunk-expansion', 'duration', 'projection'];
const ATTRIBUTIONS = ['identified', 'ambiguous'];

/** A record of the given shape: required and optional keys, nothing else. */
function record(value: unknown, at: string, required: readonly string[], optional: readonly string[] = []): Record_ {
  if (!isObject(value)) return fail(`${at} must be an object`);
  for (const key of Object.keys(value)) {
    if (required.includes(key) || optional.includes(key)) continue;
    fail(CREDENTIAL_FIELD.test(key) ? `${at}: header or credential field "${key}" is not allowed in a session` : `${at}: unknown field "${key}"`);
  }
  for (const key of required) if (!(key in value)) fail(`${at}: missing "${key}"`);
  return value;
}

const text = (value: unknown, at: string, field: string, options: { empty?: boolean } = {}): string => {
  if (typeof value !== 'string' || (value === '' && !options.empty)) return fail(`${at}: ${field} must be ${options.empty ? 'a string' : 'a nonempty string'}`);
  return value;
};
const optionalText = (source: Record_, at: string, field: string, options: { empty?: boolean } = {}) => {
  if (source[field] !== undefined) text(source[field], at, field, options);
};
const oneOf = (value: unknown, allowed: readonly string[], at: string, field: string) => {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(`${at}: ${field} must be one of ${allowed.join(', ')}`);
};
const time = (value: unknown, at: string, field: string): number => {
  if (!isNumber(value) || value < 0) return fail(`${at}: ${field} must be a finite number of 0 or more`);
  return value;
};
const list = (value: unknown, at: string): readonly unknown[] => {
  if (!Array.isArray(value)) return fail(`${at} must be an array`);
  return value;
};
const stringList = (value: unknown, at: string, field: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return fail(`${at}: ${field} must be an array of strings`);
  return value as string[];
};

/** Ids are unique within a collection. */
function unique<T extends { id: string }>(items: readonly T[], collection: string): Map<string, T> {
  const byId = new Map<string, T>();
  items.forEach((item, position) => {
    if (byId.has(item.id)) fail(`${collection}[${position}]: duplicate id "${item.id}"`);
    byId.set(item.id, item);
  });
  return byId;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The live reader's own schema check. A check that fails to run confirms nothing, so it counts as a miss. */
function checkParsed(parsed: unknown): EventCheck {
  try {
    return checkEvent(parsed);
  } catch {
    return { verdict: 'invalid', problems: ['the schema check could not run on this data'] };
  }
}

const URL_USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i;

function checkExchange(value: unknown, position: number): Exchange {
  const at = `exchanges[${position}]`;
  const e = record(
    value,
    at,
    ['id', 'kind', 'method', 'path', 'startedAt', 'transport', 'frameIds'],
    ['runId', 'requestBody', 'requestBodyJson', 'status', 'responseBody', 'elapsedMs', 'transportError'],
  );
  text(e.id, at, 'id');
  oneOf(e.kind, EXCHANGE_KINDS, at, 'kind');
  optionalText(e, at, 'runId');
  text(e.method, at, 'method');
  const path = text(e.path, at, 'path', { empty: true });
  if (URL_USERINFO.test(path)) fail(`${at}: path contains credentials`);
  optionalText(e, at, 'requestBody', { empty: true });
  if (e.requestBodyJson !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(e.requestBody));
    } catch {
      return fail(`${at}: requestBodyJson has no matching valid JSON in requestBody`);
    }
    if (!sameJson(parsed, e.requestBodyJson)) fail(`${at}: requestBodyJson does not match requestBody`);
  }
  if (e.status !== undefined && (!Number.isInteger(e.status) || (e.status as number) < 100 || (e.status as number) > 599)) fail(`${at}: status must be an HTTP status code`);
  optionalText(e, at, 'responseBody', { empty: true });
  time(e.startedAt, at, 'startedAt');
  if (e.elapsedMs !== undefined) time(e.elapsedMs, at, 'elapsedMs');
  oneOf(e.transport, TRANSPORT_STATES, at, 'transport');
  optionalText(e, at, 'transportError', { empty: true });
  stringList(e.frameIds, at, 'frameIds');
  return e as unknown as Exchange;
}

function checkFrame(value: unknown, position: number): RawFrame {
  const at = `frames[${position}]`;
  const f = record(
    value,
    at,
    ['id', 'exchangeId', 'index', 'classification', 'envelope', 'offsetMs', 'summary', 'jsonVerdict', 'schemaVerdict', 'provenance'],
    ['data', 'eventType', 'parsed'],
  );
  text(f.id, at, 'id');
  text(f.exchangeId, at, 'exchangeId');
  if (!Number.isInteger(f.index) || (f.index as number) < 0) fail(`${at}: index must be a whole number of 0 or more`);
  oneOf(f.classification, CLASSIFICATIONS, at, 'classification');
  text(f.envelope, at, 'envelope', { empty: true });
  time(f.offsetMs, at, 'offsetMs');
  optionalText(f, at, 'eventType', { empty: true });
  text(f.summary, at, 'summary', { empty: true });
  oneOf(f.jsonVerdict, JSON_VERDICTS, at, 'jsonVerdict');
  oneOf(f.schemaVerdict, SCHEMA_VERDICTS, at, 'schemaVerdict');
  if (f.provenance !== 'raw') fail(`${at}: provenance must be "raw"`);

  if (f.classification === 'data') {
    const data = text(f.data, at, 'data', { empty: true });
    let parsed: unknown;
    let parses = true;
    try {
      parsed = JSON.parse(data);
    } catch {
      parses = false;
    }
    if (parses !== (f.jsonVerdict === 'valid') || (!parses && f.jsonVerdict !== 'invalid')) fail(`${at}: jsonVerdict "${String(f.jsonVerdict)}" does not match the data text`);
    if (parses) {
      if (f.parsed === undefined || !sameJson(parsed, f.parsed)) fail(`${at}: parsed does not match data`);
      // The conversation is projected from frames filed as `valid`, so the schema has to agree. Frames it
      // rejects, and unknown types, are kept as recorded under their own verdicts.
      if (f.schemaVerdict === 'valid') {
        const { verdict, problems } = checkParsed(parsed);
        if (verdict !== 'valid') {
          fail(
            `${at}: schemaVerdict "valid" contradicts the data (${problems.join('; ')}). The inspector files a frame the schema rejects as "invalid" and an unknown event type as "unknown-type". Re-export the recording from the inspector that captured it, or correct the verdict if the file was edited.`,
          );
        }
      }
    } else {
      if (f.parsed !== undefined) fail(`${at}: parsed is present but data is not valid JSON`);
      if (f.schemaVerdict !== 'not-applicable') fail(`${at}: schemaVerdict must be "not-applicable" for data that is not JSON`);
    }
  } else {
    if (f.data !== undefined) fail(`${at}: data must be absent unless classification is "data"`);
    if (f.parsed !== undefined) fail(`${at}: parsed must be absent unless classification is "data"`);
    if (f.jsonVerdict !== 'not-applicable' || f.schemaVerdict !== 'not-applicable') fail(`${at}: verdicts must be "not-applicable" for ${String(f.classification)} evidence`);
  }
  return f as unknown as RawFrame;
}

function checkOutcome(value: unknown, at: string) {
  const kind = isObject(value) ? value.kind : undefined;
  switch (kind) {
    case 'success': {
      const outcome = record(value, `${at}: outcome`, ['kind', 'pendingToolCallIds'], ['result']);
      stringList(outcome.pendingToolCallIds, `${at}: outcome`, 'pendingToolCallIds');
      return;
    }
    case 'interrupt': {
      const outcome = record(value, `${at}: outcome`, ['kind', 'interrupts']);
      if (list(outcome.interrupts, `${at}: outcome.interrupts`).some((entry) => !InterruptSchema.safeParse(entry).success)) fail(`${at}: outcome.interrupts holds an entry that is not an interrupt`);
      return;
    }
    case 'cancelled':
    case 'unknown':
      record(value, `${at}: outcome`, ['kind']);
      return;
    case 'error': {
      const outcome = record(value, `${at}: outcome`, ['kind', 'message'], ['code']);
      text(outcome.message, `${at}: outcome`, 'message', { empty: true });
      optionalText(outcome, `${at}: outcome`, 'code', { empty: true });
      return;
    }
    default:
      fail(`${at}: outcome.kind must be one of success, interrupt, cancelled, error, unknown`);
  }
}

function checkRun(value: unknown, position: number): Run {
  const at = `runs[${position}]`;
  const r = record(value, at, ['id', 'threadId', 'runId', 'input', 'exchangeId', 'startedAt', 'outcome'], ['parentRunId', 'endedAt']);
  text(r.id, at, 'id');
  text(r.threadId, at, 'threadId');
  text(r.runId, at, 'runId');
  optionalText(r, at, 'parentRunId');
  if (!isObject(r.input) || !RunAgentInputSchema.safeParse(r.input).success) fail(`${at}: input is not a run input`);
  text(r.exchangeId, at, 'exchangeId');
  const startedAt = time(r.startedAt, at, 'startedAt');
  if (r.endedAt !== undefined && time(r.endedAt, at, 'endedAt') < startedAt) fail(`${at}: endedAt is before startedAt`);
  checkOutcome(r.outcome, at);
  return r as unknown as Run;
}

function checkFinding(value: unknown, position: number): Finding {
  const at = `findings[${position}]`;
  const f = record(value, at, ['id', 'kind', 'message', 'subject']);
  text(f.id, at, 'id');
  oneOf(f.kind, FINDING_KINDS, at, 'kind');
  text(f.message, at, 'message', { empty: true });
  const subject = record(f.subject, `${at}: subject`, ['type', 'id']);
  oneOf(subject.type, SUBJECT_TYPES, `${at}: subject`, 'type');
  text(subject.id, `${at}: subject`, 'id');
  return f as unknown as Finding;
}

function checkDerived(value: unknown, position: number): DerivedEntry {
  const at = `derived[${position}]`;
  const d = record(value, at, ['id', 'provenance', 'derivation', 'sources', 'attribution', 'eventType', 'label'], ['value']);
  text(d.id, at, 'id');
  if (d.provenance !== 'derived') fail(`${at}: provenance must be "derived"`);
  oneOf(d.derivation, DERIVATIONS, at, 'derivation');
  stringList(d.sources, at, 'sources');
  oneOf(d.attribution, ATTRIBUTIONS, at, 'attribution');
  text(d.eventType, at, 'eventType', { empty: true });
  text(d.label, at, 'label', { empty: true });
  return d as unknown as DerivedEntry;
}

function checkSession(value: unknown): InspectionSession {
  const s = record(value, 'session', ['id', 'exchanges', 'runs', 'frames', 'findings', 'derived']);
  text(s.id, 'session', 'id');
  const exchanges = list(s.exchanges, 'session.exchanges').map(checkExchange);
  const runs = list(s.runs, 'session.runs').map(checkRun);
  const frames = list(s.frames, 'session.frames').map(checkFrame);
  const findings = list(s.findings, 'session.findings').map(checkFinding);
  const derived = list(s.derived, 'session.derived').map(checkDerived);

  const exchangeById = unique(exchanges, 'exchanges');
  const runById = unique(runs, 'runs');
  const frameById = unique(frames, 'frames');
  unique(findings, 'findings');
  unique(derived, 'derived');

  runs.forEach((run, position) => {
    if (!exchangeById.has(run.exchangeId)) fail(`runs[${position}]: exchange "${run.exchangeId}" is not in the file`);
  });

  // Every frame belongs to the exchange it names, in arrival order, with offsets that never go back.
  const arrived = new Map<string, { count: number; lastOffsetMs: number }>();
  frames.forEach((frame, position) => {
    if (!exchangeById.has(frame.exchangeId)) fail(`frames[${position}]: exchange "${frame.exchangeId}" is not in the file`);
    const seen = arrived.get(frame.exchangeId) ?? { count: 0, lastOffsetMs: 0 };
    if (frame.index !== seen.count) fail(`frames[${position}]: index ${frame.index}, expected ${seen.count}`);
    if (frame.offsetMs < seen.lastOffsetMs) fail(`frames[${position}]: offsetMs ${frame.offsetMs} is earlier than the previous frame's ${seen.lastOffsetMs}; offsets must not go backwards`);
    arrived.set(frame.exchangeId, { count: seen.count + 1, lastOffsetMs: frame.offsetMs });
  });

  // An exchange lists exactly its own frames, in the order they arrived.
  const own = new Map<string, string[]>();
  for (const frame of frames) {
    const ids = own.get(frame.exchangeId);
    if (ids) ids.push(frame.id);
    else own.set(frame.exchangeId, [frame.id]);
  }
  exchanges.forEach((exchange, position) => {
    exchange.frameIds.forEach((id) => {
      const frame = frameById.get(id);
      if (!frame) fail(`exchanges[${position}]: frameIds lists "${id}", which is not in the file`);
      else if (frame.exchangeId !== exchange.id) fail(`exchanges[${position}]: frameIds lists "${id}", which belongs to exchange "${frame.exchangeId}"`);
    });
    const expected = own.get(exchange.id) ?? [];
    const missing = expected.find((id, at) => exchange.frameIds[at] !== id);
    if (missing !== undefined || exchange.frameIds.length !== expected.length) {
      fail(`exchanges[${position}]: frameIds must list the exchange's frames in arrival order; frame "${missing ?? expected[0] ?? '?'}" is not listed in its place`);
    }
  });

  findings.forEach((finding, position) => {
    const { type, id } = finding.subject;
    const known = type === 'frame' ? frameById.has(id) : type === 'run' ? runById.has(id) : exchangeById.has(id);
    if (!known) fail(`findings[${position}]: ${type} "${id}" is not in the file`);
  });

  derived.forEach((entry, position) => {
    for (const source of entry.sources) if (!frameById.has(source)) fail(`derived[${position}]: source frame "${source}" is not in the file`);
    if (entry.attribution === 'identified' && entry.sources.length === 0) fail(`derived[${position}]: an identified entry must name a source frame`);
  });

  return s as unknown as InspectionSession;
}

/**
 * Checks a session file end to end. Nothing is built or kept unless every check passes, and the
 * error names the first thing wrong. The text is only read: no request is made.
 */
export function parseSession(fileText: string): ImportResult {
  try {
    let file: unknown;
    try {
      file = JSON.parse(fileText);
    } catch {
      return fail('The file is not valid JSON.');
    }
    if (!isObject(file)) return fail('The file is not a session envelope: expected a JSON object with a version and a session.');
    if (!('version' in file)) return fail('The file has no version. Session files are version 0.');
    if (file.version !== FORMAT_VERSION) {
      return fail(typeof file.version === 'number' ? `Unsupported version ${file.version}: this build reads version ${FORMAT_VERSION} only.` : `The version must be the number ${FORMAT_VERSION}.`);
    }
    const envelope = record(file, 'The envelope', ['version', 'session']);
    return { ok: true, session: checkSession(envelope.session) };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Opens a validated session as an inspect-only store. It is a new store, so the session being
 * viewed is untouched until the caller swaps it in, and the store's own invariants hold again.
 */
export function restoreSession(session: InspectionSession, options: SessionStoreOptions = {}): SessionStore {
  const store = createSessionStore({ id: session.id, ...options });
  for (const exchange of session.exchanges) store.appendExchange({ ...exchange, frameIds: [] });
  for (const run of session.runs) store.upsertRun(run);
  for (const frame of session.frames) store.appendFrame(frame);
  for (const finding of session.findings) store.addFinding(finding);
  for (const entry of session.derived) store.appendDerived(entry);
  return store;
}

