// Rules that read one parsed frame: capability consistency and the older event shapes the client accepts.
// Framework-free: no React, nothing but plain data.
//
// Nothing here changes a frame. The reader hands these functions the parsed value it already holds and gets
// back what applies; the frame, its text and its parsed value stay exactly as they arrived.
import { EventType, PROTOCOL_VERSION, type AgentCapabilities } from '@ag-ui/core';
import type { CatalogueRuleId } from './catalogue.ts';

export interface RuleHit {
  readonly rule: CatalogueRuleId;
  readonly message: string;
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------------------------
// Capability consistency
// ---------------------------------------------------------------------------------------------

/** The five event types that the protocol client still reads as `REASONING_*` events, and what it reads them as. */
const RETIRED_THINKING: Readonly<Record<string, string>> = {
  THINKING_START: 'REASONING_START',
  THINKING_END: 'REASONING_END',
  THINKING_TEXT_MESSAGE_START: 'REASONING_MESSAGE_START',
  THINKING_TEXT_MESSAGE_CONTENT: 'REASONING_MESSAGE_CONTENT',
  THINKING_TEXT_MESSAGE_END: 'REASONING_MESSAGE_END',
};

/** Every reasoning event of the baseline, and the retired types that the client reads as them. Fixed lists, so a hostile type name never reaches a message. */
const REASONING_TYPES: ReadonlySet<string> = new Set([...Object.values(EventType).filter((type) => type.startsWith('REASONING_')), ...Object.keys(RETIRED_THINKING)]);

/**
 * The capability rules that a frame breaks. A rule fires only when the agent declares its flag as exactly `false`:
 * an omitted flag means "not declared", not "unsupported". The event type is read whether or not the rest of the
 * event is valid, and a retired `THINKING_*` type counts as the reasoning event the client reads it as.
 */
export function capabilityRules(event: unknown, declared: AgentCapabilities | undefined): RuleHit[] {
  if (declared === undefined || !isObject(event) || typeof event.type !== 'string') return [];
  const { type } = event;
  const hits: RuleHit[] = [];
  const contradicts = (rule: CatalogueRuleId, what: string, flag: string) => hits.push({ rule, message: `${what} came from an agent that declares ${flag}: false` });

  if (declared.reasoning?.supported === false && REASONING_TYPES.has(type)) {
    contradicts('capability.reasoning-unsupported', type, 'reasoning.supported');
  }
  if (declared.humanInTheLoop?.interrupts === false && type === 'RUN_FINISHED' && isObject(event.outcome) && event.outcome.type === 'interrupt') {
    contradicts('capability.interrupt-unsupported', 'RUN_FINISHED with an interrupt outcome', 'humanInTheLoop.interrupts');
  }
  if (declared.state?.deltas === false && type === 'STATE_DELTA') contradicts('capability.state-delta-unsupported', type, 'state.deltas');
  if (declared.state?.snapshots === false && type === 'STATE_SNAPSHOT') contradicts('capability.state-snapshot-unsupported', type, 'state.snapshots');
  return hits;
}

// ---------------------------------------------------------------------------------------------
// The older event versions the client accepts
// ---------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

interface Upgraded {
  /** The same object when nothing applied, otherwise a copy. The frame's own parsed value is never changed. */
  readonly value: unknown;
  /** One finding for each compat rule that applied, plus the protocol version rule. */
  readonly hits: readonly RuleHit[];
}

const MEDIA_PARTS: ReadonlySet<string> = new Set(['image', 'audio', 'video', 'document']);
const MAX_PATHS = 5;

/** Placeholder for the id that the client mints for a converted THINKING event. It exists so the schema can judge the rest. */
const PLACEHOLDER_ID = 'upgraded-thinking-event';

/** A copy of `source` without the key. */
const without = (source: Json, key: string): Json => {
  const { [key]: _removed, ...rest } = source;
  return rest;
};

/**
 * What the pinned protocol client does to an event before it handles it, on a copy, and which compat rules that
 * touches. It mirrors `CompatibilityBoundary` of @ag-ui/client 1.0.1 (the client's own method for one event is
 * private and prints a console warning for every upgrade), and tests/rules/compat.test.ts plays every shape through
 * the real client and fails on any difference, so this copy cannot drift from the client unseen. A bump of the pinned
 * client has to pass that test again.
 *
 * Nested data is reached only along the client's own paths (the echoed run input, and the messages of a snapshot),
 * with loops and no recursion, so a deep value costs nothing.
 */
export function upgradeFrame(parsed: unknown): Upgraded {
  const hits: RuleHit[] = [];
  if (!isObject(parsed) || typeof parsed.type !== 'string') return { value: parsed, hits };
  const type = parsed.type;
  let event: Json = parsed;
  const nulls: string[] = [];
  const binaries: string[] = [];

  const setNull = (target: Json, key: string, path: string): Json => {
    if (target[key] !== null) return target;
    nulls.push(path);
    return without(target, key);
  };

  /** A media part loses `metadata: null`. */
  const upgradePart = (part: unknown, path: string): unknown => (isObject(part) && typeof part.type === 'string' && MEDIA_PARTS.has(part.type) ? setNull(part, 'metadata', `${path}.metadata`) : part);

  /** `binary` becomes a media part from its MIME type, unless the same part is already in the list. */
  const convertBinary = (part: Json): Json | undefined => {
    const mimeType = part.mimeType as string;
    const kind = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : 'document';
    const source = part.data ? { type: 'data', value: part.data, mimeType } : part.url ? { type: 'url', value: part.url, mimeType } : undefined;
    return source === undefined ? undefined : { type: kind, source, ...(part.filename ? { metadata: { filename: part.filename } } : {}) };
  };
  const sameMedia = (candidate: unknown, converted: Json, filename: unknown): boolean => {
    if (!isObject(candidate) || candidate.type !== converted.type || !isObject(candidate.source)) return false;
    const want = converted.source as Json;
    if (candidate.source.type !== want.type || candidate.source.value !== want.value || candidate.source.mimeType !== want.mimeType) return false;
    return !filename || (isObject(candidate.metadata) && candidate.metadata.filename === filename);
  };

  /** One message: media metadata nulls first, then binary parts. */
  const upgradeMessage = (message: unknown, path: string): unknown => {
    if (!isObject(message) || !Array.isArray(message.content)) return message;
    let content: unknown[] = message.content;
    let changed = false;
    content = content.map((part, index) => {
      const next = upgradePart(part, `${path}.content[${index}]`);
      if (next !== part) changed = true;
      return next;
    });
    const original = content;
    const out: unknown[] = [];
    let converting = false;
    original.forEach((part, index) => {
      if (!(isObject(part) && part.type === 'binary' && typeof part.mimeType === 'string')) return void out.push(part);
      const converted = convertBinary(part);
      // A binary part with neither data nor url cannot be converted. The client keeps it, and rejects it later.
      if (converted === undefined) return void out.push(part);
      converting = true;
      binaries.push(`${path}.content[${index}]`);
      if (!original.some((other) => sameMedia(other, converted, part.filename))) out.push(converted);
    });
    if (converting) {
      content = out;
      changed = true;
    }
    return changed ? { ...message, content } : message;
  };

  const upgradeMessages = (holder: Json, path: string): Json => {
    if (!Array.isArray(holder.messages)) return holder;
    let changed = false;
    const messages = holder.messages.map((message, index) => {
      const next = upgradeMessage(message, `${path}.messages[${index}]`);
      if (next !== message) changed = true;
      return next;
    });
    return changed ? { ...holder, messages } : holder;
  };

  const upgradeInput = (input: Json, path: string): Json => {
    let next = setNull(input, 'forwardedProps', `${path}.forwardedProps`);
    for (const [field, key] of [['tools', 'parameters'], ['resume', 'payload']] as const) {
      const list = next[field];
      if (!Array.isArray(list)) continue;
      const upgraded = list.map((item, index) => (isObject(item) ? setNull(item, key, `${path}.${field}[${index}].${key}`) : item));
      if (upgraded.some((item, index) => item !== list[index])) next = { ...next, [field]: upgraded };
    }
    return upgradeMessages(next, path);
  };

  event = setNull(event, 'rawEvent', `${type}.rawEvent`);
  if (type === 'RUN_FINISHED' || type === 'SUBAGENT_FINISHED') event = setNull(event, 'result', `${type}.result`);
  switch (type) {
    case 'TOOL_CALL_START':
    case 'TOOL_CALL_CHUNK':
      event = setNull(event, 'parentMessageId', `${type}.parentMessageId`);
      break;
    case 'RUN_FINISHED':
      event = setNull(event, 'outcome', 'RUN_FINISHED.outcome');
      break;
    case 'MESSAGES_SNAPSHOT':
      event = upgradeMessages(event, type);
      break;
    case 'RUN_STARTED':
      if (isObject(event.input)) {
        const input = upgradeInput(event.input, 'RUN_STARTED.input');
        if (input !== event.input) event = { ...event, input };
      }
      break;
    default: {
      const modern = RETIRED_THINKING[type];
      if (modern === undefined) break;
      // The client drops THINKING_START.title and gives each continuation the id of its opener. A copy needs neither.
      const base = type === 'THINKING_START' ? without(event, 'title') : event;
      event = { ...base, type: modern, messageId: PLACEHOLDER_ID, ...(type === 'THINKING_TEXT_MESSAGE_START' && { role: 'reasoning' }) };
      hits.push({ rule: 'compat.retired-event-type', message: `${type} is a retired event type. The protocol client reads it as ${modern}.` });
    }
  }

  const listed = (paths: readonly string[]) => (paths.length > MAX_PATHS ? `${paths.slice(0, MAX_PATHS).join(', ')} and ${paths.length - MAX_PATHS} more` : paths.join(', '));
  if (nulls.length > 0) {
    hits.push({ rule: 'compat.null-optional-field', message: `${listed(nulls)} ${nulls.length === 1 ? 'is' : 'are'} null. The protocol client reads ${nulls.length === 1 ? 'it' : 'them'} as absent.` });
  }
  if (binaries.length > 0) {
    hits.push({ rule: 'compat.legacy-binary-content', message: `${listed(binaries)} ${binaries.length === 1 ? 'is a binary content part' : 'are binary content parts'}. The protocol client converts ${binaries.length === 1 ? 'it' : 'them'} to media parts.` });
  }

  const version = type === 'RUN_STARTED' ? protocolVersionRule(parsed) : undefined;
  if (version !== undefined) hits.push(version);
  return { value: event === parsed ? parsed : event, hits };
}

/**
 * What a producer's declared protocol version means to the client: nothing when it is absent, equal to the client's
 * `PROTOCOL_VERSION` or older and written as `major.minor`; a warning, and no failure, when it is newer or cannot be
 * read. The client reads `major.minor` only, so `1.0.1` is unreadable to it.
 */
function protocolVersionRule(event: Json): RuleHit | undefined {
  const declared = event.protocolVersion;
  if (typeof declared !== 'string' || declared === PROTOCOL_VERSION) return undefined;
  if (!/^\d+\.\d+$/.test(declared)) return { rule: 'compat.protocol-version-unreadable', message: 'RUN_STARTED declares a protocol version that is not written as major.minor.' };
  const [major = 0, minor = 0] = declared.split('.').map(Number);
  const [ownMajor = 0, ownMinor = 0] = PROTOCOL_VERSION.split('.').map(Number);
  return major > ownMajor || (major === ownMajor && minor > ownMinor)
    ? { rule: 'compat.protocol-version-newer', message: `RUN_STARTED declares a protocol version newer than ${PROTOCOL_VERSION}, which is the version the protocol client speaks.` }
    : undefined;
}
