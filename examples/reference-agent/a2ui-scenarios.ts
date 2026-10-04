// Deterministic, model-free A2UI scenarios (L05, US3; spec 008 for v0.8). Each is the `a2ui_operations` list an
// `a2ui-surface` activity carries, or a pure function from the action the user sent to the next list.
// Nothing here talks to a model or a network: unit tests and the Playwright spec feed these to the
// real renderer and compare what comes back. Erasable TypeScript only, so Node can run it directly.

/** The id the bundled basic catalog answers to; any other catalog id is an error, never a fetch. */
export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/** The id the v0.8 standard catalog answers to. A v0.8 surface that names no catalog uses it too. */
export const STANDARD_V08_CATALOG_ID = 'https://a2ui.org/specification/v0_8/standard_catalog_definition.json';

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

// ---- A2UI v0.8 (spec 008) ----------------------------------------------------------------------------
// v0.8 messages carry no `version` key. A surface is built by `surfaceUpdate` (components), `dataModelUpdate`
// (data as key and typed value entries) and `beginRendering` (which names the root, and so makes it visible).
// Every component a message mentions must be defined in that same message.

const lit = (value: string) => ({ literalString: value });
const text = (id: string, value: string, usageHint?: string): Operation => ({ id, component: { Text: { text: lit(value), ...(usageHint !== undefined && { usageHint }) } } });

/** The expense form's components. With `echo`, the column also lists a line that shows what the agent received. */
function expenseComponents(echo?: string): readonly Operation[] {
  const children = ['title', 'amount', 'category', 'receipt', 'urgency', 'policy', 'submit', ...(echo === undefined ? [] : ['echo'])];
  return [
    { id: 'root', component: { Column: { children: { explicitList: children } } } },
    text('title', 'Expense report', 'h2'),
    { id: 'amount', component: { TextField: { label: lit('Amount'), text: { path: '/amount' }, textFieldType: 'shortText' } } },
    {
      id: 'category',
      component: {
        MultipleChoice: {
          description: lit('Category'),
          selections: { path: '/category' },
          maxAllowedSelections: 1,
          options: [
            { label: lit('Travel'), value: 'travel' },
            { label: lit('Meals'), value: 'meals' },
            { label: lit('Equipment'), value: 'equipment' },
          ],
        },
      },
    },
    { id: 'receipt', component: { CheckBox: { label: lit('Receipt attached'), value: { path: '/receipt' } } } },
    { id: 'urgency', component: { Slider: { label: lit('Urgency'), value: { path: '/urgency' }, minValue: 0, maxValue: 5 } } },
    { id: 'policy', component: { Tabs: { tabItems: [{ title: lit('Limits'), child: 'limits' }, { title: lit('Receipts'), child: 'receipts' }] } } },
    text('limits', 'Meals are capped at 40 per day.'),
    text('receipts', 'Keep every receipt above 25.'),
    text('submit-label', 'Submit expense'),
    {
      id: 'submit',
      component: {
        Button: {
          child: 'submit-label',
          primary: true,
          action: {
            name: 'submit_expense',
            context: ['amount', 'category', 'receipt', 'urgency'].map((key) => ({ key, value: { path: `/${key}` } })),
          },
        },
      },
    },
    ...(echo === undefined ? [] : [text('echo', echo)]),
  ];
}

const statusUpdate = (status: string): Operation => ({ dataModelUpdate: { surfaceId: 'status', contents: [{ key: 'status', valueString: status }] } });

/**
 * Two v0.8 surfaces in one activity. `expense` is a form whose button binds four values; it names no catalog, so
 * it uses the standard one. `status` shows a line from its own data and a button that withdraws the report; it
 * names the standard catalog.
 */
export const v08Surfaces: readonly Operation[] = [
  { surfaceUpdate: { surfaceId: 'expense', components: expenseComponents() } },
  {
    dataModelUpdate: {
      surfaceId: 'expense',
      contents: [
        { key: 'amount', valueString: '42.50' },
        { key: 'receipt', valueBoolean: false },
        { key: 'urgency', valueNumber: 2 },
      ],
    },
  },
  { beginRendering: { surfaceId: 'expense', root: 'root' } },
  {
    surfaceUpdate: {
      surfaceId: 'status',
      components: [
        { id: 'root', component: { Column: { children: { explicitList: ['state', 'withdraw'] } } } },
        { id: 'state', component: { Text: { text: { path: '/status' } } } },
        text('withdraw-label', 'Withdraw'),
        { id: 'withdraw', component: { Button: { child: 'withdraw-label', action: { name: 'withdraw_expense', context: [{ key: 'status', value: { path: '/status' } }] } } } },
      ],
    },
  },
  statusUpdate('Waiting for review'),
  { beginRendering: { surfaceId: 'status', catalogId: STANDARD_V08_CATALOG_ID, root: 'root' } },
];

/**
 * What the scripted continuation answers for a v0.8 action. `submit_expense` changes the status text and adds a line
 * that shows the received context. `withdraw_expense` removes the form and changes the status text. Both keep the
 * messages that came before, as they were.
 */
export function v08Continuation(previous: readonly Operation[], action: UserAction): readonly Operation[] {
  if (action.name === 'withdraw_expense') return [...previous, { deleteSurface: { surfaceId: 'expense' } }, statusUpdate('Withdrawn')];
  const { amount, category } = action.context;
  const received = `Received ${action.name} from ${action.sourceComponentId} on ${action.surfaceId}: ${JSON.stringify(action.context)}`;
  return [
    ...previous,
    statusUpdate(`Submitted ${String(amount ?? '')} for ${category === undefined || category === null ? 'no category' : String(category)}`),
    { surfaceUpdate: { surfaceId: 'expense', components: expenseComponents(received) } },
  ];
}

/**
 * Surfaces of both versions in one list: one of each, and a pair that share a surface id. A message changes only
 * the surface of its own version, so the pair stays two surfaces.
 */
export const mixedSurfaces: readonly Operation[] = [
  { version: V, createSurface: { surfaceId: 'nine', catalogId: BASIC_CATALOG_ID } },
  { version: V, updateComponents: { surfaceId: 'nine', components: [{ id: 'root', component: 'Text', text: 'Surface in v0.9' }] } },
  { surfaceUpdate: { surfaceId: 'eight', components: [text('root', 'Surface in v0.8')] } },
  { beginRendering: { surfaceId: 'eight', root: 'root' } },
  { version: V, createSurface: { surfaceId: 'same', catalogId: BASIC_CATALOG_ID } },
  { version: V, updateComponents: { surfaceId: 'same', components: [{ id: 'root', component: 'Text', text: 'Same id, v0.9' }] } },
  { surfaceUpdate: { surfaceId: 'same', components: [text('root', 'Same id, v0.8')] } },
  { beginRendering: { surfaceId: 'same', root: 'root' } },
];
