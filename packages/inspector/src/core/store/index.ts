// The session store. Framework-free: no React, nothing but plain data and an injected scheduler.
//
// It holds the exchanges, raw frames, runs, findings and derived entries of one capture, in memory.
// Every append lands immediately, so capture never waits for a view; only the notification to
// subscribers is batched, to at most one per scheduled animation frame.
//
// Three kinds of fact live side by side and never overwrite one another: raw frames (append-only
// wire evidence), findings (additive judgements that point at a frame, run or exchange) and derived
// entries (client-built, each linking back to the frames it came from and never carrying a frame
// index). An exchange's transport state and a run's observed outcome are separate records, so
// neither can stand in for the other.
//
// The store checks the invariants a later export and import rely on, in order: unique ids, frame
// indices that follow arrival order, offsets that never go backwards, references that exist. A
// call that breaks one throws before changing anything; the recorder reports that as a capture
// finding instead of storing something the next import would reject.
import type {
  DerivedEntry,
  DerivedId,
  Exchange,
  ExchangeId,
  ExchangePatch,
  Finding,
  FindingId,
  FrameId,
  InspectionSession,
  RawFrame,
  Run,
  RunRecordId,
  Scheduler,
  SessionStore,
  Unsubscribe,
} from '../../contracts.ts';
import { checkRuleId } from '../rules/catalogue.ts';

export interface SessionStoreOptions {
  readonly id?: string;
  /** Runs a callback on the next animation frame. Tests pass their own. */
  readonly schedule?: Scheduler;
  /** Where a throwing subscriber is reported. It never reaches the code that appended. */
  readonly onListenerError?: (error: unknown) => void;
}

const nextAnimationFrame: Scheduler = (callback) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback);
  else setTimeout(callback, 16);
};

interface ExchangeSlot {
  base: Omit<Exchange, 'frameIds'>;
  frameIds: FrameId[];
  lastOffsetMs: number;
  /** The exchange as the snapshot shows it; rebuilt only after it changed. */
  view?: Exchange;
}

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const sessionId = options.id ?? 'session-1';
  const schedule = options.schedule ?? nextAnimationFrame;
  const onListenerError = options.onListenerError ?? ((error: unknown) => console.error('A store subscriber failed', error));

  const exchanges = new Map<ExchangeId, ExchangeSlot>();
  const frames: RawFrame[] = [];
  const frameIds = new Set<FrameId>();
  const findings: Finding[] = [];
  const findingIds = new Set<FindingId>();
  const runs = new Map<RunRecordId, Run>();
  const derived: DerivedEntry[] = [];
  const derivedIds = new Set<DerivedId>();

  const listeners = new Set<() => void>();
  let cached: InspectionSession | undefined;
  let scheduled = false;

  function changed() {
    cached = undefined;
    if (scheduled || listeners.size === 0) return;
    scheduled = true;
    try {
      schedule(() => {
        scheduled = false;
        for (const listener of [...listeners]) {
          if (!listeners.has(listener)) continue;
          try {
            listener();
          } catch (error) {
            onListenerError(error);
          }
        }
      });
    } catch (error) {
      scheduled = false;
      onListenerError(error);
    }
  }

  const slotOf = (id: ExchangeId, what: string) => {
    const slot = exchanges.get(id);
    if (!slot) throw new Error(`${what}: unknown exchange ${id}`);
    return slot;
  };

  return {
    appendExchange(exchange) {
      if (exchanges.has(exchange.id)) throw new Error(`appendExchange: duplicate exchange ${exchange.id}`);
      if (exchange.frameIds.length > 0) throw new Error('appendExchange: frames are appended, not declared');
      const { frameIds: _none, ...base } = exchange;
      exchanges.set(exchange.id, { base, frameIds: [], lastOffsetMs: 0 });
      changed();
    },

    updateExchange(id, patch: ExchangePatch) {
      const slot = slotOf(id, 'updateExchange');
      slot.base = { ...slot.base, ...patch, id };
      slot.view = undefined;
      changed();
    },

    appendFrame(frame) {
      const slot = slotOf(frame.exchangeId, 'appendFrame');
      if (frameIds.has(frame.id)) throw new Error(`appendFrame: duplicate frame ${frame.id}`);
      if (frame.index !== slot.frameIds.length) {
        throw new Error(`appendFrame: frame ${frame.id} has index ${frame.index}, expected ${slot.frameIds.length}`);
      }
      if (!Number.isFinite(frame.offsetMs) || frame.offsetMs < 0 || frame.offsetMs < slot.lastOffsetMs) {
        throw new Error(`appendFrame: offset ${frame.offsetMs} of ${frame.id} is not monotonic`);
      }
      // A data frame holds its received content as text (server-sent events) or as bytes (a binary frame), never both.
      // A partial frame has no data text and may hold bytes. A control frame has neither.
      if (frame.classification === 'data') {
        if ((frame.data !== undefined) === (frame.bytes !== undefined)) {
          throw new Error(`appendFrame: ${frame.id} is data but has ${frame.data === undefined ? 'no data text or bytes' : 'both data text and bytes'}`);
        }
      } else if (frame.data !== undefined) {
        throw new Error(`appendFrame: ${frame.id} is ${frame.classification} but has data text`);
      } else if (frame.bytes !== undefined && frame.classification !== 'partial') {
        throw new Error(`appendFrame: ${frame.id} is ${frame.classification} but has bytes`);
      }
      frames.push(frame);
      frameIds.add(frame.id);
      slot.frameIds.push(frame.id);
      slot.lastOffsetMs = frame.offsetMs;
      slot.view = undefined;
      changed();
    },

    addFinding(finding) {
      if (findingIds.has(finding.id)) throw new Error(`addFinding: duplicate finding ${finding.id}`);
      const { type, id } = finding.subject;
      const known = type === 'frame' ? frameIds.has(id) : type === 'run' ? runs.has(id) : exchanges.has(id);
      if (!known) throw new Error(`addFinding: finding ${finding.id} points at unknown ${type} ${id}`);
      const bad = finding.rule === undefined ? undefined : checkRuleId(finding.kind, finding.rule);
      if (bad !== undefined) throw new Error(`addFinding: finding ${finding.id} has a bad rule: ${bad}`);
      findings.push(finding);
      findingIds.add(finding.id);
      changed();
    },

    upsertRun(run) {
      slotOf(run.exchangeId, 'upsertRun');
      runs.set(run.id, run);
      changed();
    },

    appendDerived(entry) {
      if (derivedIds.has(entry.id)) throw new Error(`appendDerived: duplicate entry ${entry.id}`);
      if (entry.attribution === 'identified' && entry.sources.length === 0) {
        throw new Error(`appendDerived: ${entry.id} is identified but names no source frame`);
      }
      for (const source of entry.sources) {
        if (!frameIds.has(source)) throw new Error(`appendDerived: ${entry.id} points at unknown frame ${source}`);
      }
      derived.push(entry);
      derivedIds.add(entry.id);
      changed();
    },

    snapshot() {
      return (cached ??= {
        id: sessionId,
        exchanges: [...exchanges.values()].map((slot) => (slot.view ??= { ...slot.base, frameIds: [...slot.frameIds] })),
        runs: [...runs.values()],
        frames: [...frames],
        findings: [...findings],
        derived: [...derived],
      });
    },

    subscribe(listener): Unsubscribe {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
