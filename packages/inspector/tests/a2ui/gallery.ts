// FX11: a model-free gallery of the A2UI v0.9 basic catalog. Three surfaces in one activity draw every
// component the inspector renders (Image, Video and AudioPlayer stay blocked by design) and the basic
// functions a demo needs, so the render audit has one fixed page to look at and assert on. Test support,
// never part of the shipped app. Erasable TypeScript only, so Node and Playwright can run it directly.

export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

export type Operation = Readonly<Record<string, unknown>>;

const V = 'v0.9';

const text = (id: string, value: unknown, variant?: string): Operation => ({ id, component: 'Text', text: value, ...(variant ? { variant } : {}) });
const button = (id: string, label: string, extra: Record<string, unknown> = {}): Operation[] => [
  text(`${id}-label`, label),
  { id, component: 'Button', child: `${id}-label`, action: { event: { name: id.replace(/-/g, '_') } }, ...extra },
];

/** Typography, layout, list template, card, divider, tabs, modal, icon and the three blocked media components. */
export const layoutSurface: readonly Operation[] = [
  { version: V, createSurface: { surfaceId: 'layout', catalogId: BASIC_CATALOG_ID } },
  {
    version: V,
    updateComponents: {
      surfaceId: 'layout',
      components: [
        { id: 'root', component: 'Column', children: ['typography', 'layout-card', 'list-card', 'tabs', 'modal', 'media'] },

        { id: 'typography', component: 'Card', child: 'typography-column' },
        { id: 'typography-column', component: 'Column', children: ['h1', 'h2', 'h3', 'h4', 'h5', 'body', 'caption'] },
        text('h1', 'Heading one', 'h1'),
        text('h2', 'Heading two', 'h2'),
        text('h3', 'Heading three', 'h3'),
        text('h4', 'Heading four', 'h4'),
        text('h5', 'Heading five', 'h5'),
        text('body', 'Body text sits at the base size and wraps like a paragraph when the pane gets narrow.', 'body'),
        text('caption', 'Caption text is smaller and muted', 'caption'),

        { id: 'layout-card', component: 'Card', child: 'layout-column' },
        { id: 'layout-column', component: 'Column', children: ['row-heading', 'row-spread', 'rule', 'row-split', 'wrap-heading', 'row-wrap', 'column-heading', 'column-centered'] },
        text('row-heading', 'Row, spread and centred', 'h4'),
        { id: 'row-spread', component: 'Row', justify: 'spaceBetween', align: 'center', children: ['home-icon', 'row-title', 'row-action'] },
        { id: 'home-icon', component: 'Icon', name: 'home' },
        text('row-title', 'Items on one line'),
        ...button('row-action', 'Row action'),
        { id: 'rule', component: 'Divider' },
        { id: 'row-split', component: 'Row', children: ['split-left', 'split-rule', 'split-right'] },
        text('split-left', 'Before the divider'),
        { id: 'split-rule', component: 'Divider', axis: 'vertical' },
        text('split-right', 'After the divider'),
        text('wrap-heading', 'Row that has to wrap', 'h4'),
        { id: 'row-wrap', component: 'Row', children: ['wrap-1', 'wrap-2', 'wrap-3', 'wrap-4', 'wrap-5', 'wrap-6', 'wrap-7', 'wrap-8'] },
        ...['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].map((word, at) => text(`wrap-${at + 1}`, `Wrapping item ${word}`)),
        text('column-heading', 'Column, centred', 'h4'),
        { id: 'column-centered', component: 'Column', align: 'center', children: ['centred-a', 'centred-b'] },
        text('centred-a', 'First centred line'),
        text('centred-b', 'Second centred line', 'caption'),

        { id: 'list-card', component: 'Card', child: 'list-column' },
        { id: 'list-column', component: 'Column', children: ['list-heading', 'task-list', 'tag-list'] },
        text('list-heading', 'List from a template', 'h4'),
        { id: 'task-list', component: 'List', children: { componentId: 'task-row', path: '/tasks' } },
        { id: 'task-row', component: 'Row', justify: 'spaceBetween', align: 'center', children: ['task-title', 'task-state'] },
        text('task-title', { path: 'title' }),
        text('task-state', { path: 'state' }, 'caption'),
        { id: 'tag-list', component: 'List', direction: 'horizontal', align: 'center', children: { componentId: 'tag', path: '/tags' } },
        text('tag', { path: 'name' }, 'caption'),

        {
          id: 'tabs',
          component: 'Tabs',
          tabs: [
            { title: 'Overview', child: 'tab-overview' },
            { title: 'Frames', child: 'tab-frames' },
            { title: 'Raw', child: 'tab-raw' },
          ],
        },
        text('tab-overview', 'The overview tab is selected first.'),
        text('tab-frames', 'Frames arrive in order.'),
        text('tab-raw', 'Raw bytes stay untouched.'),

        { id: 'modal', component: 'Modal', trigger: 'open-dialog', content: 'dialog-content' },
        ...button('open-dialog', 'Open the dialog'),
        { id: 'dialog-content', component: 'Column', children: ['dialog-title', 'dialog-body', 'dialog-confirm'] },
        text('dialog-title', 'Dialog title', 'h3'),
        text('dialog-body', 'The dialog content is any component.'),
        ...button('dialog-confirm', 'Confirm', { variant: 'primary' }),

        { id: 'media', component: 'Card', child: 'media-column' },
        { id: 'media-column', component: 'Column', children: ['image', 'video', 'audio'] },
        { id: 'image', component: 'Image', url: 'http://third-party.invalid/picture.png', description: 'A remote picture' },
        { id: 'video', component: 'Video', url: 'http://third-party.invalid/clip.mp4' },
        { id: 'audio', component: 'AudioPlayer', url: 'http://third-party.invalid/song.mp3', description: 'A remote song' },
      ],
    },
  },
  {
    version: V,
    updateDataModel: {
      surfaceId: 'layout',
      value: {
        tasks: [
          { title: 'Record the run', state: 'done' },
          { title: 'Read the frames', state: 'in progress' },
          { title: 'Export the session', state: 'to do' },
        ],
        tags: [{ name: 'protocol' }, { name: 'ui' }, { name: 'tools' }, { name: 'state' }],
      },
    },
  },
];

/** Every input component, bound to the data model, and a button whose action carries the bound values. */
export const inputsSurface: readonly Operation[] = [
  { version: V, createSurface: { surfaceId: 'inputs', catalogId: BASIC_CATALOG_ID } },
  {
    version: V,
    updateComponents: {
      surfaceId: 'inputs',
      components: [
        { id: 'root', component: 'Card', child: 'form' },
        {
          id: 'form',
          component: 'Column',
          children: ['name', 'bio', 'seats', 'password', 'newsletter', 'plan', 'topics', 'budget', 'day', 'time', 'moment', 'buttons', 'submit'],
        },
        { id: 'name', component: 'TextField', label: 'Name', value: { path: '/form/name' } },
        { id: 'bio', component: 'TextField', label: 'Bio', variant: 'longText', value: { path: '/form/bio' } },
        { id: 'seats', component: 'TextField', label: 'Seats', variant: 'number', value: { path: '/form/seats' } },
        { id: 'password', component: 'TextField', label: 'Passphrase', variant: 'obscured', value: { path: '/form/passphrase' } },
        { id: 'newsletter', component: 'CheckBox', label: 'Send me the newsletter', value: { path: '/form/newsletter' } },
        {
          id: 'plan',
          component: 'ChoicePicker',
          label: 'Plan',
          variant: 'mutuallyExclusive',
          options: [
            { label: 'Free', value: 'free' },
            { label: 'Pro', value: 'pro' },
            { label: 'Team', value: 'team' },
          ],
          value: { path: '/form/plan' },
        },
        {
          id: 'topics',
          component: 'ChoicePicker',
          label: 'Topics',
          variant: 'multipleSelection',
          displayStyle: 'chips',
          options: [
            { label: 'Protocol', value: 'protocol' },
            { label: 'Tools', value: 'tools' },
            { label: 'State', value: 'state' },
            { label: 'Interrupts', value: 'interrupts' },
          ],
          value: { path: '/form/topics' },
        },
        { id: 'budget', component: 'Slider', label: 'Budget', min: 0, max: 100, value: { path: '/form/budget' } },
        { id: 'day', component: 'DateTimeInput', label: 'Day', enableDate: true, value: { path: '/form/day' } },
        { id: 'time', component: 'DateTimeInput', label: 'Time', enableTime: true, value: { path: '/form/time' } },
        { id: 'moment', component: 'DateTimeInput', label: 'Moment', enableDate: true, enableTime: true, value: { path: '/form/moment' } },
        { id: 'buttons', component: 'Row', children: ['plain', 'main', 'quiet'] },
        ...button('plain', 'Default'),
        ...button('main', 'Primary', { variant: 'primary' }),
        ...button('quiet', 'Borderless', { variant: 'borderless' }),
        ...button('submit', 'Send preferences', {
          variant: 'primary',
          action: {
            event: {
              name: 'save_preferences',
              context: {
                name: { path: '/form/name' },
                bio: { path: '/form/bio' },
                seats: { path: '/form/seats' },
                newsletter: { path: '/form/newsletter' },
                plan: { path: '/form/plan' },
                topics: { path: '/form/topics' },
                budget: { path: '/form/budget' },
                day: { path: '/form/day' },
                time: { path: '/form/time' },
                moment: { path: '/form/moment' },
              },
            },
          },
        }),
      ],
    },
  },
  {
    version: V,
    updateDataModel: {
      surfaceId: 'inputs',
      value: {
        form: {
          name: 'Ada',
          bio: 'Writes the first program\nand the notes on it.',
          seats: 2,
          passphrase: 'swordfish',
          newsletter: false,
          plan: ['pro'],
          topics: ['protocol'],
          budget: 40,
          day: '2026-10-03',
          time: '14:30',
          moment: '2026-10-03T14:30',
        },
      },
    },
  },
];

/** The formatting functions, and checks that disable a button until the form is right. */
export const functionsSurface: readonly Operation[] = [
  { version: V, createSurface: { surfaceId: 'functions', catalogId: BASIC_CATALOG_ID } },
  {
    version: V,
    updateComponents: {
      surfaceId: 'functions',
      components: [
        { id: 'root', component: 'Card', child: 'column' },
        {
          id: 'column',
          component: 'Column',
          children: ['greeting', 'number', 'price', 'date', 'items', 'divider', 'email', 'code', 'terms', 'register'],
        },
        text('greeting', { call: 'formatString', args: { value: 'Hello ${/user/name}, you are number ${/user/rank}.' }, returnType: 'string' }),
        text('number', { call: 'formatNumber', args: { value: { path: '/order/total' }, decimals: 1 }, returnType: 'string' }),
        text('price', { call: 'formatCurrency', args: { value: { path: '/order/total' }, currency: 'USD' }, returnType: 'string' }),
        text('date', { call: 'formatDate', args: { value: { path: '/order/when' }, format: 'EEEE, MMMM d, yyyy' }, returnType: 'string' }),
        text('items', {
          call: 'formatString',
          args: { value: "${/order/count} ${pluralize(value: ${/order/count}, one: 'seat', other: 'seats')} booked" },
          returnType: 'string',
        }),
        { id: 'divider', component: 'Divider' },
        {
          id: 'email',
          component: 'TextField',
          label: 'Email',
          value: { path: '/signup/email' },
          checks: [
            { condition: { call: 'required', args: { value: { path: '/signup/email' } } }, message: 'Email is required' },
            { condition: { call: 'email', args: { value: { path: '/signup/email' } } }, message: 'Enter a valid email address' },
          ],
        },
        {
          id: 'code',
          component: 'TextField',
          label: 'Invite code',
          value: { path: '/signup/code' },
          checks: [
            { condition: { call: 'length', args: { value: { path: '/signup/code' }, min: 4, max: 8 } }, message: 'Use 4 to 8 characters' },
            { condition: { call: 'regex', args: { value: { path: '/signup/code' }, pattern: '^[A-Z0-9]+$' } }, message: 'Capital letters and digits only' },
          ],
        },
        { id: 'terms', component: 'CheckBox', label: 'I accept the terms', value: { path: '/signup/terms' } },
        ...button('register', 'Register', {
          variant: 'primary',
          checks: [
            {
              condition: {
                call: 'and',
                args: {
                  values: [
                    { path: '/signup/terms' },
                    { call: 'email', args: { value: { path: '/signup/email' } } },
                    { call: 'length', args: { value: { path: '/signup/code' }, min: 4, max: 8 } },
                    { call: 'not', args: { value: { call: 'regex', args: { value: { path: '/signup/code' }, pattern: '[^A-Z0-9]' } } } },
                  ],
                },
              },
              message: 'Accept the terms and fix the fields above',
            },
          ],
          action: { event: { name: 'register', context: { email: { path: '/signup/email' }, code: { path: '/signup/code' } } } },
        }),
      ],
    },
  },
  {
    version: V,
    updateDataModel: {
      surfaceId: 'functions',
      value: {
        user: { name: 'Ada', rank: 1 },
        order: { total: 1234.5, when: '2026-10-03T14:30:00Z', count: 3 },
        signup: { email: 'ada@', code: 'ab', terms: false },
      },
    },
  },
];

/** The whole gallery as one activity's operation list. */
export const galleryOperations: readonly Operation[] = [...layoutSurface, ...inputsSurface, ...functionsSurface];
