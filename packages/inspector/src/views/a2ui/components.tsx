import { Fragment, createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { createBinderlessComponentImplementation, createComponentImplementation, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import {
  ButtonApi,
  ChoicePickerApi,
  DividerApi,
  IconApi,
  ModalApi,
  RowApi,
  TabsApi,
  TextFieldApi,
} from '@a2ui/web_core/v0_9/basic_catalog';
import { z } from 'zod';
import type { JsonValue } from '../../contracts';
import { CodeBlock, Finding } from '../theme/primitives';

// The components the official renderer draws without a usable hook. @a2ui/react 0.12.0 styles them with
// CSS-module class names that are never resolved, and Tabs, Modal, ChoicePicker and Divider carry no
// roles, labels or keyboard handling. These keep the official props and bindings (same schemas, same
// binder) and change only the markup, so a surface written for the basic catalog applies unchanged.
// Their look is in a2ui.css under the agui-a2ui prefix and comes from the theme tokens.

type BuildChild = (id: string, basePath?: string) => ReactNode;
type Child = string | { readonly id: string; readonly basePath: string };

/** The binder has resolved every dynamic string by the time a component renders, but its types still allow bindings. */
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** The `accessibility` attributes every component may carry. */
function accessible(accessibility: { readonly label?: unknown; readonly description?: unknown } | undefined) {
  const label = str(accessibility?.label);
  return { label, aria: { 'aria-label': label, 'aria-description': str(accessibility?.description) } };
}

/** `weight` is a flex-grow factor, only meaningful for a direct child of a Row or Column. */
const weighted = (weight?: number): CSSProperties | undefined => (typeof weight === 'number' ? { flex: weight, minWidth: 0, minHeight: 0 } : undefined);

function Children({ list, buildChild }: { list: readonly Child[] | undefined; buildChild: BuildChild }): ReactElement | null {
  if (!Array.isArray(list)) return null;
  return (
    <>
      {list.map((child, at) =>
        typeof child === 'string' ? (
          <Fragment key={`${child}-${at}`}>{buildChild(child)}</Fragment>
        ) : (
          <Fragment key={`${child.id}-${child.basePath}`}>{buildChild(child.id, child.basePath)}</Fragment>
        ),
      )}
    </>
  );
}

const JUSTIFY = { center: 'center', end: 'flex-end', spaceAround: 'space-around', spaceBetween: 'space-between', spaceEvenly: 'space-evenly', start: 'flex-start', stretch: 'stretch' } as const;
const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' } as const;

/** Row: like the official one, and it wraps instead of overflowing a narrow pane. */
const Row = createComponentImplementation(RowApi, ({ props, buildChild }) => (
  <div
    className="agui-a2ui-row"
    style={{ ...weighted(props.weight), justifyContent: JUSTIFY[props.justify ?? 'start'], alignItems: ALIGN[props.align ?? 'stretch'] }}
    {...accessible(props.accessibility).aria}
  >
    <Children list={props.children} buildChild={buildChild} />
  </div>
));

/** Divider: a real separator with an orientation; the vertical one takes the height of its row. */
const Divider = createComponentImplementation(DividerApi, ({ props }) => {
  const vertical = props.axis === 'vertical';
  return <div role="separator" aria-orientation={vertical ? 'vertical' : 'horizontal'} className="agui-a2ui-divider" data-axis={vertical ? 'vertical' : 'horizontal'} style={weighted(props.weight)} {...accessible(props.accessibility).aria} />;
});

/**
 * Icon. The inspector loads no icon font, so a named icon is drawn as its name, humanised, in a small
 * tag that is announced as an image with that name. An `svgPath` draws normally.
 */
const Icon = createComponentImplementation(IconApi, ({ props }) => {
  const name = props.name;
  const { label } = accessible(props.accessibility);
  if (typeof name === 'object' && name !== null && 'svgPath' in name) {
    return (
      <svg className="agui-a2ui-icon" viewBox="0 0 24 24" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={weighted(props.weight)}>
        <path d={String(name.svgPath)} fill="currentColor" />
      </svg>
    );
  }
  const words = typeof name === 'string' ? name.replace(/([A-Z])/g, ' $1').toLowerCase() : '';
  return (
    <span className="agui-a2ui-icon-name" role="img" aria-label={label ?? words} style={weighted(props.weight)}>
      {words}
    </span>
  );
});

/**
 * The messages a surface's text fields are showing right now. A Button reads them so it never says again
 * what a field above it already says; a message the fields do not show is still its to give.
 */
interface FieldMessages {
  add(message: string): () => void;
  subscribe(listener: () => void): () => void;
  snapshot(): ReadonlySet<string>;
}

function createFieldMessages(): FieldMessages {
  const counts = new Map<string, number>();
  const listeners = new Set<() => void>();
  let shown: ReadonlySet<string> = new Set();
  const publish = () => {
    shown = new Set(counts.keys());
    for (const listener of [...listeners]) listener();
  };
  return {
    add(message) {
      counts.set(message, (counts.get(message) ?? 0) + 1);
      publish();
      return () => {
        const left = (counts.get(message) ?? 1) - 1;
        if (left > 0) counts.set(message, left);
        else counts.delete(message);
        publish();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    snapshot: () => shown,
  };
}

const FieldMessagesContext = createContext<FieldMessages | undefined>(undefined);
const noMessages: ReadonlySet<string> = new Set();
const subscribeNone = () => () => undefined;

/** One per surface: its text fields report their failing messages to the buttons around them. */
export function FieldMessagesProvider({ children }: { children: ReactNode }): ReactElement {
  const [messages] = useState(createFieldMessages);
  return <FieldMessagesContext.Provider value={messages}>{children}</FieldMessagesContext.Provider>;
}

/**
 * Button: three variants, disabled while a check fails. Its first failing message that no text field of the
 * surface already shows appears under it, tied to it for assistive technology. When the fields say it all,
 * the button is disabled and adds nothing.
 */
const Button = createComponentImplementation(ButtonApi, ({ props, buildChild }) => {
  const hintId = useId();
  const messages = useContext(FieldMessagesContext);
  const read = messages?.snapshot ?? (() => noMessages);
  const fieldShows = useSyncExternalStore(messages?.subscribe ?? subscribeNone, read, read);
  const invalid = props.isValid === false;
  const hint = invalid ? props.validationErrors?.find((message) => !fieldShows.has(message)) : undefined;
  return (
    <span className="agui-a2ui-action" style={weighted(props.weight)}>
      <button
        type="button"
        className="agui-a2ui-btn"
        data-variant={props.variant ?? 'default'}
        disabled={invalid}
        aria-describedby={hint ? hintId : undefined}
        onClick={props.action}
        {...accessible(props.accessibility).aria}
      >
        {props.child ? buildChild(props.child) : null}
      </button>
      {hint && (
        <span id={hintId} className="agui-a2ui-hint">
          {hint}
        </span>
      )}
    </span>
  );
});

/** TextField: the label above the control, and a failing check's message tied to it. */
const TextField = createComponentImplementation(TextFieldApi, ({ props }) => {
  const id = useId();
  const errorId = `${id}-error`;
  const error = props.validationErrors?.[0];
  const messages = useContext(FieldMessagesContext);
  useEffect(() => (error && messages ? messages.add(error) : undefined), [error, messages]);
  const shared = {
    id,
    className: 'agui-a2ui-input',
    value: props.value ?? '',
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    'aria-description': str(props.accessibility?.description),
    'aria-label': props.label ? undefined : str(props.accessibility?.label),
    onChange: (event: { target: { value: string } }) => props.setValue(event.target.value),
  };
  return (
    <div className="agui-a2ui-field" style={weighted(props.weight)}>
      {props.label && (
        <label htmlFor={id} className="agui-a2ui-label">
          {props.label}
        </label>
      )}
      {props.variant === 'longText' ? (
        <textarea {...shared} rows={4} />
      ) : (
        <input {...shared} type={props.variant === 'number' ? 'number' : props.variant === 'obscured' ? 'password' : 'text'} autoComplete={props.variant === 'obscured' ? 'off' : undefined} />
      )}
      {error && (
        <span id={errorId} className="agui-a2ui-error">
          {error}
        </span>
      )}
    </div>
  );
});

/**
 * ChoicePicker: one group with the label as its name. Options are radios, checkboxes or toggle chips;
 * a mutually exclusive picker keeps exactly one value, a multiple one toggles each.
 */
const ChoicePicker = createComponentImplementation(ChoicePickerApi, ({ props }) => {
  const group = useId();
  const [filter, setFilter] = useState('');
  const values: readonly string[] = Array.isArray(props.value) ? props.value : [];
  const single = (props.variant ?? 'mutuallyExclusive') === 'mutuallyExclusive';
  const choose = (value: string) => props.setValue(single ? [value] : values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
  const needle = filter.trim().toLowerCase();
  const options = (props.options ?? []).filter((option) => !props.filterable || needle === '' || String(option.label).toLowerCase().includes(needle));
  const chips = props.displayStyle === 'chips';
  return (
    <fieldset className="agui-a2ui-choices" style={weighted(props.weight)} aria-label={props.label ? undefined : str(props.accessibility?.label)} aria-description={str(props.accessibility?.description)}>
      {props.label && <legend className="agui-a2ui-label">{props.label}</legend>}
      {props.filterable && <input type="text" className="agui-a2ui-input" placeholder="Filter options" aria-label={`Filter ${props.label ?? 'options'}`} value={filter} onChange={(event) => setFilter(event.target.value)} />}
      <div className={chips ? 'agui-a2ui-chips' : 'agui-a2ui-options'}>
        {options.map((option) =>
          chips ? (
            <button key={option.value} type="button" className="agui-a2ui-chip" aria-pressed={values.includes(option.value)} onClick={() => choose(option.value)}>
              {String(option.label)}
            </button>
          ) : (
            <label key={option.value} className="agui-a2ui-option">
              <input type={single ? 'radio' : 'checkbox'} name={single ? group : undefined} checked={values.includes(option.value)} onChange={() => choose(option.value)} />
              <span>{String(option.label)}</span>
            </label>
          ),
        )}
      </div>
    </fieldset>
  );
});

/** Tabs: the WAI-ARIA tabs pattern. Arrow keys, Home and End move between tabs and select them. */
const Tabs = createComponentImplementation(TabsApi, ({ props, buildChild }) => {
  const id = useId();
  const tabs = props.tabs ?? [];
  const [chosen, setChosen] = useState(0);
  const selected = Math.min(chosen, Math.max(tabs.length - 1, 0));
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: KeyboardEvent, to: number) => {
    event.preventDefault();
    const next = (to + tabs.length) % tabs.length;
    setChosen(next);
    refs.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') move(event, selected + 1);
    else if (event.key === 'ArrowLeft') move(event, selected - 1);
    else if (event.key === 'Home') move(event, 0);
    else if (event.key === 'End') move(event, tabs.length - 1);
  };
  const active = tabs[selected];
  return (
    <div className="agui-a2ui-tabs" style={weighted(props.weight)}>
      <div role="tablist" className="agui-a2ui-tablist" {...accessible(props.accessibility).aria} onKeyDown={onKeyDown}>
        {tabs.map((tab, at) => (
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
            {String(tab.title)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} className="agui-a2ui-tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}>
        {active ? buildChild(active.child) : null}
      </div>
    </div>
  );
});

/**
 * Modal: the trigger opens a native dialog. The browser traps focus inside, Escape and the close button
 * shut it and focus returns to the trigger. Clicking the backdrop shuts it too.
 */
const Modal = createComponentImplementation(ModalApi, ({ props, buildChild }) => {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);
  return (
    <>
      <div className="agui-a2ui-modal-trigger" onClick={() => setOpen(true)} style={weighted(props.weight)}>
        {props.trigger ? buildChild(props.trigger) : null}
      </div>
      {open && (
        <dialog
          ref={dialog}
          className="agui-a2ui-modal"
          {...accessible(props.accessibility).aria}
          aria-label={str(props.accessibility?.label) ?? 'Dialog'}
          onClose={() => setOpen(false)}
          onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
        >
          <button type="button" className="agui-a2ui-modal-close" aria-label="Close" onClick={() => dialog.current?.close()}>
            ×
          </button>
          <div className="agui-a2ui-modal-body">{props.content ? buildChild(props.content) : null}</div>
        </dialog>
      )}
    </>
  );
});

/**
 * What stands in for a component whose type the catalog does not list, in place of the renderer's raw red
 * line: an error that names the type, with the definition as it was received. Nothing is drawn for the
 * component, and it is not repaired or dropped from the list.
 */
export const unknownComponent = (type: string): ReactComponentImplementation =>
  createBinderlessComponentImplementation({ name: type, schema: z.object({}).passthrough() }, ({ context }) => {
    const { id, properties } = context.componentModel;
    return (
      <div role="alert" className="agui-a2ui-unknown">
        <Finding variant="err" kind={`Component ${id}`}>
          Unknown component type: {type}. The catalog has no such component, so nothing is drawn for it.
        </Finding>
        <details className="agui-a2ui-received">
          <summary>As received</summary>
          <CodeBlock text={JSON.stringify({ id, component: type, ...properties } satisfies Record<string, JsonValue | undefined>, null, 2)} aria-label={`Received component ${id}`} />
        </details>
      </div>
    );
  });

export const COMPONENTS: Readonly<Record<string, ReactComponentImplementation>> = { Row, Divider, Icon, Button, TextField, ChoicePicker, Tabs, Modal };
