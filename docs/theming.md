# Theming

`agui-inspector` is a working name. This page is the contract between the inspector's views and
anyone who restyles them. The tokens and primitives live in `packages/inspector/src/views/theme`.

## Overview

Every color, radius, spacing step and font in the views comes from ten public CSS custom properties
named `--agui-*`. Everything else the views read is derived from those ten with `color-mix()`,
`oklch()` and `calc()`. A host that overrides the ten properties restyles every view without
rebuilding the bundle (FR-041, SC-010).

The default build requests nothing from outside its own origin. Fonts are system stacks, and no rule
in either stylesheet uses `@import`, `@font-face` or `url()` (FR-037).

## Public properties

| Property | Light default | Dark default | Controls |
| --- | --- | --- | --- |
| `--agui-accent` | `var(--agui-fg)` | follows `--agui-fg` | Primary buttons, selection, focus ring, interrupt outline, brand mark |
| `--agui-accent-contrast` | `var(--agui-bg)` | follows `--agui-bg` | Text and icons drawn on the accent |
| `--agui-tint-hue` | `75` | same | Hue of the neutral tint, in OKLCH degrees |
| `--agui-tint-chroma` | `0.006` | same | Strength of the tint; `0` gives pure grey |
| `--agui-bg` | `oklch(0.993 c×0.6 h)` | `oklch(0.175 c×1.2 h)` | Page background |
| `--agui-fg` | `oklch(0.235 c×2.2 h)` | `oklch(0.93 c×1.2 h)` | Body text, and the source of every neutral |
| `--agui-radius` | `8px` | same | Base of the radius scale |
| `--agui-density` | `1` | same | Spacing multiplier; `0.85` is the compact setting |
| `--agui-font-sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` | same | Interface text |
| `--agui-font-mono` | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` | same | Frames, ids, JSON, offsets |

`c` and `h` are `--agui-tint-chroma` and `--agui-tint-hue`. The default accent is the text color, so
the stock inspector is monochrome and an adopter's accent is the only hue in the chrome. Pick an
accent that is not red, amber or green: those hues mean errors, warnings and success, and an accent
that matches one makes the primary button read as a status.

A short override:

```css
:root {
  --agui-accent: oklch(0.52 0.19 262);
  --agui-accent-contrast: oklch(0.99 0 0);
  --agui-tint-hue: 262;
  --agui-radius: 4px;
  --agui-font-sans: "Source Sans 3", system-ui, sans-serif;
}
```

Those properties work in light and dark mode as written.

## Dark mode

Dark values apply in two cases: the system prefers a dark color scheme and the root element does not
say `data-theme="light"`, or the root element says `data-theme="dark"`. The top-bar theme switch sets
`data-theme`.

Only `--agui-bg` and `--agui-fg` change between the modes, along with the internal lightness of the
status and event-family colors. The inspector redefines the two in both dark rules:

```css
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }
:root[data-theme="dark"] { … }
```

Those rules are more specific than a plain `:root` rule, so an override of `--agui-bg` or
`--agui-fg` in `:root` alone is ignored in dark mode. An adopter who overrides either must supply
dark values in the same two rules and keep the selectors identical. The other eight properties need
no dark counterpart.

## Delivering overrides

How a host supplies its stylesheet is open decision G-09 and is not settled here. The tests apply
overrides as a stylesheet loaded after the inspector's own, which every candidate mechanism reduces
to. Custom properties inherit through shadow roots, so the later in-app element can take the same
properties from its host element.

## Derived tokens

These are internal. Views read them; adopters should not override them, and a view lane should not
add one without changing the theme.

| Token | Value | Use |
| --- | --- | --- |
| `--bg`, `--fg`, `--acc`, `--acc-fg` | The matching public property | Short names for views |
| `--sunk` | `fg` 4% into `bg` | Code blocks, inputs, selected rows |
| `--hover` | `fg` 5.5% | Row and button hover |
| `--line`, `--line-2` | `fg` 10% and 18% | Dividers, control borders |
| `--muted`, `--faint` | `fg` 64% and 40% | Secondary text; decoration only |
| `--acc-ink`, `--acc-soft`, `--acc-line` | Accent mixed into `fg` or `bg` | Accent text, fills, borders and focus halos |
| `--err`, `--warn`, `--ok` and `-soft` fills | `oklch()` at fixed hues 27, 70 and 150 | Findings, outcomes, status codes |
| `--f-text`, `--f-tool`, `--f-reason`, `--f-state`, `--f-activity`, `--f-neutral` | `oklch()` at hues 255, 300, 200, 75 and 350; neutral is `--muted` | Event family dots and timeline ticks |
| `--j-str`, `--j-num`, `--j-lit` | `oklch()` at hues 150, 255 and 300 | JSON highlighting |
| `--u` | `4px × --agui-density` | Spacing unit; paddings and heights are multiples of it |
| `--r`, `--r-sm`, `--r-xs` | Radius × 1, 0.7, 0.45 | Cards, controls, tags |
| `--pop`, `--lift`, `--scrim` | Shadows and the dialog backdrop | Floating layers, raised controls |
| `--ease` | `cubic-bezier(.16, 1, .3, 1)` | Every transition |

Tokens sit on `:root` with short unprefixed names, as the design specifies. A host page that already
defines `--bg`, `--fg`, `--line` or `--muted` on `:root` would collide with them; scoping the tokens
to the inspector's own root element is a decision for the app shell and the delivery choice above.
The primitives' class names all start with `agui-`, so they cannot collide with host CSS.

## Fonts

The inspector loads no font. To use a brand font, the host loads it with its own `@font-face` and
names it in `--agui-font-sans` or `--agui-font-mono`. A font file shipped inside the bundle would be
allowed if it fits the bundle budget, but the default build ships none.

## Primitives

Views import from `packages/inspector/src/views/theme/index.ts`, which also brings in both
stylesheets. A view that needs a variant that does not exist raises it as a theme change instead of
styling around the primitive: the components take no `className`.

| Primitive | Variants and states |
| --- | --- |
| `Button` | default, `primary`, `ghost`, `small`, `iconOnly` (requires `aria-label`); hover, active, disabled |
| `Tag` | neutral, `line`, `dashed`, `accent`, `ok`, `warn`, `err`; optional `pulse` |
| `FilterChip` | default, pressed, disabled; optional family dot and count |
| `FamilyDot` | filled, `hollow`; `text`, `tool`, `reason`, `state`, `activity`, `neutral` |
| `Card`, `CardHeader`, `CardBody`, `CardFooter` | plain, `interrupt` |
| `CodeBlock` | `json` (highlighted) or `raw` (exactly as given); keyboard focusable, height capped at 340 px |
| `SegmentedControl` | `aria-pressed` on each option |
| `Switch` | `role="switch"` with `aria-checked` |
| `Field`, `SearchField`, `Editor` | default, focus, `invalid` |
| `Popover` | native `popover`, placed under the button whose `popoverTarget` is its `id` |
| `Dialog` | native modal `<dialog>` driven by `open` |
| `ToastRegion`, `useToasts` | polite live region; a toast goes after 3.2 s |
| `Finding` | neutral, `warn`, `err`, always with an icon |
| `Label` | uppercase caption, or a `<label>` when given `htmlFor` |
| `Icon` | The 24-grid inline SVG set in `primitives.tsx`; no icon library |

Rules every primitive follows:

- Native elements only. Focus shows as a 2 px outline in the accent at 55% opacity, offset 1 px.
- Status color never stands alone: a tag carries its word, a finding carries an icon.
- `prefers-reduced-motion: reduce` turns off the pulse, the caret, the row fade and every
  transition. The `agui-caret` and `agui-fresh` classes are the two motion utilities views may use.
- `CodeBlock` never alters text. The JSON tokenizer is lossless, and non-JSON stays `raw`.

## How it is checked

- `packages/inspector/tests/theme/tokens.test.ts` reads the stylesheets: the ten properties and
  their defaults, both dark rules, no remote loading, no literal colors, radii or fonts in the
  primitives, spacing as multiples of `--u`, a focus rule and a reduced-motion rule.
- `packages/inspector/tests/theme/primitives.test.ts` covers component logic.
- `tests/e2e/theme/theme.spec.ts` renders every primitive and state from
  `packages/inspector/tests/theme/fixture.tsx` in light, dark and with an override stylesheet. It
  checks that each primitive's computed look equals an expression over the tokens, that overriding
  only `--agui-*` restyles every section in both modes, that the page requests nothing outside its
  own origin, and that focus, popover, dialog, toast and reduced motion behave.
