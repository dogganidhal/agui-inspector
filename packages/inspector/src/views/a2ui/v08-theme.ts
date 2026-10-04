import type { Types } from '@a2ui/react/v0_8';

// The theme that the v0.8 renderer is given. The renderer's own theme names utility classes whose stylesheet the
// page's policy would not let it inject (`style-src 'self'`), and the inspector's tokens already style v0.9
// surfaces. So each component here names a class from a2ui.css instead, and most name none: a component that
// the inspector draws itself (v08.tsx) takes its classes from its own markup, and the layout components take
// theirs from the `a2ui-*` host classes the renderer puts on them. Where a stock control has the shape of a v0.9
// one, it reuses that one's classes, so one rule styles both.

const none = {} as const;
const field = { container: { 'agui-a2ui-field': true }, element: { 'agui-a2ui-input': true }, label: { 'agui-a2ui-label': true } } as const;

export const V08_THEME: Types.Theme = {
  components: {
    AudioPlayer: none,
    Button: none,
    Card: none,
    Column: none,
    CheckBox: { container: { 'agui-a2ui-v08-check': true }, element: none, label: none },
    DateTimeInput: field,
    Divider: { 'agui-a2ui-v08-divider': true },
    Image: { all: none, icon: none, avatar: none, smallFeature: none, mediumFeature: none, largeFeature: none, header: none },
    Icon: none,
    List: none,
    Modal: { backdrop: none, element: none },
    MultipleChoice: field,
    Row: none,
    Slider: { container: { 'agui-a2ui-v08-slider': true }, element: none, label: { 'agui-a2ui-label': true } },
    Tabs: { container: none, element: none, controls: { all: none, selected: none } },
    Text: { all: none, h1: none, h2: none, h3: none, h4: none, h5: none, caption: none, body: none },
    TextField: field,
    Video: none,
  },
  elements: { a: none, audio: none, body: none, button: none, h1: none, h2: none, h3: none, h4: none, h5: none, iframe: none, input: none, p: none, pre: none, textarea: none, video: none },
  markdown: { p: [], h1: [], h2: [], h3: [], h4: [], h5: [], ul: [], ol: [], li: [], a: [], strong: [], em: [] },
};
