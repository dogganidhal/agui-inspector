// The A2UI showcase (FX12): the demo's A2UI agent answers one of several self-contained stories, each
// picked by a quick message or, for the next step of a story, by the action a surface sent. Every story is
// a pure function of the run input: nothing is remembered between runs, so a later step rebuilds what it
// needs from the action's name and its resolved `context`. The activity a story paints keeps one message
// id for all its runs, so a later run changes the surface in place; the stories that finish in one run take
// their ids from the run id. Everything is fictional and made of the standard catalogs alone (the v0.9 basic
// catalog, and the v0.8 standard catalog for the expense report): no picture, no address that resolves, no
// catalog beyond the bundled ones.
//
// What each story is there to show:
//   find a table   a results surface (List template of Cards), a booking surface opened beside it, both
//                  deleted for a confirmation; context resolved from the data model and the template scope
//   support ticket client-side checks on fields and on the button, a server-side rule the client cannot see,
//                  answered by a data-model update alone
//   deploy board   one surface that keeps changing while the run streams, through ACTIVITY_DELTA patches
//                  that append updateDataModel operations; a later run pauses it with one more patch
//   self-repair    the middleware's lifecycle on one activity: building, an invalid attempt, retrying,
//                  then the valid surface, or failed once the attempts run out
//   sandbox probe  everything the inspector refuses: media, openUrl, an unknown component, an unknown
//                  catalog, an operation that declares v0.8 as its version, a malformed list, markup in text
//   expense report two A2UI v0.8 surfaces (no `version` key anywhere): a form whose button binds four values and
//                  a status line with a withdraw button; submitting changes the status and adds a line that
//                  shows what the agent received, withdrawing removes the form with a v0.8 deleteSurface
//
// Returns events only; the run's first and last frame belong to scenarios.ts, which also owns the
// framing. Imports nothing from Node, React or a worker. Erasable TypeScript only, so Node can run it.
import { BASIC_CATALOG_ID, THIRD_PARTY_HOST, externalResources, malformedOperations, v08Continuation, v08Surfaces, type Operation, type UserAction } from './a2ui-scenarios.ts';

/** What the last user message asks the A2UI agent to show. Anything else, or nothing, gets the order form. Quick messages follow this order. */
export const SHOWCASE = {
  findTable: 'Find a table for 4',
  supportTicket: 'Open a support ticket',
  deployBoard: 'Deploy the release',
  selfRepair: 'Compare three laptops',
  neverValid: 'Compare three laptops (never valid)',
  sandbox: 'Probe the sandbox',
  v08: 'Review an expense report (v0.8)',
} as const;

/** The actions the showcase's surfaces send, and the stories that answer them. */
export const ACTIONS = {
  bookTable: 'book_table',
  cancelBooking: 'cancel_booking',
  confirmBooking: 'confirm_booking',
  bookAnother: 'book_another',
  submitTicket: 'submit_ticket',
  pauseDeploy: 'pause_deploy',
  submitExpense: 'submit_expense',
  withdrawExpense: 'withdraw_expense',
} as const;

const V = 'v0.9';
const ACTIVITY_TYPE = 'a2ui-surface';

type Fields = Readonly<Record<string, unknown>>;

// ---- operations and components ------------------------------------------------------------------

const createSurface = (surfaceId: string): Operation => ({ version: V, createSurface: { surfaceId, catalogId: BASIC_CATALOG_ID } });
const updateComponents = (surfaceId: string, components: readonly object[]): Operation => ({ version: V, updateComponents: { surfaceId, components } });
const updateDataModel = (surfaceId: string, path: string, value: unknown): Operation => ({ version: V, updateDataModel: { surfaceId, path, value } });
const deleteSurface = (surfaceId: string): Operation => ({ version: V, deleteSurface: { surfaceId } });

const bind = (path: string) => ({ path });
/** A function call as a dynamic value. Nested inside `formatString`, the same call is written `${name(arg: value)}`. */
const call = (name: string, args: Fields, returnType = 'string') => ({ call: name, args, returnType });
const interpolate = (value: string) => call('formatString', { value });

const text = (id: string, value: string | object, variant?: string, extra: Fields = {}) => ({ id, component: 'Text', text: value, ...(variant !== undefined && { variant }), ...extra });
const column = (id: string, children: readonly string[], extra: Fields = {}) => ({ id, component: 'Column', children, ...extra });
const row = (id: string, children: readonly string[], extra: Fields = {}) => ({ id, component: 'Row', children, ...extra });
const card = (id: string, child: string) => ({ id, component: 'Card', child });
const divider = (id: string) => ({ id, component: 'Divider' });

/** A button and the text it shows: the catalog's Button takes a child component, not a label. */
const button = (id: string, label: string, action: object, extra: Fields = {}) => [
  { id, component: 'Button', child: `${id}-label`, action, ...extra },
  text(`${id}-label`, label),
];
const send = (name: string, context: Fields = {}) => ({ event: { name, context } });
const valid = (condition: object, message: string) => ({ condition, message });

const say = (messageId: string, delta: string) => [
  { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId, delta },
  { type: 'TEXT_MESSAGE_END', messageId },
];
const snapshot = (messageId: string, content: object) => ({ type: 'ACTIVITY_SNAPSHOT', messageId, activityType: ACTIVITY_TYPE, content, replace: true });
const surfaces = (messageId: string, operations: readonly unknown[]) => snapshot(messageId, { a2ui_operations: operations });
/** One delta: each operation is appended to the activity's list, so a surface already on screen keeps what the user typed. */
const append = (messageId: string, operations: readonly Operation[]) => ({
  type: 'ACTIVITY_DELTA',
  messageId,
  activityType: ACTIVITY_TYPE,
  patch: operations.map((value) => ({ op: 'add', path: '/a2ui_operations/-', value })),
});

// What a context holds is whatever a client sent: read it defensively and fall back to the story's default.
const asText = (value: unknown, fallback: string): string => (typeof value === 'string' && value !== '' ? value : fallback);
const asWhole = (value: unknown, fallback: number): number => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? Math.round(number) : fallback;
};
const first = (value: unknown): string | undefined => (Array.isArray(value) ? value.find((item) => typeof item === 'string') : typeof value === 'string' ? value : undefined);
/** Four characters of the run id, for a reference number that differs between runs. */
const tail = (runId: string): string => runId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase().padStart(4, '0');

// ---- find a table -------------------------------------------------------------------------------

const TABLE_ACTIVITY = 'a2ui-find-table';
const GUESTS = 4;
const TABLE_TIME = '2026-10-17T19:30';

/** Fictional places. `deposit` is euros per guest. */
export const RESTAURANTS = [
  { id: 'r-ours', name: 'Le Petit Ours', cuisine: 'French bistro', area: 'Old Harbor', time: '19:30', deposit: 10 },
  { id: 'r-verde', name: 'Casa Verde', cuisine: 'Tapas', area: 'Market Square', time: '20:00', deposit: 8 },
  { id: 'r-pine', name: 'Harbor & Pine', cuisine: 'Seafood', area: 'North Quay', time: '20:15', deposit: 12 },
] as const;

const SEATING: Readonly<Record<string, string>> = { inside: 'Inside', terrace: 'Terrace', bar: 'At the bar' };
const restaurantFor = (id: unknown) => RESTAURANTS.find((place) => place.id === id) ?? RESTAURANTS[0];

/** Run 1: the results. `Book` sends the card's own fields (template scope) and the party size (data model). */
export const tableResults: readonly Operation[] = [
  createSurface('results'),
  updateComponents('results', [
    column('root', ['results-title', 'results-intro', 'results-list']),
    text('results-title', 'Tables for 4 tonight', 'h2'),
    text('results-intro', 'Three places have a table free. Press Book to hold one.', 'caption'),
    { id: 'results-list', component: 'List', children: { componentId: 'result', path: '/restaurants' } },
    card('result', 'result-body'),
    column('result-body', ['result-name', 'result-meta', 'result-divider', 'result-foot']),
    text('result-name', bind('name'), 'h3'),
    text('result-meta', interpolate('${cuisine} · ${area}'), 'caption'),
    divider('result-divider'),
    row('result-foot', ['result-slot', 'result-book'], { justify: 'spaceBetween', align: 'center' }),
    text('result-slot', interpolate("Free at ${time} · ${formatCurrency(value: ${deposit}, currency: 'EUR')} deposit a guest")),
    ...button('result-book', 'Book', send(ACTIONS.bookTable, { restaurantId: bind('id'), restaurant: bind('name'), time: bind('time'), party: bind('/party') }), { variant: 'primary' }),
  ]),
  updateDataModel('results', '/', { party: GUESTS, restaurants: RESTAURANTS }),
];

/**
 * Run 2: the booking form, beside the results. Confirm is disabled until both checks pass, and its context
 * carries what the form holds when it is pressed, resolved from the data model.
 */
export function tableBooking(restaurantId: unknown, guests: number = GUESTS): readonly Operation[] {
  const place = restaurantFor(restaurantId);
  // A text field holds a string and `numeric` takes a number, so the renderer would report an error on every check: a pattern it is.
  const guestsAreFine = call('regex', { value: bind('/booking/guests'), pattern: '^[1-8]$' }, 'boolean');
  return [
    createSurface('booking'),
    updateComponents('booking', [
      card('root', 'booking-body'),
      column('booking-body', ['booking-title', 'booking-note', 'booking-guests', 'booking-when', 'booking-seating', 'booking-terms', 'booking-divider', 'booking-actions']),
      text('booking-title', interpolate('Book ${/booking/restaurant}'), 'h2'),
      text('booking-note', 'The table is held for 15 minutes once you confirm.', 'caption'),
      { id: 'booking-guests', component: 'TextField', label: 'Guests', variant: 'number', value: bind('/booking/guests'), checks: [valid(guestsAreFine, 'Tables seat 1 to 8 guests.')] },
      { id: 'booking-when', component: 'DateTimeInput', label: 'Date and time', enableDate: true, enableTime: true, value: bind('/booking/when'), checks: [valid(call('required', { value: bind('/booking/when') }, 'boolean'), 'Pick a date and time.')] },
      {
        id: 'booking-seating',
        component: 'ChoicePicker',
        label: 'Seating',
        variant: 'mutuallyExclusive',
        displayStyle: 'chips',
        options: Object.entries(SEATING).map(([value, label]) => ({ label, value })),
        value: bind('/booking/seating'),
      },
      { id: 'booking-terms', component: 'CheckBox', label: 'I accept the 24-hour cancellation policy', value: bind('/booking/terms') },
      divider('booking-divider'),
      row('booking-actions', ['booking-cancel', 'booking-confirm'], { justify: 'end' }),
      ...button('booking-cancel', 'Cancel', send(ACTIONS.cancelBooking, { restaurantId: place.id })),
      ...button(
        'booking-confirm',
        'Confirm booking',
        send(ACTIONS.confirmBooking, {
          restaurantId: place.id,
          restaurant: bind('/booking/restaurant'),
          guests: bind('/booking/guests'),
          when: bind('/booking/when'),
          seating: bind('/booking/seating'),
          terms: bind('/booking/terms'),
        }),
        { variant: 'primary', checks: [valid(guestsAreFine, 'Set the number of guests first.'), valid(bind('/booking/terms'), 'Accept the cancellation policy to confirm.')] },
      ),
    ]),
    updateDataModel('booking', '/', { booking: { restaurant: place.name, guests: String(guests), when: TABLE_TIME, seating: ['inside'], terms: false } }),
  ];
}

/** Run 3: a confirmation in place of both surfaces, with every figure formatted by the renderer. */
function tableConfirmation(runId: string, context: Fields): readonly Operation[] {
  const place = restaurantFor(context.restaurantId);
  const guests = Math.max(1, Math.min(8, asWhole(context.guests, GUESTS)));
  const seating = SEATING[first(context.seating) ?? ''] ?? SEATING.inside!;
  return [
    createSurface('confirmation'),
    updateComponents('confirmation', [
      card('root', 'done-body'),
      column('done-body', ['done-title', 'done-when', 'done-party', 'done-deposit', 'done-reference', 'done-again']),
      text('done-title', interpolate('Table booked at ${/confirmation/restaurant}'), 'h2'),
      text('done-when', interpolate("${formatDate(value: ${/confirmation/when}, format: 'EEEE d MMMM')} at ${formatDate(value: ${/confirmation/when}, format: 'HH:mm')}")),
      text('done-party', interpolate("${/confirmation/guests} ${pluralize(value: ${/confirmation/guests}, one: 'guest', other: 'guests')} · ${/confirmation/seating}")),
      text('done-deposit', interpolate("Deposit ${formatCurrency(value: ${/confirmation/deposit}, currency: 'EUR')}")),
      text('done-reference', interpolate('Reference ${/confirmation/reference}'), 'caption'),
      ...button('done-again', 'Book another', send(ACTIONS.bookAnother), { variant: 'borderless' }),
    ]),
    updateDataModel('confirmation', '/', {
      confirmation: { restaurant: place.name, when: asText(context.when, TABLE_TIME), guests, seating, deposit: place.deposit * guests, reference: `TB-${tail(runId)}` },
    }),
  ];
}

function findTable(runId: string, action: UserAction | undefined): readonly object[] | undefined {
  if (action === undefined) return [surfaces(TABLE_ACTIVITY, tableResults)];
  const { context } = action;
  switch (action.name) {
    case ACTIONS.bookTable:
      return [surfaces(TABLE_ACTIVITY, [...tableResults, ...tableBooking(context.restaurantId, asWhole(context.party, GUESTS))])];
    case ACTIONS.cancelBooking:
      return [surfaces(TABLE_ACTIVITY, [...tableResults, ...tableBooking(context.restaurantId), deleteSurface('booking')])];
    case ACTIONS.confirmBooking:
      return [surfaces(TABLE_ACTIVITY, [...tableResults, ...tableBooking(context.restaurantId), deleteSurface('results'), deleteSurface('booking'), ...tableConfirmation(runId, context)])];
    case ACTIONS.bookAnother:
      return [surfaces(TABLE_ACTIVITY, tableResults)];
    default:
      return undefined;
  }
}

// ---- support ticket -----------------------------------------------------------------------------

const TICKET_ACTIVITY = 'a2ui-support-ticket';

/** The rule only the server applies: the form cannot see it, so what it holds goes out and the answer comes back as data. */
export const SEVERITY_ERROR = 'Urgency 4 or 5 cannot be filed as low severity. Pick medium or high, or lower the urgency.';

/** The reply time a valid ticket is promised, in hours, by urgency 1 to 5. */
const REPLY_HOURS = [48, 24, 8, 4, 1] as const;

export const ticketForm: readonly Operation[] = (() => {
  const email = bind('/ticket/email');
  const description = bind('/ticket/description');
  const emailIsFine = call('email', { value: email }, 'boolean');
  const descriptionIsFine = call('length', { value: description, min: 20, max: 300 }, 'boolean');
  return [
    createSurface('ticket'),
    updateComponents('ticket', [
      column('root', ['ticket-title', 'ticket-intro', 'ticket-email', 'ticket-description', 'ticket-severity', 'ticket-urgency-row', 'ticket-logs', 'ticket-when', 'ticket-error', 'ticket-divider', 'ticket-actions']),
      text('ticket-title', 'Contact support', 'h2'),
      text('ticket-intro', 'The form checks what it can in your browser. The server decides the rest.', 'caption'),
      {
        id: 'ticket-email',
        component: 'TextField',
        label: 'Email',
        value: email,
        checks: [valid(call('required', { value: email }, 'boolean'), 'Enter your email address.'), valid(emailIsFine, 'Enter a valid email address.')],
      },
      { id: 'ticket-description', component: 'TextField', variant: 'longText', label: 'What happened?', value: description, checks: [valid(descriptionIsFine, 'Use 20 to 300 characters.')] },
      {
        id: 'ticket-severity',
        component: 'ChoicePicker',
        label: 'Severity',
        variant: 'mutuallyExclusive',
        displayStyle: 'chips',
        options: [
          { label: 'Low', value: 'low' },
          { label: 'Medium', value: 'medium' },
          { label: 'High', value: 'high' },
        ],
        value: bind('/ticket/severity'),
      },
      row('ticket-urgency-row', ['ticket-urgency', 'ticket-help'], { align: 'center', justify: 'spaceBetween' }),
      { id: 'ticket-urgency', component: 'Slider', label: 'Urgency', min: 1, max: 5, value: bind('/ticket/urgency'), weight: 1 },
      // The trigger opens the modal in the page; its own action is a function call that sends nothing.
      { id: 'ticket-help', component: 'Modal', trigger: 'ticket-help-open', content: 'ticket-help-body' },
      ...button('ticket-help-open', 'What do the levels mean?', { functionCall: call('formatString', { value: 'urgency help' }) }, { variant: 'borderless' }),
      column('ticket-help-body', ['ticket-help-title', 'ticket-help-text']),
      text('ticket-help-title', 'Urgency levels', 'h3'),
      text('ticket-help-text', '1 can wait for next week. 3 blocks one person. 5 stops a team. Urgency 4 or 5 is not accepted with low severity.'),
      { id: 'ticket-logs', component: 'CheckBox', label: 'Attach diagnostic logs', value: bind('/ticket/logs') },
      { id: 'ticket-when', component: 'DateTimeInput', label: 'When did it happen?', enableDate: true, value: bind('/ticket/when') },
      text('ticket-error', bind('/errors/severity'), 'caption'),
      divider('ticket-divider'),
      row('ticket-actions', ['ticket-send'], { justify: 'end' }),
      ...button(
        'ticket-send',
        'Send ticket',
        send(ACTIONS.submitTicket, {
          email,
          description,
          severity: bind('/ticket/severity'),
          urgency: bind('/ticket/urgency'),
          logs: bind('/ticket/logs'),
          when: bind('/ticket/when'),
        }),
        { variant: 'primary', checks: [valid(call('and', { values: [emailIsFine, descriptionIsFine] }, 'boolean'), 'Fill in a valid email and 20 to 300 characters first.')] },
      ),
    ]),
    updateDataModel('ticket', '/', { ticket: { email: '', description: '', severity: ['medium'], urgency: 3, logs: true, when: '2026-10-02' }, errors: { severity: '' } }),
  ];
})();

function supportTicket(runId: string, action: UserAction | undefined): readonly object[] | undefined {
  if (action === undefined) return [surfaces(TICKET_ACTIVITY, ticketForm)];
  if (action.name !== ACTIONS.submitTicket) return undefined;
  const { context } = action;
  const urgency = Math.max(1, Math.min(5, asWhole(context.urgency, 3)));
  if (first(context.severity) === 'low' && urgency >= 4) {
    // The answer is data only: the form stays as it is, with what the user typed, and one more value is set.
    return [surfaces(TICKET_ACTIVITY, [...ticketForm, updateDataModel('ticket', '/errors/severity', SEVERITY_ERROR)])];
  }
  const hours = REPLY_HOURS[urgency - 1]!;
  return [
    surfaces(TICKET_ACTIVITY, [
      ...ticketForm,
      deleteSurface('ticket'),
      createSurface('ticket-done'),
      updateComponents('ticket-done', [
        card('root', 'done-body'),
        column('done-body', ['done-title', 'done-number', 'done-reply']),
        text('done-title', 'Ticket received', 'h2'),
        text('done-number', interpolate('Ticket ${/done/number}, filed by ${/done/email}')),
        text('done-reply', interpolate("Expect a reply within ${/done/hours} ${pluralize(value: ${/done/hours}, one: 'hour', other: 'hours')}."), 'caption'),
      ]),
      updateDataModel('ticket-done', '/', { done: { number: `SUP-${tail(runId)}`, email: asText(context.email, 'you'), hours } }),
    ]),
  ];
}

// ---- deploy board -------------------------------------------------------------------------------

const BOARD_ACTIVITY = 'a2ui-deploy-board';
const STAGES = ['Build image', 'Run checks', 'Canary at 10%', 'Roll out to 50%', 'Roll out to 100%'] as const;
/** The run ends while this stage is still running: the rollout goes on in the pipeline and the board keeps its last word. */
const HELD_AT = 3;

const board = (path: string, value: unknown) => updateDataModel('deploy', path, value);

export const deployBoard: readonly Operation[] = [
  createSurface('deploy'),
  updateComponents('deploy', [
    column('root', ['deploy-head', 'deploy-tabs']),
    row('deploy-head', ['deploy-title', 'deploy-status'], { justify: 'spaceBetween', align: 'center' }),
    text('deploy-title', interpolate('Release ${/release}'), 'h2'),
    text('deploy-status', interpolate('${/status}')),
    { id: 'deploy-tabs', component: 'Tabs', tabs: [{ title: 'Summary', child: 'summary' }, { title: 'Logs', child: 'logs' }] },
    column('summary', ['summary-progress', 'summary-stages', 'summary-divider', 'summary-note', 'summary-pause']),
    text('summary-progress', interpolate('${/progress}% complete'), 'h3'),
    { id: 'summary-stages', component: 'List', children: { componentId: 'stage', path: '/stages' } },
    row('stage', ['stage-name', 'stage-state'], { justify: 'spaceBetween' }),
    text('stage-name', bind('name')),
    text('stage-state', bind('state'), 'caption'),
    divider('summary-divider'),
    { id: 'summary-note', component: 'TextField', label: 'Release note', value: bind('/note') },
    ...button('summary-pause', 'Pause rollout', send(ACTIONS.pauseDeploy, { release: bind('/release'), progress: bind('/progress'), note: bind('/note') })),
    { id: 'logs', component: 'List', children: { componentId: 'log', path: '/logs' } },
    text('log', bind('line'), 'caption'),
  ]),
  updateDataModel('deploy', '/', {
    release: '2.4.0',
    status: 'Queued',
    progress: 0,
    note: '',
    stages: STAGES.map((name) => ({ name, state: 'waiting' })),
    logs: [{ line: 'Deploy requested' }],
  }),
];

/** Where the next log line goes once the run has ended: the request, a start and a finish for each finished stage, and the held stage's start. */
const NEXT_LOG = 1 + 2 * HELD_AT + 1;

/** What the run streams after the surface appears: one patch per change a viewer should see arrive. */
export function rolloutPatches(): readonly (readonly Operation[])[] {
  const patches: Operation[][] = [];
  let line = 1;
  STAGES.slice(0, HELD_AT + 1).forEach((name, stage) => {
    patches.push([board(`/stages/${stage}/state`, 'running'), board('/status', `Running: ${name}`), board(`/logs/${line++}`, { line: `${name} started` })]);
    if (stage < HELD_AT) patches.push([board(`/stages/${stage}/state`, 'done'), board('/progress', (stage + 1) * 20), board(`/logs/${line++}`, { line: `${name} finished` })]);
  });
  return patches;
}

function deploy(action: UserAction | undefined): readonly object[] | undefined {
  if (action === undefined) return [surfaces(BOARD_ACTIVITY, deployBoard), ...rolloutPatches().map((operations) => append(BOARD_ACTIVITY, operations))];
  if (action.name !== ACTIONS.pauseDeploy) return undefined;
  const { progress, note } = action.context;
  const percent = asWhole(progress, 0);
  const remark = asText(note, '');
  // A patch, not a snapshot: it lands on the activity the first run painted.
  return [
    append(BOARD_ACTIVITY, [
      board('/status', `Paused at ${percent}%`),
      board(`/stages/${HELD_AT}/state`, 'paused'),
      board(`/logs/${NEXT_LOG}`, { line: remark === '' ? `Paused by you at ${percent}%` : `Paused by you at ${percent}%. Note: ${remark}` }),
    ]),
  ];
}

// ---- self-repair --------------------------------------------------------------------------------

/** The middleware's default cap of generation attempts, the first try included; there is one slip for each. */
const MAX_ATTEMPTS = 3;

const LAPTOPS = [
  { key: 'a', name: 'Atlas 14', price: 1190, battery: '14 h', weight: '1.2 kg' },
  { key: 'b', name: 'Birch 15', price: 1390, battery: '11 h', weight: '1.7 kg' },
  { key: 'c', name: 'Cedar 13', price: 990, battery: '16 h', weight: '1.1 kg' },
] as const;

/** The components of the comparison, without `missing` when an attempt forgot one: a model's typical slip. */
function laptopComponents(missing?: string): readonly object[] {
  const cards = LAPTOPS.flatMap(({ key, name, price }) => [
    card(`card-${key}`, `${key}-body`),
    column(`${key}-body`, [`${key}-name`, `${key}-price`, `${key}-pick`]),
    text(`${key}-name`, name, 'h3'),
    text(`${key}-price`, interpolate(`\${formatCurrency(value: ${price}, currency: 'EUR')}`)),
    ...button(`${key}-pick`, 'Choose', send('choose_laptop', { laptop: name }), { variant: 'primary' }),
  ]);
  return [
    column('root', ['compare-title', 'compare-tabs']),
    text('compare-title', 'Three laptops compared', 'h2'),
    { id: 'compare-tabs', component: 'Tabs', tabs: [{ title: 'Summary', child: 'summary' }, { title: 'Details', child: 'details' }] },
    row('summary', LAPTOPS.map(({ key }) => `card-${key}`)),
    ...cards,
    column('details', ['details-title', ...LAPTOPS.map(({ key }) => `details-${key}`)]),
    text('details-title', 'Battery and weight', 'h3'),
    ...LAPTOPS.map(({ key, name, battery, weight }) => text(`details-${key}`, `${name}: ${battery} of battery, ${weight}`)),
  ].filter((component) => (component as { id: string }).id !== missing);
}

/** What a structural check of the middleware reports for a child id that no component has. */
function danglingChildren(components: readonly object[]) {
  const ids = new Set(components.map((component) => (component as { id: string }).id));
  return components.flatMap((component, index) => {
    const { child, children } = component as { child?: unknown; children?: unknown };
    const refs: Array<[string, string]> = [];
    if (typeof child === 'string') refs.push([`components[${index}].child`, child]);
    if (Array.isArray(children)) children.forEach((ref, at) => typeof ref === 'string' && refs.push([`components[${index}].children[${at}]`, ref]));
    return refs.filter(([, ref]) => !ids.has(ref)).map(([path, ref]) => ({ code: 'unresolved_child', path, message: `Child reference '${ref}' does not match any component id` }));
  });
}

const laptopSurface = (components: readonly object[]): readonly Operation[] => [createSurface('laptops'), updateComponents('laptops', components)];

/** What each failed attempt forgets, in order. */
const SLIPS = ['card-c', 'b-body', 'a-pick'] as const;

function selfRepair(runId: string, neverValid: boolean): readonly object[] {
  const id = `a2ui-surface-compare-${runId}`;
  const slips = neverValid ? SLIPS : SLIPS.slice(0, 1);
  const events: object[] = [snapshot(id, { status: 'building' })];
  const history: Array<{ attempt: number; ok: boolean; errors: ReturnType<typeof danglingChildren> }> = [];
  slips.forEach((slip, at) => {
    const components = laptopComponents(slip);
    const errors = danglingChildren(components);
    history.push({ attempt: at + 1, ok: false, errors });
    // The attempt as the model wrote it, then the verdict. The middleware itself withholds a surface it has rejected.
    events.push(surfaces(id, laptopSurface(components)));
    if (at + 1 < MAX_ATTEMPTS) events.push(snapshot(id, { status: 'retrying', attempt: at + 2, maxAttempts: MAX_ATTEMPTS, errors }));
  });
  if (!neverValid) events.push(surfaces(id, laptopSurface(laptopComponents())));
  else events.push(snapshot(id, { status: 'failed', error: `Failed to generate valid A2UI after ${MAX_ATTEMPTS} attempt(s)`, attempts: history, maxAttempts: MAX_ATTEMPTS }));
  // A failed surface is never drawn, so the agent says what happened, as a model would.
  const closing = neverValid ? `None of the ${MAX_ATTEMPTS} attempts passed validation, so nothing was drawn.` : 'The first attempt left out Cedar 13. The second one passed validation and is drawn above.';
  return [...events, ...say(`m-${runId}`, closing)];
}

// ---- sandbox probe ------------------------------------------------------------------------------

/** Markup and Markdown as a model might write them. Text is plain, so every character stays where it was typed. */
export const MARKUP = `<b>not bold</b> **not bold** [not a link](http://${THIRD_PARTY_HOST}/page) ![not a picture](http://${THIRD_PARTY_HOST}/picture.png)`;

/** The existing media and malformed-list fixtures, with a plain-text surface and a component the catalog does not have between them. */
export const sandboxProbe: readonly unknown[] = [
  ...externalResources,
  createSurface('plain'),
  updateComponents('plain', [text('root', MARKUP)]),
  createSurface('hologram'),
  updateComponents('hologram', [column('root', ['hologram-1']), { id: 'hologram-1', component: 'Hologram', text: 'Not in the catalog' }]),
  ...malformedOperations,
];

// ---- expense report (A2UI v0.8) -----------------------------------------------------------------

const EXPENSE_ACTIVITY = 'a2ui-expense-v08';

/** Run 1: the two surfaces. Each action's run answers with the same list, extended by the story (a2ui-scenarios.ts). */
function expenseReport(action: UserAction | undefined): readonly object[] | undefined {
  if (action === undefined) return [surfaces(EXPENSE_ACTIVITY, v08Surfaces)];
  if (action.name !== ACTIONS.submitExpense && action.name !== ACTIONS.withdrawExpense) return undefined;
  return [surfaces(EXPENSE_ACTIVITY, v08Continuation(v08Surfaces, action))];
}

// ---- dispatch -----------------------------------------------------------------------------------

const STORIES: ReadonlyArray<readonly [message: string, story: (runId: string) => readonly object[]]> = [
  [SHOWCASE.findTable, (runId) => findTable(runId, undefined)!],
  [SHOWCASE.supportTicket, (runId) => supportTicket(runId, undefined)!],
  [SHOWCASE.deployBoard, () => deploy(undefined)!],
  [SHOWCASE.selfRepair, (runId) => selfRepair(runId, false)],
  [SHOWCASE.neverValid, (runId) => selfRepair(runId, true)],
  [SHOWCASE.sandbox, (runId) => [surfaces(`a2ui-surface-sandbox-${runId}`, sandboxProbe)]],
  [SHOWCASE.v08, () => expenseReport(undefined)!],
];

/**
 * The events between a run's first and last frame, or undefined when the showcase has nothing to say. A
 * surface action is answered by the story that owns its name, and the user's message by the story it names.
 */
export function showcaseEvents(runId: string, userText: string, action: UserAction | undefined): readonly object[] | undefined {
  if (action !== undefined) return findTable(runId, action) ?? supportTicket(runId, action) ?? deploy(action) ?? expenseReport(action);
  const wanted = userText.trim().toLowerCase();
  return STORIES.find(([message]) => message.toLowerCase() === wanted)?.[1](runId);
}
