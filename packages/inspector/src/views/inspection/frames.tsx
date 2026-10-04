// The frames list (design.md, Frames): filter bar, exchanges newest first, and the frames of each.
// Controlled: the state (filter, what is open) lives in InspectionView so this stays a pure function
// of its props. Frame rows are plain elements built from the F06 primitives; only the expanded
// exchange builds rows, and a frame's raw text is built only when its row is opened.
import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { DerivedEntry, EvidenceTarget, Exchange, ExchangeId, Finding as FindingRecord, FrameId, InspectionSession, RawFrame } from '../../contracts.ts';
import { Button, CodeBlock, FamilyDot, Finding, FilterChip, Icon, Label, SearchField, Tag, type TagVariant } from '../theme/index.ts';
import './inspection.css';
import {
  FAMILIES,
  byteLength,
  copyFramesJson,
  exchangeFailed,
  exchangeRows,
  familyDef,
  familyOf,
  formatBytes,
  formatDuration,
  formatOffset,
  indexSession,
  isFiltering,
  listExchanges,
  summarizeFrame,
  typeLabel,
  type ExchangeEntry,
  type FamilyKey,
  type FrameFilter,
  type SessionIndex,
} from './model.ts';

export interface FramesPanelProps {
  readonly session: InspectionSession;
  readonly filter: FrameFilter;
  /** An explicit choice per exchange; without one only the newest exchange is open. */
  readonly openExchanges: ReadonlyMap<ExchangeId, boolean>;
  /** Ids of the frames and derived entries whose detail is open. */
  readonly openFrames: ReadonlySet<string>;
  /** Counts the user's filter and expansion actions; a measurement links an input to the commit that answers it. */
  readonly generation?: number;
  /** The run or frame the user was last sent to. Its row is marked `aria-current`, which is how the page finds it to focus. */
  readonly revealed?: EvidenceTarget;
  onFilter(filter: FrameFilter): void;
  onToggleExchange(id: ExchangeId, open: boolean): void;
  onToggleFrame(id: string): void;
  /** Puts `text` on the clipboard; `what` names it for the confirmation. */
  onCopy(text: string, what: string): void;
}

// The data behind these is valid or accepted, and a rule says it should not be there: a warning, not an error.
const WARNING_KINDS = new Set(['sequence', 'projection', 'compat', 'capability']);
const findingVariant = (finding: FindingRecord) => (WARNING_KINDS.has(finding.kind) ? 'warn' : 'err');
const findingLabel = (finding: FindingRecord) => (finding.kind === 'json' ? 'Not JSON' : finding.kind === 'schema' ? 'Schema' : finding.kind);
const isLive = (exchange: Exchange) => exchange.transport === 'sending' || exchange.transport === 'streaming' || exchange.transport === 'reading';
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function FramesPanel(props: FramesPanelProps): ReactElement {
  const { session, filter, openExchanges, openFrames, generation = 0, revealed, onFilter, onToggleExchange, onToggleFrame, onCopy } = props;
  const index = useMemo(() => indexSession(session), [session]);
  const filtering = isFiltering(filter);
  const { exchanges, shown } = listExchanges(index, filter);

  return (
    <div className="agui-fr" data-testid="frames" data-generation={generation} data-frame-total={index.dataFrames} data-frame-shown={shown}>
      <FilterBar index={index} filter={filter} onFilter={onFilter} />
      {exchanges.length === 0 ? (
        <p className="agui-fr-empty">
          {index.newestFirst.length === 0
            ? 'No exchanges yet. Start a run or send a raw request to capture frames.'
            : 'Only preparation requests so far, and they are hidden. Turn on the Preparation chip to list them.'}
        </p>
      ) : (
        <div className="agui-fr-list">
          {exchanges.map(({ entry, shown: count }, position) => (
            <ExchangeCard
              key={entry.exchange.id}
              entry={entry}
              shown={count}
              filtering={filtering}
              filter={filter}
              // Without an explicit choice the newest exchange that is listed is the open one.
              open={openExchanges.get(entry.exchange.id) ?? position === 0}
              openFrames={openFrames}
              {...(revealed?.exchangeId === entry.exchange.id && { revealed })}
              onToggleExchange={onToggleExchange}
              onToggleFrame={onToggleFrame}
              onCopy={onCopy}
            />
          ))}
        </div>
      )}
      {index.unattributed.length > 0 && (
        <section className="agui-fr-loose" aria-label="Derived entries without an identified source">
          <Label>Derived · source unknown</Label>
          {index.unattributed.map((entry) => (
            <div key={entry.id} className="agui-fr-item">
              <DerivedRow entry={entry} open={openFrames.has(entry.id)} onToggle={onToggleFrame} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/* ---------- Filter bar ---------- */

function FilterBar({ index, filter, onFilter }: { index: SessionIndex; filter: FrameFilter; onFilter(filter: FrameFilter): void }): ReactElement {
  const toggleFamily = (key: FamilyKey) => {
    const families = new Set(filter.families);
    if (!families.delete(key)) families.add(key);
    onFilter({ ...filter, families });
  };
  return (
    <div className="agui-fr-filters">
      <SearchField
        aria-label="Filter frames by type or content"
        placeholder="Filter by type or content"
        value={filter.query}
        onChange={(event) => onFilter({ ...filter, query: event.currentTarget.value })}
      />
      <div className="agui-fr-chips" role="group" aria-label="Event families">
        {FAMILIES.map((family) => (
          <FilterChip
            key={family.key}
            pressed={filter.families.has(family.key)}
            family={family.family}
            hollow={family.hollow}
            count={index.familyCounts.get(family.key) ?? 0}
            data-family-chip={family.key}
            onClick={() => toggleFamily(family.key)}
          >
            {family.label}
          </FilterChip>
        ))}
        <FilterChip
          pressed={filter.issuesOnly}
          count={index.issues}
          data-issues-chip=""
          data-has-issues={index.issues > 0}
          onClick={() => onFilter({ ...filter, issuesOnly: !filter.issuesOnly })}
        >
          <Icon name="alert" size={13} />
          Issues
        </FilterChip>
        {/* Pressed means listed, so the default is pressed. Red while a failed preparation is in the session. */}
        <FilterChip
          pressed={filter.showPreparation}
          count={index.preparations}
          data-preparation-chip=""
          data-has-issues={index.failedPreparations > 0}
          title="Show or hide the preparation requests. A failed one stays listed."
          onClick={() => onFilter({ ...filter, showPreparation: !filter.showPreparation })}
        >
          Preparation
        </FilterChip>
      </div>
    </div>
  );
}

/* ---------- Exchange ---------- */

interface ExchangeCardProps {
  entry: ExchangeEntry;
  shown: number;
  filtering: boolean;
  filter: FrameFilter;
  open: boolean;
  openFrames: ReadonlySet<string>;
  /** Set only on the card of the revealed exchange. */
  revealed?: EvidenceTarget;
  onToggleExchange(id: ExchangeId, open: boolean): void;
  onToggleFrame(id: string): void;
  onCopy(text: string, what: string): void;
}

const ExchangeCard = memo(function ExchangeCard({ entry, shown, filtering, filter, open, openFrames, revealed, onToggleExchange, onToggleFrame, onCopy }: ExchangeCardProps): ReactElement {
  const { exchange } = entry;
  const failed = exchange.transport === 'transport-error';
  const bad = exchangeFailed(exchange);
  const status = exchange.status !== undefined ? String(exchange.status) : failed ? 'failed' : exchange.transport === 'user-stopped' ? 'stopped' : '…';
  const kindTag = exchange.kind === 'conversation' ? (entry.runLabel ?? 'run') : exchange.kind === 'preparation' ? 'prepare' : 'raw';

  return (
    <div className="agui-fr-ex" data-exchange={exchange.id}>
      <div className="agui-fr-exh">
        <button
          type="button"
          className="agui-fr-toggle"
          data-exchange-header={exchange.id}
          aria-expanded={open}
          aria-current={(revealed !== undefined && revealed.frameId === undefined) || undefined}
          onClick={() => onToggleExchange(exchange.id, !open)}
        >
          <Icon name="chev" size={14} />
          <span className="agui-fr-method">{exchange.method}</span>
          <span className="agui-fr-path">{exchange.path}</span>
          <Tag variant={exchange.kind === 'conversation' ? 'neutral' : 'line'}>{kindTag}</Tag>
          {isLive(exchange) && (
            <Tag variant="accent" pulse>
              live
            </Tag>
          )}
          <span className="agui-fr-meta">
            <span className={bad ? 'agui-fr-bad' : undefined}>{status}</span>
            {exchange.elapsedMs !== undefined && <span>{formatDuration(exchange.elapsedMs)}</span>}
            {(entry.dataFrames > 0 || exchange.kind === 'conversation') && (
              <span className="agui-fr-hide-s">
                {filtering ? `${shown}/` : ''}
                {plural(entry.dataFrames, 'frame')}
              </span>
            )}
            {entry.issues > 0 && <Tag variant="err">{plural(entry.issues, 'issue')}</Tag>}
          </span>
        </button>
        {entry.frames.length > 0 ? (
          <Button
            variant="ghost"
            iconOnly
            small
            aria-label={`Copy the frames of ${exchange.method} ${exchange.path} as JSON`}
            title="Copy frames as JSON"
            onClick={() => onCopy(copyFramesJson(entry), plural(entry.frames.length, 'frame'))}
          >
            <Icon name="copy" size={15} />
          </Button>
        ) : (
          <span className="agui-fr-nocopy" />
        )}
      </div>
      {open && <ExchangeBody entry={entry} filter={filter} openFrames={openFrames} {...(revealed?.frameId !== undefined && { revealedFrame: revealed.frameId })} onToggleFrame={onToggleFrame} onCopy={onCopy} />}
    </div>
  );
});

function RequestDisclosure({ exchange }: { exchange: Exchange }): ReactElement | null {
  const [open, setOpen] = useState(exchange.kind === 'raw');
  if (exchange.requestBody === undefined) return null;
  const json = exchange.requestBodyJson as { resume?: unknown; forwardedProps?: { a2uiAction?: unknown } } | null | undefined;
  const heading = exchange.kind === 'conversation' ? 'RunAgentInput' : exchange.kind === 'raw' ? 'Raw body, sent unchanged' : 'Preparation request';
  const exact = exchange.kind === 'raw' || exchange.requestBodyJson === undefined;
  return (
    <details className="agui-fr-req" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <Icon name="chev" size={13} />
        Request · {heading} · {formatBytes(byteLength(exchange.requestBody))}
        {json?.resume !== undefined && <Tag variant="accent">resume</Tag>}
        {json?.forwardedProps?.a2uiAction !== undefined && <Tag variant="accent">a2uiAction</Tag>}
      </summary>
      {open && <CodeBlock text={exact ? exchange.requestBody : JSON.stringify(exchange.requestBodyJson, null, 2)} format={exact ? 'raw' : 'json'} aria-label="Request body" />}
    </details>
  );
}

function ResponseBody({ exchange }: { exchange: Exchange }): ReactElement | null {
  if (exchange.responseBody === undefined) return null;
  let pretty: string | undefined;
  try {
    pretty = JSON.stringify(JSON.parse(exchange.responseBody), null, 2);
  } catch {
    pretty = undefined;
  }
  return (
    <div className="agui-fr-block">
      <Label>Response{exchange.status !== undefined ? ` · ${exchange.status}` : ''}</Label>
      <CodeBlock text={pretty ?? exchange.responseBody} format={pretty === undefined ? 'raw' : 'json'} aria-label="Response body" />
    </div>
  );
}

function ExchangeBody({
  entry,
  filter,
  openFrames,
  revealedFrame,
  onToggleFrame,
  onCopy,
}: {
  entry: ExchangeEntry;
  filter: FrameFilter;
  openFrames: ReadonlySet<string>;
  revealedFrame?: FrameId;
  onToggleFrame(id: string): void;
  onCopy(text: string, what: string): void;
}): ReactElement {
  const { exchange } = entry;
  const { rows } = useMemo(() => exchangeRows(entry, filter), [entry, filter]);
  // Frames that arrived since the last commit fade in; opening an exchange does not animate what is already there.
  const known = useRef(entry.frames.length);
  const before = known.current;
  useEffect(() => {
    known.current = entry.frames.length;
  });

  return (
    <div className="agui-fr-body">
      <RequestDisclosure exchange={exchange} />
      {entry.findings.map((finding) => (
        <Finding key={finding.id} variant={findingVariant(finding)} kind={findingLabel(finding)} {...(finding.rule !== undefined && { rule: finding.rule })}>
          {finding.message}
        </Finding>
      ))}
      <ResponseBody exchange={exchange} />
      {(entry.frames.length > 0 || isLive(exchange)) && <Timeline entry={entry} />}
      {entry.frames.length > 0 && (
        <div className="agui-fr-frames">
          {rows.length === 0 ? (
            <p className="agui-fr-empty">No frames match the filter.</p>
          ) : (
            rows.map((row) =>
              row.type === 'frame' ? (
                <FrameItem key={row.frame.id} frame={row.frame} findings={row.findings} open={openFrames.has(row.frame.id)} current={row.frame.id === revealedFrame} fresh={row.frame.index >= before} onToggle={onToggleFrame} onCopy={onCopy} />
              ) : (
                <div key={row.entry.id} className="agui-fr-item">
                  <DerivedRow entry={row.entry} open={openFrames.has(row.entry.id)} onToggle={onToggleFrame} />
                </div>
              ),
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Timeline: one tick per received frame, at its offset ---------- */

const Timeline = memo(
  function Timeline({ entry }: { entry: ExchangeEntry }): ReactElement {
    const { exchange, frames } = entry;
    const last = frames[frames.length - 1]?.offsetMs ?? 0;
    const duration = Math.max(exchange.elapsedMs ?? last, last, 1);
    const seconds: number[] = [];
    const step = Math.max(1, Math.ceil(duration / 1000 / 10));
    for (let second = step; second * 1000 < duration * 0.9; second += step) seconds.push(second);
    return (
      <div className="agui-fr-wire" aria-hidden="true">
        <div className="agui-fr-ticks">
          {frames.map((frame) => (
            <i
              key={frame.id}
              className={entry.frameFindings.has(frame.id) ? 'agui-fr-tick agui-fr-tick--issue' : 'agui-fr-tick'}
              data-family={(frame.classification === 'data' && familyDef(familyOf(frame.eventType) ?? 'ext').family) || 'neutral'}
              style={{ left: `${((frame.offsetMs / duration) * 100).toFixed(2)}%` }}
            />
          ))}
        </div>
        <div className="agui-fr-axis">
          <span style={{ left: 0 }}>0</span>
          {seconds.map((second) => (
            <span key={second} style={{ left: `${((second * 1000) / duration) * 100}%` }}>
              {second}s
            </span>
          ))}
          <span className="agui-fr-axis-end" style={{ left: '100%' }}>
            {formatDuration(duration)}
          </span>
        </div>
      </div>
    );
  },
  (a, b) => a.entry.frames.length === b.entry.frames.length && a.entry.exchange.elapsedMs === b.entry.exchange.elapsedMs && a.entry.frameFindings.size === b.entry.frameFindings.size,
);

/* ---------- Frame row ---------- */

interface FrameItemProps {
  frame: RawFrame;
  findings: readonly FindingRecord[];
  open: boolean;
  /** The frame a reference sent the user to. */
  current: boolean;
  fresh: boolean;
  onToggle(id: string): void;
  onCopy(text: string, what: string): void;
}

const sameFindings = (a: readonly FindingRecord[], b: readonly FindingRecord[]) => a === b || (a.length === b.length && a.every((finding, at) => finding === b[at]));

const FrameItem = memo(
  function FrameItem({ frame, findings, open, current, fresh, onToggle, onCopy }: FrameItemProps): ReactElement {
    const family = frame.classification === 'data' ? familyOf(frame.eventType) : undefined;
    const def = family === undefined ? undefined : familyDef(family);
    const issue = findings[0];
    const classes = ['agui-fr-row', issue && 'agui-fr-row--bad', fresh && 'agui-fresh'].filter(Boolean).join(' ');
    return (
      <div className="agui-fr-item">
        <button type="button" className={classes} data-frame-row={frame.id} aria-expanded={open} aria-current={current || undefined} onClick={() => onToggle(frame.id)}>
          <span className="agui-fr-off">{formatOffset(frame.offsetMs)}</span>
          <span className="agui-fr-ty">
            <FamilyDot family={def?.family ?? 'neutral'} hollow={def?.hollow ?? true} />
            {typeLabel(frame)}
          </span>
          <span className="agui-fr-sum">{summarizeFrame(frame)}</span>
          <span className="agui-fr-ver">
            {issue ? (
              <Tag variant={findingVariant(issue)}>{issue.kind}</Tag>
            ) : frame.classification === 'data' ? (
              <span role="img" aria-label="Valid" title="Valid">
                <Icon name="check" size={14} />
              </span>
            ) : (
              <Tag variant="line">{frame.classification}</Tag>
            )}
          </span>
        </button>
        {open && <FrameDetail frame={frame} findings={findings} onCopy={onCopy} />}
      </div>
    );
  },
  (a, b) => a.frame === b.frame && a.open === b.open && a.current === b.current && a.fresh === b.fresh && a.onToggle === b.onToggle && a.onCopy === b.onCopy && sameFindings(a.findings, b.findings),
);

function FrameDetail({ frame, findings, onCopy }: { frame: RawFrame; findings: readonly FindingRecord[]; onCopy(text: string, what: string): void }): ReactElement {
  const received = frame.data ?? frame.envelope;
  const formatted = frame.jsonVerdict === 'valid' ? JSON.stringify(frame.parsed, null, 2) : undefined;
  return (
    <div className="agui-fr-detail" data-frame-detail={frame.id}>
      {findings.map((finding) => (
        <Finding key={finding.id} variant={findingVariant(finding)} kind={findingLabel(finding)} {...(finding.rule !== undefined && { rule: finding.rule })}>
          {finding.message} Capture continued.
        </Finding>
      ))}
      <div className="agui-fr-bar">
        <Label>
          {frame.classification === 'data' ? 'Raw' : 'Envelope'} · {formatBytes(byteLength(received))} as received
        </Label>
        {formatted !== undefined && <Tag variant="line">formatted</Tag>}
        <span className="agui-fr-spacer" />
        <Button variant="ghost" small onClick={() => onCopy(received, 'raw frame')} aria-label="Copy the frame as received">
          <Icon name="copy" size={14} />
          Copy
        </Button>
      </div>
      <CodeBlock text={formatted ?? received} format={formatted === undefined ? 'raw' : 'json'} aria-label="Frame content" />
    </div>
  );
}

/* ---------- Derived row ---------- */

function DerivedRow({ entry, open, onToggle }: { entry: DerivedEntry; open: boolean; onToggle(id: string): void }): ReactElement {
  const family = familyOf(entry.eventType);
  const def = family === undefined ? undefined : familyDef(family);
  const source = entry.sources[entry.sources.length - 1];
  const tag: TagVariant = 'dashed';
  return (
    <>
      <button
        type="button"
        className="agui-fr-row agui-fr-row--derived"
        data-derived-row={entry.id}
        {...(source !== undefined && { 'data-derived-from': source })}
        aria-expanded={open}
        onClick={() => onToggle(entry.id)}
      >
        <span className="agui-fr-off" />
        <span className="agui-fr-ty">
          <FamilyDot family={def?.family ?? 'neutral'} hollow={def?.hollow ?? true} />
          {entry.eventType}
        </span>
        <span className="agui-fr-sum">{entry.label}</span>
        <span className="agui-fr-ver">
          <Tag variant={tag}>derived</Tag>
        </span>
      </button>
      {open && (
        <div className="agui-fr-detail">
          <Finding icon="branch">
            {source !== undefined ? 'Client-derived from the frame above' : 'Client-derived; the source frame is not identified'}
            {entry.attribution === 'ambiguous' ? ' (attribution is ambiguous)' : ''}. Not on the wire.
          </Finding>
          {entry.value !== undefined && <CodeBlock text={JSON.stringify(entry.value, null, 2)} aria-label="Derived content" />}
        </div>
      )}
    </>
  );
}
