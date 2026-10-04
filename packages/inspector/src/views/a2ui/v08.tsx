import { useLayoutEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { A2UIProvider, A2UIRenderer, ComponentNode, ComponentRegistry, useA2UIActions, useA2UIComponent, useA2UIState, type A2UIComponentProps, type Types } from '@a2ui/react/v0_8';
import type { A2uiAction, JsonValue } from '../../contracts';
import { fromV08Action } from '../../core/a2ui/actions';
import type { V08Feed } from '../../core/a2ui/index';
import { BlockedView, ButtonView, IconView, ModalView, TabsView, UnknownView, type BlockedKind } from './parts';
import { V08_THEME } from './v08-theme';

// A2UI v0.8 surfaces (spec 008, FR-002, FR-003, FR-007 to FR-010). The v0.8 renderer owns its message processor
// (its provider makes one, and the contexts its components read are not exported), so the session cannot apply
// v0.8 messages itself. It validates them and hands the accepted ones on in a feed, and this module pumps the feed
// into the provider. Eight stock components are replaced: the ones that would load an address or turn text into
// links (Text, Image, Video, AudioPlayer), and the ones without a role, a name or keyboard use (Icon, Tabs, Modal,
// Button). They share their markup with the v0.9 components (parts.tsx). The rest are the renderer's own.

/** The id the renderer gives the stylesheet it injects. The page's policy refuses inline styles, so it must never try. */
const RENDERER_STYLE_ID = 'a2ui-structural-styles';

/**
 * The renderer injects a `<style>` into the document head on its first mount unless an element with this id is
 * already there, and the page's `style-src 'self'` would refuse it and report a violation. A template with the id
 * stops the attempt. The inspector styles v0.8 surfaces itself (a2ui.css and v08-theme.ts).
 */
function reserveRendererStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(RENDERER_STYLE_ID) !== null) return;
  const marker = document.createElement('template');
  marker.id = RENDERER_STYLE_ID;
  document.head.append(marker);
}

/** `weight` is a flex-grow factor the renderer passes to a component as a custom property of its host element. */
const hostStyle = (node: { readonly weight?: number | string | undefined }): CSSProperties => (node.weight === undefined ? {} : ({ '--weight': node.weight } as CSSProperties));

const Host = ({ name, node, children }: { name: string; node: { readonly weight?: number | string | undefined }; children: ReactNode }): ReactElement => (
  <div className={`a2ui-${name}`} style={hostStyle(node)}>
    {children}
  </div>
);

/** Text is plain text. A heading hint gives a heading, `caption` small text, anything else a paragraph. */
function Text({ node, surfaceId }: A2UIComponentProps<Types.TextNode>): ReactElement {
  const { resolveString } = useA2UIComponent(node, surfaceId);
  const value = resolveString(node.properties.text) ?? '';
  const hint = node.properties.usageHint;
  const content =
    hint === 'h1' ? <h1>{value}</h1> : hint === 'h2' ? <h2>{value}</h2> : hint === 'h3' ? <h3>{value}</h3> : hint === 'h4' ? <h4>{value}</h4> : hint === 'h5' ? <h5>{value}</h5> : hint === 'caption' ? <p><em>{value}</em></p> : <p>{value}</p>;
  return <Host name="text" node={node}>{content}</Host>;
}

/** A component that would load its `url` names it instead. */
const media =
  (kind: BlockedKind) =>
  ({ node, surfaceId }: A2UIComponentProps<Types.ImageNode | Types.VideoNode | Types.AudioPlayerNode>): ReactElement => {
    const { resolveString } = useA2UIComponent(node, surfaceId);
    return (
      <Host name={kind.toLowerCase()} node={node}>
        <BlockedView kind={kind} url={resolveString(node.properties.url) ?? ''} />
      </Host>
    );
  };

function Icon({ node, surfaceId }: A2UIComponentProps<Types.IconNode>): ReactElement {
  const { resolveString } = useA2UIComponent(node, surfaceId);
  return (
    <Host name="icon" node={node}>
      <IconView name={resolveString(node.properties.name) ?? ''} />
    </Host>
  );
}

function Button({ node, surfaceId }: A2UIComponentProps<Types.ButtonNode>): ReactElement {
  const { sendAction } = useA2UIComponent(node, surfaceId);
  const { action, child, primary } = node.properties;
  return (
    <Host name="button" node={node}>
      <ButtonView variant={primary === true ? 'primary' : 'default'} onClick={() => action && sendAction(action)}>
        <ComponentNode node={child} surfaceId={surfaceId} />
      </ButtonView>
    </Host>
  );
}

function Tabs({ node, surfaceId }: A2UIComponentProps<Types.TabsNode>): ReactElement {
  const { resolveString } = useA2UIComponent(node, surfaceId);
  const items = node.properties.tabItems ?? [];
  return (
    <Host name="tabs" node={node}>
      <TabsView titles={items.map((item) => resolveString(item.title) ?? '')} panel={(at) => (items[at] ? <ComponentNode node={items[at].child} surfaceId={surfaceId} /> : null)} />
    </Host>
  );
}

function Modal({ node, surfaceId }: A2UIComponentProps<Types.ModalNode>): ReactElement {
  const { entryPointChild, contentChild } = node.properties;
  return (
    <Host name="modal" node={node}>
      <ModalView trigger={<ComponentNode node={entryPointChild} surfaceId={surfaceId} />} content={<ComponentNode node={contentChild} surfaceId={surfaceId} />} />
    </Host>
  );
}

/** The stored definition of a component, as the agent sent it. A templated item has a suffix on its id. */
function definitionOf(surface: Types.Surface | undefined, id: string): JsonValue {
  let key = id;
  while (surface !== undefined && !surface.components.has(key) && key.includes(':')) key = key.slice(0, key.lastIndexOf(':'));
  return (surface?.components.get(key) ?? { id }) as JsonValue;
}

/** What draws a component whose type the catalog lacks: an error in place that names the type and shows the definition as received. */
function Unknown({ node, surfaceId }: A2UIComponentProps): ReactElement {
  const { getSurface } = useA2UIActions();
  return <UnknownView id={node.id} type={node.type} definition={definitionOf(getSurface(surfaceId), node.id)} />;
}

const REPLACEMENTS = { Text, Image: media('Image'), Video: media('Video'), AudioPlayer: media('AudioPlayer'), Icon, Button, Tabs, Modal } as const;

/**
 * The renderer's components live in a registry that every nested component reads without a handle, so the
 * replacements go in it. The provider fills it with the stock components on its first render, and would write
 * them over anything put in earlier, so this runs while the pump renders, after the provider and before the
 * components. The writes are the same every time.
 */
function registerReplacements(): ComponentRegistry {
  const registry = ComponentRegistry.getInstance();
  for (const [type, component] of Object.entries(REPLACEMENTS)) registry.register(type, { component: component as never });
  return registry;
}

/** The type of each component a message defines, so one the registry lacks gets an error in place. */
function typesOf(message: JsonValue): string[] {
  const components = (message as { surfaceUpdate?: { components?: Array<{ component?: object }> } }).surfaceUpdate?.components;
  return Array.isArray(components) ? components.flatMap((entry) => Object.keys(entry.component ?? {})) : [];
}

/** The part of the session the pump reports back to. */
interface Refusals {
  refused(index: number, operation: JsonValue, error: unknown): void;
}

/**
 * Feeds the session's accepted v0.8 messages to the provider's processor, once each. A new epoch means the
 * list was rebuilt, so the surfaces are cleared and everything is replayed. A message the processor still
 * throws on (a circular reference, a component that fails its shape) goes back to the session as an issue.
 */
function Pump({ session, feed, children }: { session: Refusals; feed: V08Feed; children(ids: readonly string[], epoch: number): ReactNode }): ReactElement {
  const registry = registerReplacements();
  const { processMessages, clearSurfaces, getSurfaces } = useA2UIActions();
  useA2UIState();
  const fed = useRef({ epoch: feed.epoch, count: 0 });
  useLayoutEffect(() => {
    const state = fed.current;
    if (state.epoch !== feed.epoch) {
      clearSurfaces();
      state.epoch = feed.epoch;
      state.count = 0;
    }
    while (state.count < feed.messages.length) {
      const { index, message } = feed.messages[state.count++]!;
      for (const type of typesOf(message)) if (!registry.has(type)) registry.register(type, { component: Unknown as never });
      try {
        // The processor keeps what it is given, so it gets a copy: the received list never changes.
        processMessages([structuredClone(message) as never]);
      } catch (error) {
        session.refused(index, message, error);
        // The provider redraws after a message, and skips that when the processor throws.
        processMessages([]);
      }
    }
  }, [feed, session, registry, processMessages, clearSurfaces]);
  const ids = [...getSurfaces()].filter(([, surface]) => surface.componentTree !== null).map(([id]) => id);
  return <>{children(ids, feed.epoch)}</>;
}

/**
 * The v0.8 renderer for one activity. `children` draws the whole list of surfaces, in order, and calls
 * `draw(id)` for each v0.8 one, so surfaces of both versions can sit in one list.
 */
export function V08Host({
  session,
  feed,
  onAction,
  children,
}: {
  session: Refusals;
  feed: V08Feed;
  onAction(action: A2uiAction): void;
  children(ids: readonly string[], epoch: number): ReactNode;
}): ReactElement {
  reserveRendererStyles();
  return (
    <A2UIProvider
      theme={V08_THEME}
      onAction={(message) => {
        const action = fromV08Action(message);
        if (action !== undefined) onAction(action);
      }}
    >
      <Pump session={session} feed={feed}>
        {children}
      </Pump>
    </A2UIProvider>
  );
}

/** One v0.8 surface. */
export const V08Surface = ({ id }: { id: string }): ReactElement => <A2UIRenderer surfaceId={id} />;
