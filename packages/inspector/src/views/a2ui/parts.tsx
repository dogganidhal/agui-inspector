import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import type { JsonValue } from '../../contracts';
import { CodeBlock, Finding } from '../theme/primitives';

// The markup that the v0.9 and the v0.8 components share. Each version reads its own props and calls these, so
// one set of classes in a2ui.css, and one test of the keyboard behavior, covers both. Nothing here knows a
// renderer: it takes plain values and children.

/** The `aria-*` attributes a component may carry; the v0.9 `accessibility` prop becomes them. */
export type Aria = { readonly 'aria-label'?: string | undefined; readonly 'aria-description'?: string | undefined };

/** The names of the media components the inspector never loads. */
export type BlockedKind = 'Image' | 'Video' | 'AudioPlayer';

/** Stands in for a component that would load its `url`: it names the address as plain text and loads nothing. */
export function BlockedView({ kind, url }: { kind: BlockedKind; url: string }): ReactElement {
  return (
    <span className="agui-a2ui-blocked" role="note" data-blocked={kind}>
      Blocked {kind}: {url}
    </span>
  );
}

/** A named icon is its name, humanised, in a small tag, because the inspector loads no icon font. */
export const iconWords = (name: string): string => name.replace(/([A-Z])/g, ' $1').toLowerCase();

/** An icon given as a path draws normally. Either way it is announced as an image when it has a label. */
export function IconView({ name, label, style }: { name: string | { readonly svgPath: string }; label?: string | undefined; style?: CSSProperties | undefined }): ReactElement {
  if (typeof name === 'object') {
    return (
      <svg className="agui-a2ui-icon" viewBox="0 0 24 24" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={style}>
        <path d={name.svgPath} fill="currentColor" />
      </svg>
    );
  }
  const words = iconWords(name);
  return (
    <span className="agui-a2ui-icon-name" role="img" aria-label={label ?? words} style={style}>
      {words}
    </span>
  );
}

/** A button of one of three variants. A hint, when there is one, sits under it and is tied to it for assistive technology. */
export function ButtonView({
  variant,
  disabled,
  hint,
  aria,
  style,
  onClick,
  children,
}: {
  variant: string;
  disabled?: boolean;
  hint?: string | undefined;
  aria?: Aria;
  style?: CSSProperties | undefined;
  onClick?: () => void;
  children?: ReactNode;
}): ReactElement {
  const hintId = useId();
  return (
    <span className="agui-a2ui-action" style={style}>
      <button type="button" className="agui-a2ui-btn" data-variant={variant} disabled={disabled} aria-describedby={hint ? hintId : undefined} onClick={onClick} {...aria}>
        {children}
      </button>
      {hint && (
        <span id={hintId} className="agui-a2ui-hint">
          {hint}
        </span>
      )}
    </span>
  );
}

/** The WAI-ARIA tabs pattern. Arrow keys, Home and End move between tabs and select them. */
export function TabsView({ titles, panel, aria, style }: { titles: readonly string[]; panel(index: number): ReactNode; aria?: Aria; style?: CSSProperties | undefined }): ReactElement {
  const id = useId();
  const [chosen, setChosen] = useState(0);
  const selected = Math.min(chosen, Math.max(titles.length - 1, 0));
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: KeyboardEvent, to: number) => {
    event.preventDefault();
    const next = (to + titles.length) % titles.length;
    setChosen(next);
    refs.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') move(event, selected + 1);
    else if (event.key === 'ArrowLeft') move(event, selected - 1);
    else if (event.key === 'Home') move(event, 0);
    else if (event.key === 'End') move(event, titles.length - 1);
  };
  return (
    <div className="agui-a2ui-tabs" style={style}>
      <div role="tablist" className="agui-a2ui-tablist" {...aria} onKeyDown={onKeyDown}>
        {titles.map((title, at) => (
          <button
            key={at}
            ref={(element) => {
              refs.current[at] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${at}`}
            className="agui-a2ui-tab"
            aria-selected={at === selected}
            aria-controls={`${id}-panel`}
            tabIndex={at === selected ? 0 : -1}
            onClick={() => setChosen(at)}
          >
            {title}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} className="agui-a2ui-tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}>
        {titles.length > 0 ? panel(selected) : null}
      </div>
    </div>
  );
}

/**
 * The trigger opens a native dialog. The browser traps focus inside, Escape and the close button shut it and
 * focus returns to the trigger. Clicking the backdrop shuts it too.
 */
export function ModalView({ trigger, content, label, aria, style }: { trigger: ReactNode; content: ReactNode; label?: string | undefined; aria?: Aria; style?: CSSProperties | undefined }): ReactElement {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);
  return (
    <>
      <div className="agui-a2ui-modal-trigger" onClick={() => setOpen(true)} style={style}>
        {trigger}
      </div>
      {open && (
        <dialog
          ref={dialog}
          className="agui-a2ui-modal"
          {...aria}
          aria-label={label ?? 'Dialog'}
          onClose={() => setOpen(false)}
          onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
        >
          <button type="button" className="agui-a2ui-modal-close" aria-label="Close" onClick={() => dialog.current?.close()}>
            ×
          </button>
          <div className="agui-a2ui-modal-body">{content}</div>
        </dialog>
      )}
    </>
  );
}

/**
 * What stands in for a component whose type the catalog does not list, in place of the renderer's raw red line: an
 * error that names the type, with the definition as it was received. Nothing is drawn for the component, and it
 * is not repaired or dropped from the list.
 */
export function UnknownView({ id, type, definition }: { id: string; type: string; definition: JsonValue }): ReactElement {
  return (
    <div role="alert" className="agui-a2ui-unknown">
      <Finding variant="err" kind={`Component ${id}`}>
        Unknown component type: {type}. The catalog has no such component, so nothing is drawn for it.
      </Finding>
      <details className="agui-a2ui-received">
        <summary>As received</summary>
        <CodeBlock text={JSON.stringify(definition, null, 2)} aria-label={`Received component ${id}`} />
      </details>
    </div>
  );
}
