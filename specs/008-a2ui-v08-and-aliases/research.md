# Research: A2UI v0.8 surfaces and catalog aliases

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-04

Every statement about a package below was checked in `node_modules` at the pinned versions, `@a2ui/react` 0.12.0 and
`@a2ui/web_core` 0.12.0. Three probes ran in a scratch directory outside the repository: the v0.8 processor in Node,
the v0.8 renderer in Chromium under the page's own `style-src 'self'` policy, and a minified bundle of the v0.8
imports to measure their size.

## R1. Do the packages ship a usable v0.8 renderer and message processor?

**Decision**: Yes. The gate in the assignment passes. Use them as shipped.

**Evidence**:

- `@a2ui/react/v0_8` exports `A2UIProvider`, `A2UIRenderer`, `ComponentRegistry`, `ComponentNode`, `useA2UIActions`,
  `useA2UIState`, `useA2UIComponent`, `initializeDefaultCatalog`, `ThemeProvider`, `litTheme` and the 18 standard
  components: `Text`, `Image`, `Icon`, `Divider`, `Video`, `AudioPlayer`, `Row`, `Column`, `List`, `Card`, `Tabs`,
  `Modal`, `Button`, `TextField`, `CheckBox`, `Slider`, `DateTimeInput`, `MultipleChoice`.
- `@a2ui/web_core/v0_8` exports `A2uiMessageProcessor` and `A2uiMessageSchema` (a strict zod schema).
- Probe 1 (Node): a `surfaceUpdate`, a `dataModelUpdate` and a `beginRendering` with `catalogId: "x"` gave one visible
  surface. The processor does not look at `catalogId`.
- Probe 2 (Chromium, http origin, CSP `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:`):
  the provider and renderer drew a heading bound to the data model and a button. Pressing the button called
  `onAction` with `{"userAction":{"name":"go","sourceComponentId":"b","surfaceId":"s","timestamp":"...","context":{"g":"Hello"}}}`.
  That is the five fields of the v0.9 envelope. The only console error was the renderer's own style injection (R4).

## R2. How is the version of an operation found?

**Decision**: Per operation, from its shape.

1. An object with `"version": "v0.9"` is v0.9.
2. An object with no `version` and at least one of `beginRendering`, `surfaceUpdate`, `dataModelUpdate`,
   `deleteSurface` is a v0.8 candidate. The strict v0.8 schema then accepts it or refuses it (two kinds in one
   message, an unknown key such as `createSurface`).
3. Anything else is refused with its position and the entry as received. That covers non-objects, an object with no
   version and no v0.8 name, and an explicit version other than `v0.9` (`v0.8` included: the v0.8 protocol has no
   `version` field, and the strict schema would reject the key anyway).

**Rationale**: `deleteSurface` exists in both versions, so the `version` key decides. v0.9 requires `version` on every
message, and v0.8 never has it. A surface has no version of its own on the wire, so "per surface" means "by the
messages that build it".

**Alternatives considered**: Looking at the activity's `catalogId`s (too late and optional in v0.8). Asking the agent
to declare a version in the activity content (the middleware writes none, and the spec forbids rewriting).

**Consequence for the 0.1.0 wording**: "This operation has no version. Only A2UI v0.9 is supported." and "This
operation is A2UI v0.8. Only A2UI v0.9 is supported." are replaced by wording that matches R2. Five tests and three
docs lines assert the old text (see tasks).

## R3. Where does the v0.8 pipeline live?

**Decision**: One session per activity owns all interpretation of the list. It classifies each entry (R2), diffs the
list once (unchanged, appended, rebuilt), applies v0.9 entries to its own `MessageProcessor` as today, and
validates v0.8 entries with `A2uiMessageSchema` plus the catalog check (R6). It exposes the accepted v0.8 messages
in order, with an `epoch` that grows on every rebuild. A small React component inside `A2UIProvider` pumps them into
the provider's processor: on a new epoch it clears the surfaces and replays, otherwise it processes only the messages
it has not seen. A message the processor still throws on (a circular reference, a component that fails its shape
guard) goes back to the session as an issue with the entry's position.

**Rationale**: `A2UIProvider` creates its own `A2uiMessageProcessor`, and the contexts that `useA2UIComponent` reads
are not exported. A v0.8 surface can only be drawn from the provider's processor, so the session cannot own that
processor as it owns the v0.9 one. Validating in the session keeps nearly every error, and all of the version and
catalog logic, in framework-free code that unit tests reach without a browser.

**Alternatives considered**:

- Two sessions, one per version, behind the view. Needs original positions threaded through, and two diffs.
- Own a second v0.8 processor in the session and mirror its surfaces into the provider. Two copies of the state.
- Write a v0.8 renderer on top of the processor's component tree. The constitution requires the official renderer.

**Detail to keep**: the processor rebuilds the component tree after every message and throws on a circular
reference or a failed shape guard. The throw leaves the earlier mutation in place, and the provider skips its
re-render. The pump calls `processMessages([])` after a failure so the surface redraws. Once a bad component is in
the surface, every later message of that surface reports the same error. That is upstream behavior, and each report
carries its own position.

## R4. How do v0.8 surfaces get their styles under the page's policy?

**Decision**: Give the provider an own `Theme` whose class names are the inspector's, style them in `a2ui.css` from the
theme tokens, and stop the renderer from injecting its stylesheet.

**Evidence and rationale**:

- On first mount the provider injects a `<style id="a2ui-structural-styles">` whose text is 308,064 characters of
  utility classes (`layout-g-2`, `color-bgc-p30`, ...). The page sends `style-src 'self'`, so the browser refuses it
  and logs a policy violation. The e2e checks require zero console errors, and the policy stays as it is.
- The package declares `./styles/structural.css`, but the file is not in the tarball.
- The injection returns early when an element with that id exists. A `<template id="a2ui-structural-styles">` in
  `document.head`, added before the first provider mounts, stops it. No policy change and no loophole such as
  constructable sheets.
- The standard `litTheme` maps components to those utility classes. A custom theme maps them to
  `agui-a2ui-*` classes instead, so v0.8 surfaces share the look of v0.9 surfaces, follow `--agui-*` overrides and
  light and dark mode with no palette mapping, and need none of the 308 KB of CSS.
- Surface styles that a message carries still work: the renderer writes `--p-50` and friends from `primaryColor`,
  and `--font-family` from `font`, on the `.a2ui-surface` element through the CSS object model, which the policy
  allows. The inspector's v0.8 CSS reads `var(--p-50, var(--acc))` and `var(--font-family, var(--agui-font-sans))`.
  The schema limits `primaryColor` to `#rrggbb`, and a font name starts no request.

**Alternatives considered**: A constructable stylesheet with the renderer's CSS (relies on a browser exemption that
may change). A build step that writes the CSS to a file (adds a shipped file, a link and 308 KB for classes the
inspector's theme would never use). Loosening `style-src` (forbidden by the constitution's policy clause).

## R5. Which stock components meet the bar, and which are replaced?

The bar (spec FR-008): a role, an accessible name and keyboard operation. A component that has all three is used as
it is.

| Component | Stock behavior | Decision |
| --- | --- | --- |
| `Text` | Renders Markdown through `markdown-it`: links and images become real elements | Replace: plain text in `h1` to `h5`, `p` and small text, so link and image syntax stays as typed |
| `Image`, `Video`, `AudioPlayer` | Load the address, `Video` embeds a YouTube iframe | Replace: the blocked note of v0.9, with the address as text, reported nowhere else |
| `Icon` | Draws the name as text in a `span` | Replace: the humanized name in a tag, announced as an image |
| `Tabs` | Plain buttons, the selected one `disabled`, no roles | Replace: the WAI-ARIA tabs of v0.9, shared |
| `Modal` | Trigger is a clickable `section`, a close button with a text glyph | Replace: the native dialog of v0.9, shared |
| `Button` | A `button`, always styled as primary, `primary` ignored | Replace: `data-variant` from `primary`, the v0.9 button class |
| `TextField`, `CheckBox`, `Slider`, `DateTimeInput`, `MultipleChoice` | A labelled `input`, `textarea`, range, date or `select` | Keep, styled through the theme. `obscured` shows plain text and `MultipleChoice` is a single `select`: both are upstream limits, documented |
| `Row`, `Column`, `List`, `Card`, `Divider` | Structure, with `a2ui-*` host classes and `data-*` attributes | Keep, styled through the theme and the host classes |
| Unknown type | `ComponentNode` logs a console warning and draws nothing | The session knows the types in each `surfaceUpdate`. It registers an in-place error component for each type the registry lacks, so the surface says which type and shows the definition as received |

**Sharing**: The v0.9 `Tabs` and `Modal` implementations keep their markup in the same file. Their markup moves to two
presentational components that both versions call, so one set of CSS and one test of keyboard behavior covers both.

**Registry detail**: nested stock components call `ComponentNode` without a `registry`, so they read the global
`ComponentRegistry` singleton. `A2UIProvider` fills it with the stock components on its first render and would
overwrite earlier registrations. The pump registers the replacements while it renders, which is after the provider's
first render and before its children render. The writes are idempotent.

## R6. Catalog ids, aliases and "Catalog not found"

**Decision**: One table in a dependency-free module.

- Known catalogs: v0.9 `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`, and v0.8
  `https://a2ui.org/specification/v0_8/standard_catalog_definition.json`. The v0.8 id is the default that the v0.8
  schema names in the description of `beginRendering.catalogId`. The v0.9 id is `basicCatalog.id`. The module holds
  both as literals so config parsing pulls in no package, and a unit test compares them with the packages.
- Built-in aliases: `https://a2ui.org/specification/v0_9/basic_catalog.json` to the v0.9 basic id. This is the 0.1.0
  alias, now one row of the table.
- Config aliases: `catalogAliases` (R7). The effective list is the built-in rows plus the config rows. A built-in
  key wins, and the config parser refuses such a key with a warning.
- An alias serves the version of its target. The v0.9 session builds one `Catalog` object per id that resolves to the
  v0.9 basic catalog (same components and functions, same guards, as the 0.1.0 alias). The v0.8 check accepts the ids
  that resolve to the v0.8 standard catalog, and no id at all.
- For v0.8 the check runs on `beginRendering`, which is the only message with a `catalogId`. Failure uses the
  v0.9 wording, `Catalog not found: <id>`, shows the entry as received and does not forward the message, so the
  surface never becomes visible. The processor keeps the components of an unnamed surface, which is harmless.

**Alternatives considered**: Normalizing ids (a trailing slash, a scheme): spec says exact. Failing a v0.8 surface
that names a v0.9 alias with a version-specific message: more code for a rare config mistake, and the docs explain it.

## R7. Where do aliases live in the config, and how are they checked?

**Decision**: Top-level `catalogAliases`, an object from a former id to a known catalog id (clarification 1). Parsing
follows `theme`: each bad entry is a warning and is dropped, and the file still loads. Rules, each with its own
warning text:

- the value of the field is not an object: the field is ignored;
- a key that is empty, or that is a known catalog id or a built-in alias: ignored (a known id is already built in);
- a value that is not a string, or not a known catalog id (so no chains, no unknown targets): ignored.

The accepted entries are built with `Object.fromEntries` and read with `Object.hasOwn`, so a key named
`__proto__` stays plain data. Embedded hosts reach it through a new optional `catalog_aliases` argument of
`mount_inspector`, passed into `config.json` as given, like `theme`.

**Alternatives considered**: Failing startup on a bad entry (the config's agent fields do this, but aliases are an
optional convenience, and the maintainer's branding rule for 0.2.0 says a bad value warns). Per-agent aliases
(clarification 1).

## R8. The action envelope

The v0.8 renderer sends `{ userAction: { name, sourceComponentId, surfaceId, timestamp, context } }`. The provider's
`onAction` maps it to the existing `A2uiAction` through a shared function, so `runtime.sendA2uiAction` and
`forwardedProps.a2uiAction.userAction` do not change.

The v0.8 data model stores objects as `Map`s. A context entry bound to an object path would reach the envelope as a
`Map`, and `JSON.stringify` writes a `Map` as `{}`. The mapping converts `Map`s to plain objects (deeply) before the
copy. A test binds an object path.

## R9. Size

A minified bundle of the v0.8 imports alone measures 281,838 bytes, 85,596 gzipped, and that includes React's JSX
runtime and zod, which the page already ships. The page measures 1,227,500 bytes and 308,758 gzipped today, against
2,000,000 and 600,000. The net cost is estimated at about 200 KB and 60 KB gzipped, which leaves more than half of the
headroom. `markdown-it` comes in with the renderer's chunk. It is not `@a2ui/markdown-it` and not DOMPurify, so the
dependency note about DOMPurify stays true, and a bundle test checks it. Loading the renderer on demand stays a 1.0.0
item, as the MVP decided. The representative budget build and its text change to name both renderers.

## R10. The reference story

One more quick message on the A2UI agent, `Review an expense report (v0.8)`, in the order after the existing ones and
before `Show the order form`. It sends one activity with two v0.8 surfaces:

- `expense`: a heading, a text field bound to the amount, a `MultipleChoice` for the category, a `CheckBox`
  ("Receipt attached"), a `Slider`, `Tabs` with a policy note, and a `Button` whose action `submit_expense` binds
  the four values.
- `status`: a `Text` bound to a data path that reads "Waiting for review", and a `Button` "Withdraw" whose action
  `withdraw_expense` binds the status text. The story has no `Modal`: v0.8 has no action that only opens a dialog, so a
  `Modal` trigger button would send a third, pointless action. The gallery (`gallery-v08.ts`) covers `Modal`.

The `submit_expense` run answers with the same list plus a `dataModelUpdate` that changes the status text and a
`surfaceUpdate` that adds a line echoing the received context. This is the shape of the v0.9 form's `continuation`.
The `withdraw_expense` run answers with the same list plus a v0.8 `deleteSurface` for `expense` and a status
update, so both ways a v0.8 list changes (data and structure) round trip.
The data lives in `a2ui-scenarios.ts` (`v08Surfaces`, `v08Continuation`, `mixedSurfaces`) and the story in
`a2ui-showcase.ts`, so unit tests, the browser fixture and the demo share one source. The sandbox probe keeps its
explicit-`version: "v0.8"` entry, which is still refused. No address in the story resolves.

## R11. Tests

| Level | What | Where |
| --- | --- | --- |
| Unit, no DOM | Classification (R2), v0.8 validation and catalog check, alias table and config parsing with warnings, diff (unchanged, appended, rebuilt), report-back of a refused message, alias ids of the v0.9 session, `toA2uiAction` for v0.8 with a `Map` | `packages/inspector/tests/a2ui/` and `tests/config/` |
| Unit | Story data: v0.8 messages pass the strict schema, the continuation grows the list, no address resolves, the old "everything speaks v0.9" check is narrowed | `tests/demo/a2ui-showcase.test.ts` |
| Browser | A fixture host feeds v0.8, mixed and aliased lists to the real view: drawn, typed text kept on append and lost on rebuild, action envelope, JSON unchanged, media blocked, Markdown stays text, keyboard on Tabs and Modal, unknown type in place, theme token override reaches v0.8, zero requests and zero console errors | `tests/e2e/a2ui/` |
| Browser, app | The hosted page with a config alias turns the sandbox probe's unknown catalog into a drawn surface, and a bad alias shows a configuration warning | `tests/e2e/config/`, `tests/e2e/a2ui/` |
| Browser, demo | The new story: both surfaces, the action round trip, nothing requested | `tests/e2e/public-demo/` |
| Python | `catalog_aliases` reaches `config.json` for Starlette and FastAPI, and is absent when not given | `packages/python/tests/test_embedding.py` |
| Budget | `npm run check:bundle` and the representative build | `scripts/bundle-budget.mjs` |

## R12. Risks and how the plan handles them

| Risk | Handling |
| --- | --- |
| The renderer's style injection id changes in a later release | The package is pinned, and the e2e check for zero console errors fails first. The placeholder is one function |
| Upstream v0.8 oddities (`obscured`, single-select `MultipleChoice`, repeated errors after a bad component) | Documented as renderer behavior, not worked around |
| Accessibility work grows | Only eight components are replaced, and two of them (Tabs, Modal) reuse the v0.9 markup |
| Bundle growth | Measured in the task that adds the import, before the rest is built. If the limits were at risk, loading the renderer on demand would be the next step, and it needs a spec change |
| Two global registries (the renderer's singleton) leak between activities | Replacements are idempotent writes of the same functions, and stand-ins depend only on the type name |
| A config alias collides with another worker's config change (branding, #73) | Both add one optional top-level field and one `parseConfig` branch. The rebase in phase 2 resolves it, and the `known fields` list is the only shared line |

## R13. Found while building

- The v0.8 processor reads a string property that equals a component id as a reference to that component. A `Text` with
  `"usageHint": "h1"` beside a component with the id `h1` is a circular dependency. The story and the gallery avoid such
  ids, and the A2UI page says so.
- The v0.9 renderer injects a `<style>` for Safari's date input (`a2ui-date-time-input-webkit-styles`) as `@a2ui/react/v0_9`
  loads. The page's static policy has no `style-src` and the full policy is added at startup, after the bundle has
  loaded, so the assembled page does not report it. The v0.8 renderer injects on its first mount, after startup, which is why
  the style placeholder (R4) matters there. The fixture page at `/strict` carries `style-src 'self'`, and `v08.spec.ts`
  names the v0.9 violation by its hash and fails on any other.
- With the placeholder removed, the demo story's console check fails on the renderer's policy violation. That test is the
  guard for it.
- The alias warning texts cut an id at 120 characters, not 48, because the two bundled ids are 70 and 74 characters long and
  a near miss differs at the end.
