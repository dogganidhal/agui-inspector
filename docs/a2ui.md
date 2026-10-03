# A2UI surfaces

The inspector draws `a2ui-surface` activities with the official A2UI renderer and keeps their operations
available as JSON. Only A2UI v0.9 is supported. The approved package name `agui-inspector` is not published yet
(see [distribution](distribution.md)).

## What is drawn

An `ACTIVITY_SNAPSHOT` of type `a2ui-surface` carries `{ "a2ui_operations": [...] }`. Each entry is a v0.9
message: `createSurface`, `updateComponents`, `updateDataModel` or `deleteSurface`. The view builds the
surfaces with `@a2ui/web_core/v0_9` and draws them with `@a2ui/react/v0_9`. Both are pinned in
`docs/dependencies.md` and ship inside the one static bundle, so surfaces render offline.

| Situation | What the user sees |
| --- | --- |
| Rendering on, valid v0.9 operations | One block per surface, drawn by the renderer |
| Rendering off | The operations as JSON, with a note that rendering is off |
| An activity of any other type | JSON in the activity card; this view is not involved |
| A lifecycle snapshot with no `a2ui_operations` and a `status` of `building`, `retrying` or `failed` | The status, drawn differently for each (see "Generation lifecycle") |
| Any other snapshot with no `a2ui_operations` | "No A2UI operations yet." |
| An operation the renderer cannot apply | An error naming its position, with the entry as received; the other operations still apply |
| `a2ui_operations` is not a list | One error showing the value that arrived |
| A component type the catalog does not have | The renderer's own "Unknown component type" line |

The activity card around the view belongs to the conversation view. It already offers the Rendered and JSON
switch, so the received content is always one click away.

## Components

All 18 basic-catalog components are bundled. The renderer draws most of them; the inspector draws eight
itself because the renderer's markup is unlabelled or its styles never load (`@a2ui/react` 0.12.0 refers to
CSS-module class names that nothing defines). The inspector's versions keep the official schemas and
bindings, so a surface written for the basic catalog applies unchanged.

| Component | What the user gets |
| --- | --- |
| `Text` | All variants. `h1` to `h5` are real headings at sizes that fit the inspector, `caption` is small and muted, `body` is plain text (no Markdown) |
| `Image`, `Video`, `AudioPlayer` | Blocked by design: a note with the address as text, nothing loaded |
| `Icon` | A named icon is drawn as its name in a small tag and announced as an image with that name; the inspector loads no icon font. An `svgPath` icon draws normally |
| `Row` | Wraps to a new line instead of overflowing a narrow pane. `justify`, `align` and `weight` work |
| `Column`, `List` | The renderer's own. `List` takes a fixed list or a template, `children: { "componentId": "row", "path": "/items" }`; inside the template, paths without a leading slash resolve in the item |
| `Card` | A bordered, padded block with no shadow and no outer margin |
| `Divider` | A separator with an orientation. A vertical one takes the height of its row |
| `Tabs` | The WAI-ARIA tabs pattern: `tablist`, `tab` and `tabpanel`. Only the selected tab is in the tab order; Left, Right, Home and End move between tabs and select them |
| `Modal` | The trigger opens a native dialog. The page behind is inert, Escape and the Close button shut it, a click on the backdrop shuts it, and focus returns to the trigger |
| `Button` | `default`, `primary` and `borderless`. A button whose checks fail is disabled and the first failing message appears under it |
| `TextField` | Label above the control. `shortText`, `longText`, `number` and `obscured`. A failing check's message appears under the field and is the field's description |
| `CheckBox` | The renderer's own, with a visible error line when a check fails |
| `ChoicePicker` | A group named by its label. `mutuallyExclusive` is radios, `multipleSelection` is checkboxes, and `displayStyle: "chips"` gives toggle buttons that report `aria-pressed`. `filterable` adds a filter field |
| `Slider` | The renderer's own: label, range input and the current value |
| `DateTimeInput` | The renderer's own native date, time or date-time input, in the inspector's font |

When writing a surface:

- A `TextField` of variant `number` writes its value to the data model as text. A model that started with
  `2` holds `"3"` after the user types 3, and an action context that binds it carries `"3"`.
- The `validationRegexp` property of `TextField` is not applied by the pinned renderer. Use a `regex` check.
- A `Modal` trigger that is a `Button` still runs its own action when clicked, as in the official sample. Give
  it a `functionCall` action to keep opening local to the page.
- `accessibility.label` and `accessibility.description` become `aria-label` and `aria-description` on the eight
  components the inspector draws (`Row`, `Divider`, `Icon`, `Button`, `TextField`, `ChoicePicker`, `Tabs`,
  `Modal`); the renderer's own components ignore them. An input with a visible label takes its name from that
  label, so `accessibility.label` names it only when there is none.

All colors, radii, spacing and fonts come from the theme tokens (see "Theme"), in light and dark mode.

## Functions and checks

A surface may call the basic-catalog functions anywhere a value is dynamic: `{ "call": "formatDate", "args": { ... } }`.
The official samples add `"returnType": "string"` to calls that produce text; the pinned renderer gives the same
result without it. The render audit ran each of these through the renderer's own binder:

| Function | Arguments | Example result |
| --- | --- | --- |
| `formatString` | `value`: text with `${/path}` and `${fn(name: arg)}` parts | `Hello Ada` |
| `formatNumber` | `value`, `decimals`, `grouping` | `1,234.50`, or `1235` with `grouping: false` |
| `formatCurrency` | `value`, `currency`, `decimals`, `grouping` | `$1,234.50` |
| `formatDate` | `value` (ISO text), `format` (a Unicode TR35 pattern) | `Saturday, October 3, 2026` for `EEEE, MMMM d, yyyy` |
| `pluralize` | `value`, `zero`, `one`, `two`, `few`, `many`, `other` | `No seats`, `One seat`, `Some seats` |
| `required` | `value` | false for an empty string and a missing path |
| `email` | `value` | |
| `length` | `value`, `min`, `max` | |
| `regex` | `value`, `pattern` | |
| `numeric` | `value`, `min`, `max` | |
| `and`, `or` | `values`: at least two | |
| `not` | `value` | |
| `openUrl` | `url` | Blocked; see "Nothing leaves the page" |

- `formatDate` formats in UTC, so a surface shows the same text in every time zone.
- The arguments of `pluralize` are plain strings: `${/n}` inside `one` or `other` is not interpolated. Put the
  count in with `formatString`, either around the call, `"${/n} ${pluralize(value: ${/n}, one: 'seat', other: 'seats')}"`,
  or as the argument, `"other": { "call": "formatString", "args": { "value": "${/n} seats" } }`.

### The CheckRule shape

`checks` is accepted by `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider` and `DateTimeInput`. Each
entry is a `CheckRule`, an object with exactly two keys, both required:

```json
{
  "id": "register",
  "component": "Button",
  "child": "register-label",
  "checks": [
    {
      "condition": { "call": "and", "args": { "values": [
        { "path": "/signup/terms" },
        { "call": "email", "args": { "value": { "path": "/signup/email" } } }
      ] } },
      "message": "Accept the terms and enter a valid email address"
    }
  ],
  "action": { "event": { "name": "register" } }
}
```

- `condition` is a boolean, a data binding such as `{ "path": "/signup/terms" }`, or a function call. The check
  passes when it is true.
- `message` is the text shown when the check fails.
- Anything else is rejected when the components are applied: a bare function call as the rule, a call with
  `message` beside it, a rule with no `message`, or an extra key. The inspector shows the renderer's error
  ("Validation failed for component ... checks.0 ...") as an operation error and the component is not created.
- Checks are live. They are evaluated again whenever the data they read changes, so a button enables itself
  when the form becomes valid. A `Button` with any failing check is disabled and `TextField` and `CheckBox` show
  the first failing message. `ChoicePicker`, `Slider` and `DateTimeInput` accept `checks` but show no message.

## Generation lifecycle

`@ag-ui/a2ui-middleware` 0.0.11 sends an `a2ui-surface` snapshot before there is anything to paint and replaces
it, under the same message id, with the painted surface. The status is on the activity content next to
`a2ui_operations`, never inside it. The view shows it while `a2ui_operations` is absent:

| `status` | Fields read | What the user sees |
| --- | --- | --- |
| `building` | `progressTokens` | A "Building" tag with a pulse, "The surface is being generated." and the token estimate when there is one. Announced as a status |
| `retrying` | `attempt`, `maxAttempts`, `errors` | A warning: "Retrying", with "Attempt 2 of 3". Announced as a status |
| `failed` | `error`, `attempts`, `maxAttempts` | An error: "Failed" with the middleware's message and "3 of 3 attempts used". Announced as an alert |

`errors` (a list of `{ path, message }`, as the middleware's validator writes them) and, for `failed`, the
`errors` of each entry of `attempts`, are listed under "Validation errors (n)". The server's `debugExposure`
decides whether the list is `hidden`, `collapsed` (the default) or `verbose` (open). A number is also accepted for
`attempts`. A snapshot with operations draws the surface and ignores the status. A snapshot with neither, or an
unknown status, still says "No A2UI operations yet."

## Versions and catalogs

- Only `"version": "v0.9"` is accepted. An operation with no version, or with `v0.8`, is reported as unsupported
  and skipped. The renderer's own v0.8 adapter is never reached.
- The only catalog is the official basic catalog, bundled with the page. It answers to exactly two ids:
  - `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`, the id the renderer package declares;
  - `https://a2ui.org/specification/v0_9/basic_catalog.json`, the default id of `@ag-ui/a2ui-middleware` 0.0.11
    when an agent does not configure one. It is the one built-in alias.

  Both ids resolve to the same bundled catalog with the same guards (see "Nothing leaves the page"), and
  surfaces in one activity can use either. Nothing is fetched to resolve them, and the received `createSurface` is never rewritten:
  the activity JSON and the recording still show the id the agent sent.
- Any other id, including a near miss such as the middleware id with a trailing slash or a `v0_8` path, is
  reported as "Catalog not found" with the entry as received. Nothing is fetched to resolve it.
- General catalog aliases, such as mapping other ids onto the bundled catalog or loading a catalog from an
  address, are not supported in 0.1.0. They are deferred to 1.0.0.

## How operations are applied

The view hands the activity's current operation list to a session on every change.

- The same list again changes nothing.
- A list that only gained entries at the end applies just the new ones. The surface model stays, so text a user
  typed into a field is still there.
- Any other change, such as an `ACTIVITY_DELTA` that rewrites an earlier operation, rebuilds the surfaces from
  the list as it now stands. Typed values from before the rebuild are lost.

The received list is never modified. The renderer keeps the objects it is given, and a surface's data model
starts as the `value` of an `updateDataModel`, so the session passes it a copy of each operation as that
operation is applied. Typing into a bound field changes the surface's data model and nothing else. The JSON
view, the frames, the exported session and the projection still show what the agent sent. An action's `context`
is copied the same way, so it stays what the user submitted when they clicked. Switching an activity card to
JSON and back draws the surface again from the operations as received, so text typed before the switch is gone.

## Actions

When a user activates a control, the view calls `onAction` with exactly five fields:

```json
{
  "name": "send_note",
  "surfaceId": "form",
  "sourceComponentId": "send",
  "context": { "note": "edited by hand", "count": 1 },
  "timestamp": "2026-10-02T14:47:13.359Z"
}
```

`context` is the action's context after the renderer resolved its data bindings. `timestamp` is the
renderer's. The view adds and removes nothing; the assembly puts the object in
`forwardedProps.a2uiAction.userAction` and starts an ordinary run. The view never sends a tool reply or a run
on its own.

## Rendering is separate from the optional tool

`renderA2ui` decides whether surfaces are drawn. `injectA2uiTool` decides whether the official
`render_a2ui` tool declaration is added to the run input. Neither reads the other, and nothing in this view or
in `core/a2ui` imports the middleware.

## Nothing leaves the page

A surface cannot make the inspector request, open or load anything (FR-037):

- `Image`, `Video` and `AudioPlayer` are replaced by a note that shows the address as plain text. No `img`,
  `video` or `audio` element is created.
- `openUrl` does nothing except add a visible "Blocked openUrl ..." line.
- Text is plain: no Markdown renderer is configured, so link and image syntax stay as typed.
- The `Icon` component names a Material Symbols font that the inspector does not load, so a named icon shows its
  name in a small tag. An icon with an `svgPath` draws normally.
- Catalogs are never fetched.

The Playwright spec checks this with a page whose content security policy does not restrict images, media or
connections, so the guard itself is what is tested. A control case with the stock renderer shows that the same
operations do make a request to the third-party address.

## Using the view

```tsx
import { A2uiView, a2uiActivity } from 'views/a2ui/index';

// Standalone
<A2uiView activityId={id} operations={content.a2ui_operations} renderEnabled={profile.renderA2ui} onAction={start} />

// Inside the conversation view's card
<ConversationView {...props} renderActivity={(entry) => a2uiActivity(entry, { renderEnabled: profile.renderA2ui, onAction: start })} />
```

`a2uiActivity` returns `undefined` for every activity type except `a2ui-surface`, which leaves the card showing
JSON. The assembly loads `views/theme/index.ts` and `views/a2ui/a2ui.css`. Importing the modules does not load
a stylesheet, so the build output only changes when the assembly does.

## Theme

`a2ui.css` maps the renderer's `--a2ui-*` variables onto the inspector's tokens (`--bg`, `--fg`, `--acc`,
`--line-2`, `--r-sm`, `--u` and the font tokens). A host that overrides `--agui-*` restyles surfaces as well,
in light and dark mode, with no rebuild. Components the renderer styles through inline variables (`Card`,
`Column`, `List`, `CheckBox`, `Slider`, `DateTimeInput`) are themed by that mapping. The components the inspector
draws (see "Components") use `agui-a2ui-*` classes in the same file. `@a2ui/react` 0.12.0 ships its component
stylesheet with unresolved CSS-module class names, so it is not loaded. Layout inside a surface comes from the
renderer's inline styles, except for `Row`, which the inspector draws so that it can wrap.

## Size

The renderer is part of the main bundle in 0.1.0. Loading it on first use belongs to 1.0.0. `npm run
check:bundle:renderer` reports the room left with the renderer included.

## Checks

| Command | Covers |
| --- | --- |
| `npm run test:unit -- packages/inspector/tests/a2ui` | Create, update, delete and delta handling, malformed and non-list input, the action envelope, the `openUrl` guard, JSON-only and unknown-activity output, the stylesheet, and the two catalog ids (`catalog.test.ts`); the gallery, the function output and every `CheckRule` shape (`gallery.test.ts`); the generation lifecycle (`lifecycle.test.ts`) |
| `npm run test:e2e -- tests/e2e/a2ui` | The real renderer in Chromium: callback data, scripted continuation, live updates, JSON-only mode, keyboard use, the network allowlist, and an offline render and action round trip under each catalog id (`surfaces.spec.ts`); every basic component with its role and name, Tabs, Modal, bound inputs and the action context, checks that disable a button, the function output, the lifecycle states and the theme (`components.spec.ts`) |

Scenarios live in `examples/reference-agent/a2ui-scenarios.ts`; the gallery of every component is
`packages/inspector/tests/a2ui/gallery.ts`. They need no model and no network. `components.spec.ts` also writes
screenshots of the gallery, the dialog and the lifecycle states in light and dark to `.build/a2ui-gallery/`,
which is not committed.
