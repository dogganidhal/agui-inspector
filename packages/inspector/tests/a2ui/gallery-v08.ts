// A model-free gallery of the A2UI v0.8 standard catalog: one surface that draws every one of its 18 components
// (Image, Video and AudioPlayer stay blocked by design), so the render audit has one fixed page to assert on.
// Test support, never part of the shipped app. The v0.9 equivalent is gallery.ts. Erasable TypeScript only.

export type Operation = Readonly<Record<string, unknown>>;

/** The 18 components of the v0.8 standard catalog. */
export const V08_COMPONENT_TYPES = ['AudioPlayer', 'Button', 'Card', 'CheckBox', 'Column', 'DateTimeInput', 'Divider', 'Icon', 'Image', 'List', 'Modal', 'MultipleChoice', 'Row', 'Slider', 'Tabs', 'Text', 'TextField', 'Video'] as const;

export const THIRD_PARTY = 'http://third-party.invalid';

const lit = (value: string) => ({ literalString: value });
const text = (id: string, value: string, usageHint?: string): Operation => ({ id, component: { Text: { text: lit(value), ...(usageHint === undefined ? {} : { usageHint }) } } });
const button = (id: string, label: string, name: string, primary = false): Operation[] => [
  text(`${id}-label`, label),
  { id, component: { Button: { child: `${id}-label`, ...(primary ? { primary } : {}), action: { name, context: [{ key: 'who', value: { path: '/name' } }] } } } },
];

export const v08Gallery: readonly Operation[] = [
  {
    surfaceUpdate: {
      surfaceId: 'gallery8',
      components: [
        { id: 'root', component: { Column: { children: { explicitList: ['heading-one', 'body-text', 'caption-text', 'icon', 'card', 'divider', 'row', 'list', 'tabs', 'modal', 'fields', 'media'] } } } },
        // Ids avoid `h1`, `body` and `caption`: the v0.8 processor reads a string property that equals a component id
        // as a child reference, so `usageHint: 'h1'` beside a component named `h1` is a circular dependency.
        text('heading-one', 'Heading one', 'h1'),
        text('body-text', 'Body text wraps like a paragraph when the pane gets narrow.', 'body'),
        text('caption-text', 'Caption text is smaller and muted', 'caption'),
        { id: 'icon', component: { Icon: { name: lit('accountCircle') } } },
        { id: 'card', component: { Card: { child: 'card-text' } } },
        text('card-text', 'Inside a card'),
        { id: 'divider', component: { Divider: {} } },
        { id: 'row', component: { Row: { distribution: 'spaceBetween', alignment: 'center', children: { explicitList: ['row-a', 'row-b'] } } } },
        text('row-a', 'Left of the row'),
        text('row-b', 'Right of the row'),
        { id: 'list', component: { List: { direction: 'vertical', children: { explicitList: ['item-a', 'item-b'] } } } },
        text('item-a', 'First list item'),
        text('item-b', 'Second list item'),
        { id: 'tabs', component: { Tabs: { tabItems: [{ title: lit('One'), child: 'tab-one' }, { title: lit('Two'), child: 'tab-two' }] } } },
        text('tab-one', 'Panel of the first tab'),
        text('tab-two', 'Panel of the second tab'),
        { id: 'modal', component: { Modal: { entryPointChild: 'open-dialog', contentChild: 'dialog-text' } } },
        ...button('open-dialog', 'Open dialog', 'open_dialog'),
        text('dialog-text', 'Inside the dialog'),
        { id: 'fields', component: { Column: { children: { explicitList: ['name', 'agree', 'level', 'when', 'pick', 'go'] } } } },
        { id: 'name', component: { TextField: { label: lit('Name'), text: { path: '/name' }, textFieldType: 'shortText' } } },
        { id: 'agree', component: { CheckBox: { label: lit('I agree'), value: { path: '/agree' } } } },
        { id: 'level', component: { Slider: { label: lit('Level'), value: { path: '/level' }, minValue: 0, maxValue: 10 } } },
        { id: 'when', component: { DateTimeInput: { value: { path: '/when' }, enableDate: true } } },
        {
          id: 'pick',
          component: {
            MultipleChoice: {
              description: lit('Pick one'),
              selections: { path: '/pick' },
              maxAllowedSelections: 1,
              options: [{ label: lit('Red'), value: 'red' }, { label: lit('Green'), value: 'green' }],
            },
          },
        },
        ...button('go', 'Go', 'go', true),
        { id: 'media', component: { Column: { children: { explicitList: ['picture', 'clip', 'sound'] } } } },
        { id: 'picture', component: { Image: { url: lit(`${THIRD_PARTY}/picture.png`) } } },
        { id: 'clip', component: { Video: { url: lit(`${THIRD_PARTY}/clip.mp4`) } } },
        { id: 'sound', component: { AudioPlayer: { url: lit(`${THIRD_PARTY}/sound.mp3`) } } },
      ],
    },
  },
  {
    dataModelUpdate: {
      surfaceId: 'gallery8',
      contents: [
        { key: 'name', valueString: 'Ada' },
        { key: 'agree', valueBoolean: false },
        { key: 'level', valueNumber: 4 },
        { key: 'when', valueString: '2026-10-04' },
      ],
    },
  },
  { beginRendering: { surfaceId: 'gallery8', root: 'root' } },
];
