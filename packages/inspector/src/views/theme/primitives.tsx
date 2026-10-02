// Shared view primitives (design.md, Components). Native elements, no dependencies. Views compose
// these and pick a variant; they do not style around a primitive. Appearance lives in primitives.css
// and reads only theme tokens, so overriding --agui-* restyles everything here.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from 'react';

type Native<T extends 'button' | 'div' | 'input' | 'span' | 'textarea'> = Omit<ComponentPropsWithoutRef<T>, 'className'>;
const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

/* ---------- Icons: inline SVG on a 24 px grid, 1.8 stroke, round caps. No icon library. ---------- */

export const icons = {
  chev: '<path d="m9.5 6 6 6-6 6"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 5.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  import: '<path d="M12 14V3.5m0 10.5-4-4m4 4 4-4M4 15.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5"/>',
  export: '<path d="M12 3.5V14m0-10.5-4 4m4-4 4 4M4 15.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.2 8.2 0 1 0 20 14.2Z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  send: '<path d="M12 19V5.5m0 0-6 6m6-6 6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  branch: '<circle cx="7" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="9" r="2"/><path d="M7 7.5v9M17 11c0 3.5-4 4-8.5 6"/>',
  brace: '<path d="M9 4H8a2 2 0 0 0-2 2v3.5c0 1.4-.9 2.5-2 2.5 1.1 0 2 1.1 2 2.5V18a2 2 0 0 0 2 2h1M15 4h1a2 2 0 0 1 2 2v3.5c0 1.4.9 2.5 2 2.5-1.1 0-2 1.1-2 2.5V18a2 2 0 0 1-2 2h-1"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L4 17v3h3l5.5-5.5a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.6-.4-.4-2.6 2.4-2.4Z"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  wire: '<path d="M3 12h3.5l2-5 3.5 10 2.5-6.5 1.5 1.5H21"/>',
  hand: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-6.5V5a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L3.8 14.6a1.5 1.5 0 0 1 2.4-1.8L8 15"/>',
} as const;

export type IconName = keyof typeof icons;

/** Decorative: always hidden from assistive technology. Name the control, not the icon. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }): ReactElement {
  return (
    <svg
      className="agui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Constant markup from the table above, never user input.
      dangerouslySetInnerHTML={{ __html: icons[name] }}
    />
  );
}

/* ---------- Button ---------- */

export type ButtonProps = Native<'button'> & { variant?: 'default' | 'primary' | 'ghost'; small?: boolean } & (
    | { iconOnly?: false }
    | { iconOnly: true; 'aria-label': string }
  );

export function Button({ variant = 'default', small, iconOnly, ...rest }: ButtonProps): ReactElement {
  return (
    <button
      type="button"
      {...rest}
      className={cx('agui-btn', variant !== 'default' && `agui-btn--${variant}`, iconOnly && 'agui-btn--icon', small && 'agui-btn--small')}
    />
  );
}

/* ---------- Tag, family dot, filter chip ---------- */

export type TagVariant = 'neutral' | 'line' | 'dashed' | 'accent' | 'ok' | 'warn' | 'err';

export function Tag({ variant = 'neutral', pulse, children, ...rest }: Native<'span'> & { variant?: TagVariant; pulse?: boolean }): ReactElement {
  return (
    <span {...rest} className={cx('agui-tag', variant !== 'neutral' && `agui-tag--${variant}`)}>
      {pulse && <span className="agui-pulse" aria-hidden="true" />}
      {children}
    </span>
  );
}

export type Family = 'text' | 'tool' | 'reason' | 'state' | 'activity' | 'neutral';

/** Run, step, subagent, custom and raw use `neutral` with `hollow`. */
export function FamilyDot({ family, hollow }: { family: Family; hollow?: boolean }): ReactElement {
  return <span className={cx('agui-dot', hollow && 'agui-dot--hollow')} data-family={family} aria-hidden="true" />;
}

export function FilterChip({
  pressed,
  family,
  hollow,
  count,
  children,
  ...rest
}: Native<'button'> & { pressed: boolean; family?: Family; hollow?: boolean; count?: number }): ReactElement {
  return (
    <button type="button" {...rest} aria-pressed={pressed} className="agui-chip">
      {family && <FamilyDot family={family} hollow={hollow} />}
      {children}
      {count !== undefined && <span className="agui-count">{count}</span>}
    </button>
  );
}

/* ---------- Card ---------- */

export function Card({ interrupt, ...rest }: Native<'div'> & { interrupt?: boolean }): ReactElement {
  return <div {...rest} className={cx('agui-card', interrupt && 'agui-card--interrupt')} />;
}
export const CardHeader = (props: Native<'div'>): ReactElement => <div {...props} className="agui-card-h" />;
export const CardBody = (props: Native<'div'>): ReactElement => <div {...props} className="agui-card-b" />;
export const CardFooter = (props: Native<'div'>): ReactElement => <div {...props} className="agui-card-f" />;

/* ---------- Code block ---------- */

export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'plain';
export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const jsonToken =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;

/**
 * Splits text into highlight tokens. Lossless by construction: the tokens always join back to the
 * input, whether or not it is valid JSON, so highlighting can never alter what was received.
 */
export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const plain = (to: number, from: number) => {
    if (to > from) tokens.push({ kind: 'plain', text: text.slice(from, to) });
  };
  let last = 0;
  for (const match of text.matchAll(jsonToken)) {
    plain(match.index, last);
    if (match[1] !== undefined && match[2] !== undefined) {
      tokens.push({ kind: 'key', text: match[1] }, { kind: 'punct', text: match[2] });
    } else if (match[1] !== undefined) tokens.push({ kind: 'string', text: match[1] });
    else if (match[3] !== undefined) tokens.push({ kind: 'literal', text: match[3] });
    else if (match[4] !== undefined) tokens.push({ kind: 'number', text: match[4] });
    else tokens.push({ kind: 'punct', text: match[5] ?? '' });
    last = match.index + match[0].length;
  }
  plain(text.length, last);
  return tokens;
}

const tokenClass: Record<Exclude<JsonTokenKind, 'plain'>, string> = {
  key: 'agui-j-k',
  string: 'agui-j-s',
  number: 'agui-j-n',
  literal: 'agui-j-b',
  punct: 'agui-j-p',
};

/** `json` highlights; `raw` shows the text exactly as given. Focusable so keyboard users can scroll it. */
export function CodeBlock({ text, format = 'json', 'aria-label': label }: { text: string; format?: 'json' | 'raw'; 'aria-label'?: string }): ReactElement {
  return (
    <pre className="agui-code" tabIndex={0} role={label ? 'region' : undefined} aria-label={label}>
      {format === 'raw'
        ? text
        : tokenizeJson(text).map((token, index) =>
            token.kind === 'plain' ? token.text : <span key={index} className={tokenClass[token.kind]}>{token.text}</span>,
          )}
    </pre>
  );
}

/* ---------- Segmented control, switch ---------- */

export function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: ReactNode }>;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <div className="agui-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className="agui-seg-opt" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  'aria-label': label,
  ...rest
}: Omit<Native<'button'>, 'onChange' | 'children'> & { checked: boolean; onChange: (checked: boolean) => void; 'aria-label': string }): ReactElement {
  return (
    <button
      className="agui-switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      type="button"
      {...rest}
      onClick={() => onChange(!checked)}
    />
  );
}

/* ---------- Field, search field, editor ---------- */

/** `invalid` sets aria-invalid; pair it with a Finding and aria-describedby for the message. */
export function Field({ invalid, ...rest }: Native<'input'> & { invalid?: boolean }): ReactElement {
  return <input {...rest} aria-invalid={invalid || undefined} className="agui-field" />;
}

export function SearchField(props: Omit<Native<'input'>, 'type'>): ReactElement {
  return (
    <div className="agui-search">
      <Icon name="search" />
      <input type="search" {...props} />
    </div>
  );
}

/** The multi-line mono input for payloads, results and raw requests. */
export function Editor({ invalid, ...rest }: Native<'textarea'> & { invalid?: boolean }): ReactElement {
  return <textarea spellCheck={false} {...rest} aria-invalid={invalid || undefined} className="agui-editor" />;
}

/* ---------- Finding, label ---------- */

export function Finding({
  variant = 'neutral',
  icon = 'alert',
  kind,
  children,
}: {
  variant?: 'neutral' | 'warn' | 'err';
  icon?: IconName;
  kind?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={cx('agui-finding', `agui-finding--${variant}`)}>
      <Icon name={icon} size={14} />
      <span>
        {kind && <b>{kind}</b>}
        {kind && ' · '}
        {children}
      </span>
    </div>
  );
}

export function Label({ htmlFor, ...rest }: Native<'span'> & { htmlFor?: string }): ReactElement {
  return htmlFor ? <label className="agui-label" htmlFor={htmlFor} {...(rest as object)} /> : <span {...rest} className="agui-label" />;
}

/* ---------- Popover, dialog, toast ---------- */

const POPOVER_WIDTH = 340;
const POPOVER_GAP = 6;
const POPOVER_MARGIN = 16;

/** Where a popover goes: just under its trigger, kept {@link POPOVER_MARGIN} px inside the viewport. */
export function popoverPosition(anchor: { left: number; bottom: number }, viewportWidth: number): { top: number; left: number } {
  const width = Math.min(POPOVER_WIDTH, viewportWidth - 2 * POPOVER_MARGIN);
  return {
    top: anchor.bottom + POPOVER_GAP,
    left: Math.max(POPOVER_MARGIN, Math.min(anchor.left, viewportWidth - width - POPOVER_MARGIN)),
  };
}

/**
 * A native popover. Open it with a button that has `popoverTarget={id}`; it lands under that button.
 * Light dismiss, Escape and focus return come from the platform.
 */
export function Popover({ id, ...rest }: Omit<Native<'div'>, 'popover' | 'id'> & { id: string }): ReactElement {
  return (
    <div
      popover=""
      id={id}
      className="agui-pop"
      {...rest}
      onBeforeToggle={(event) => {
        if (event.newState !== 'open') return;
        const trigger = document.querySelector(`[popovertarget="${CSS.escape(id)}"]`);
        if (!trigger) return;
        const { top, left } = popoverPosition(trigger.getBoundingClientRect(), window.innerWidth);
        event.currentTarget.style.top = `${top}px`;
        event.currentTarget.style.left = `${left}px`;
      }}
    />
  );
}

/**
 * A native modal dialog driven by `open`. The platform handles focus trapping and Escape; `onClose`
 * fires for both, so set `open` to false in it.
 */
export function Dialog({
  open,
  onClose,
  title,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="agui-dialog" aria-labelledby={titleId} onClose={onClose}>
      <div className="agui-dialog-b">
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
      {footer && <div className="agui-dialog-f">{footer}</div>}
    </dialog>
  );
}

export const TOAST_MS = 3200;
export interface ToastItem {
  id: number;
  text: string;
}

/** Keep `ToastRegion` mounted: a live region must exist before text is added to it. */
export function ToastRegion({ toasts }: { toasts: readonly ToastItem[] }): ReactElement {
  return (
    <div className="agui-toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="agui-toast">
          {toast.text}
        </div>
      ))}
    </div>
  );
}

/** `toast(text)` shows a one-line message for {@link TOAST_MS}. */
export function useToasts(): { toasts: ToastItem[]; toast: (text: string) => void } {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const next = useRef(0);
  const toast = useCallback((text: string) => {
    const id = ++next.current;
    setToasts((list) => [...list, { id, text }]);
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), TOAST_MS);
  }, []);
  return { toasts, toast };
}
