// Deterministic, model-free A2UI v0.9 scenarios (L05, US3). Each is the `a2ui_operations` list an
// `a2ui-surface` activity carries, or a pure function from the action the user sent to the next list.
// Nothing here talks to a model or a network: unit tests and the Playwright spec feed these to the
// real renderer and compare what comes back. Erasable TypeScript only, so Node can run it directly.

/** The id the bundled basic catalog answers to; any other catalog id is an error, never a fetch. */
export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/** A host no test may ever reach: a request to it is a failed zero-third-party check. */
export const THIRD_PARTY_HOST = 'third-party.invalid';

export type Operation = Readonly<Record<string, unknown>>;

/** The five fields forwardedProps.a2uiAction.userAction carries. */
export interface UserAction {
  readonly name: string;
  readonly surfaceId: string;
  readonly sourceComponentId: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
}

const V = 'v0.9';

/**
 * A form: a note field, a count read from the data model and a button whose action context binds both,
 * so the context an action carries proves the renderer resolved the data model.
 */
export const formSurface: readonly Operation[] = [
  { version: V, createSurface: { surfaceId: 'form', catalogId: BASIC_CATALOG_ID } },
  {
    version: V,
    updateComponents: {
      surfaceId: 'form',
      components: [
        { id: 'root', component: 'Column', children: ['title', 'note', 'send'] },
        { id: 'title', component: 'Text', text: 'Order check', variant: 'h3' },
        { id: 'note', component: 'TextField', label: 'Note', value: { path: '/note' } },
        { id: 'send-label', component: 'Text', text: 'Send note' },
        {
          id: 'send',
          component: 'Button',
          child: 'send-label',
          variant: 'primary',
          action: { event: { name: 'send_note', context: { note: { path: '/note' }, count: { path: '/count' } } } },
        },
      ],
    },
  },
  { version: V, updateDataModel: { surfaceId: 'form', path: '/', value: { note: 'first draft', count: 1 } } },
];

/** What the scripted continuation (not L02's runtime) answers: the received envelope, shown back. */
export function continuation(previous: readonly Operation[], action: UserAction): readonly Operation[] {
  const received = `Received ${action.name} from ${action.sourceComponentId} on ${action.surfaceId}: ${JSON.stringify(action.context)}`;
  return [
    ...previous,
    {
      version: V,
      updateComponents: {
        surfaceId: action.surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['title', 'note', 'send', 'echo'] },
          { id: 'echo', component: 'Text', text: received },
        ],
      },
    },
    { version: V, updateDataModel: { surfaceId: action.surfaceId, path: '/count', value: 2 } },
  ];
}

/** A second surface in the same activity, then removal of the first. */
export const secondSurface: readonly Operation[] = [
  { version: V, createSurface: { surfaceId: 'status', catalogId: BASIC_CATALOG_ID } },
  { version: V, updateComponents: { surfaceId: 'status', components: [{ id: 'root', component: 'Text', text: 'Second surface' }] } },
];

export const deleteForm: Operation = { version: V, deleteSurface: { surfaceId: 'form' } };

/** Every way a surface can reach for something outside the page. */
export const externalResources: readonly Operation[] = [
  { version: V, createSurface: { surfaceId: 'media', catalogId: BASIC_CATALOG_ID } },
  {
    version: V,
    updateComponents: {
      surfaceId: 'media',
      components: [
        { id: 'root', component: 'Column', children: ['image', 'video', 'audio', 'open'] },
        { id: 'image', component: 'Image', url: `http://${THIRD_PARTY_HOST}/picture.png`, description: 'A remote picture' },
        { id: 'video', component: 'Video', url: `http://${THIRD_PARTY_HOST}/clip.mp4` },
        { id: 'audio', component: 'AudioPlayer', url: `http://${THIRD_PARTY_HOST}/sound.mp3`, description: 'A remote sound' },
        { id: 'open-label', component: 'Text', text: 'Open page' },
        {
          id: 'open',
          component: 'Button',
          child: 'open-label',
          action: { functionCall: { call: 'openUrl', args: { url: `http://${THIRD_PARTY_HOST}/page` } } },
        },
      ],
    },
  },
];

/** Entries a renderer cannot take, between two that it can. Each must be reported, none may stop the rest. */
export const malformedOperations: readonly unknown[] = [
  { version: V, createSurface: { surfaceId: 'ok', catalogId: BASIC_CATALOG_ID } },
  'not an object',
  { createSurface: { surfaceId: 'no-version', catalogId: BASIC_CATALOG_ID } },
  { version: 'v0.8', beginRendering: { surfaceId: 'old', root: 'root' } },
  { version: V, createSurface: { surfaceId: 'elsewhere', catalogId: 'https://catalog.invalid/custom.json' } },
  { version: V, updateComponents: { surfaceId: 'ghost', components: [{ id: 'root', component: 'Text', text: 'x' }] } },
  { version: V, updateComponents: { surfaceId: 'ok', components: [{ id: 'root', component: 'Text', text: 'Survivor' }] } },
];
