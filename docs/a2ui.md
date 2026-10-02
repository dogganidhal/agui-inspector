# A2UI surfaces

The inspector draws `a2ui-surface` activities with the official A2UI renderer and keeps their operations
available as JSON. Only A2UI v0.9 is supported. `agui-inspector` is a working name.

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
| A lifecycle snapshot with no `a2ui_operations` (for example `{ "status": "building" }`) | "No A2UI operations yet." |
| An operation the renderer cannot apply | An error naming its position, with the entry as received; the other operations still apply |
| `a2ui_operations` is not a list | One error showing the value that arrived |
| A component type the catalog does not have | The renderer's own "Unknown component type" line |

The activity card around the view belongs to the conversation view. It already offers the Rendered and JSON
switch, so the received content is always one click away.

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

The received list is never modified.

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
  name as text. An icon with an `svgPath` draws normally.
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
`--line-2`, `--r-sm`, `--u` and the font tokens). A host that overrides `--agui-*` restyles surfaces as well.
Buttons and form controls are styled by tag inside `.agui-a2ui-surface`, because `@a2ui/react` 0.12.0 ships its
component stylesheet with unresolved CSS-module class names and loading it would style nothing. Layout inside a
surface comes from the renderer's inline styles.

## Size

The renderer is part of the main bundle in 0.1.0. Loading it on first use belongs to 1.0.0. `npm run
check:bundle:renderer` reports the room left with the renderer included.

## Checks

| Command | Covers |
| --- | --- |
| `npm run test:unit -- packages/inspector/tests/a2ui` | Create, update, delete and delta handling, malformed and non-list input, the action envelope, the `openUrl` guard, JSON-only and unknown-activity output, the stylesheet, and the two catalog ids (`catalog.test.ts`) |
| `npm run test:e2e -- tests/e2e/a2ui` | The real renderer in Chromium: callback data, scripted continuation, live updates, JSON-only mode, keyboard use, the network allowlist, and an offline render and action round trip under each catalog id |

Scenarios live in `examples/reference-agent/a2ui-scenarios.ts`. They need no model and no network.
