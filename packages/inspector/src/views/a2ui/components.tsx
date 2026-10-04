import { Fragment, createContext, useContext, useEffect, useId, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode } from 'react';
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
import { ButtonView, IconView, ModalView, TabsView, UnknownView } from './parts';

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

/** Icon: see `IconView`. The inspector loads no icon font, so a named icon is drawn as its name. */
const Icon = createComponentImplementation(IconApi, ({ props }) => {
  const { name } = props;
  const label = accessible(props.accessibility).label;
  const drawn = typeof name === 'object' && name !== null && 'svgPath' in name ? { svgPath: String(name.svgPath) } : typeof name === 'string' ? name : '';
  return <IconView name={drawn} label={label} style={weighted(props.weight)} />;
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
  const messages = useContext(FieldMessagesContext);
  const read = messages?.snapshot ?? (() => noMessages);
  const fieldShows = useSyncExternalStore(messages?.subscribe ?? subscribeNone, read, read);
  const invalid = props.isValid === false;
  const hint = invalid ? props.validationErrors?.find((message) => !fieldShows.has(message)) : undefined;
  return (
    <ButtonView variant={props.variant ?? 'default'} disabled={invalid} hint={hint} aria={accessible(props.accessibility).aria} style={weighted(props.weight)} onClick={props.action}>
      {props.child ? buildChild(props.child) : null}
    </ButtonView>
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

/** Tabs: the WAI-ARIA tabs pattern, as `TabsView` draws it. */
const Tabs = createComponentImplementation(TabsApi, ({ props, buildChild }) => {
  const tabs = props.tabs ?? [];
  return <TabsView titles={tabs.map((tab) => String(tab.title))} panel={(at) => (tabs[at] ? buildChild(tabs[at].child) : null)} aria={accessible(props.accessibility).aria} style={weighted(props.weight)} />;
});

/** Modal: the trigger opens the native dialog of `ModalView`. */
const Modal = createComponentImplementation(ModalApi, ({ props, buildChild }) => (
  <ModalView trigger={props.trigger ? buildChild(props.trigger) : null} content={props.content ? buildChild(props.content) : null} label={str(props.accessibility?.label)} aria={accessible(props.accessibility).aria} style={weighted(props.weight)} />
));

/**
 * What stands in for a component whose type the catalog does not list, in place of the renderer's raw red
 * line: an error that names the type, with the definition as it was received. Nothing is drawn for the
 * component, and it is not repaired or dropped from the list.
 */
export const unknownComponent = (type: string): ReactComponentImplementation =>
  createBinderlessComponentImplementation({ name: type, schema: z.object({}).passthrough() }, ({ context }) => {
    const { id, properties } = context.componentModel;
    return <UnknownView id={id} type={type} definition={{ id, component: type, ...properties } satisfies Record<string, JsonValue | undefined>} />;
  });

export const COMPONENTS: Readonly<Record<string, ReactComponentImplementation>> = { Row, Divider, Icon, Button, TextField, ChoicePicker, Tabs, Modal };
