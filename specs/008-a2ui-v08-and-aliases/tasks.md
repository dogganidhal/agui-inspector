# Tasks: A2UI v0.8 surfaces and catalog aliases

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md),
[contracts](contracts/), [quickstart](quickstart.md).

**Format**: `- [ ] Txxx [P] [USn] Description with file path`. `[P]` means the task touches different files from the
other open tasks of its phase and depends on none of them. `[USn]` maps to the user stories of the spec.

**Tests** are required by the constitution (behavior changes need regression tests, A2UI actions included, and
end-to-end tests run against the reference agent). Each test task sits with the code it covers, and a story is done
when its tests pass.

**Paths** are relative to the repository root. `src` means `packages/inspector/src`, `tests` under `packages` means
`packages/inspector/tests`.

## Phase 1: Setup

- [x] T001 Measure the bundle with the v0.8 imports before building anything on them. In `scripts/bundle-budget.mjs`
  make the representative build (`buildRepresentative`) import `A2UIProvider` and `A2UIRenderer` from
  `@a2ui/react/v0_8` and `A2uiMessageProcessor` and `A2uiMessageSchema` from `@a2ui/web_core/v0_8` beside the v0.9
  pieces, and change its header comments and printed text to name both renderers. Update the matching assertion
  (`/a2ui v0\.9 renderer/i`) in `packages/inspector/tests/foundation/budget.test.ts`. Run `npm run check:bundle:renderer`
  and write both numbers into the PR body. If either limit (2,000,000 bytes, 600,000 gzipped) is at risk, stop with
  `GATE BLOCKED` and the numbers.

## Phase 2: Foundational (blocks every story)

Pure core code, the one session change, and the shared scenario data. No view change yet, so every existing v0.9 test
stays green except the ones that assert the old refusal text, which this phase rewrites.

- [x] T002 [P] Add the shared types in `src/contracts.ts`: `export type CatalogAliases = { readonly [id: string]: string }`,
  an optional `readonly catalogAliases?: CatalogAliases` on `ConfigFile`, and an optional
  `readonly catalogAliases?: CatalogAliases` on `A2uiViewProps`. `src/contracts.ts` must not import React.
- [x] T003 [P] Create `src/core/a2ui/catalogs.ts` as in [data-model.md](data-model.md#catalog-table-corea2uicatalogsts-new):
  the literals `BASIC_V09` (`https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`) and `STANDARD_V08`
  (`https://a2ui.org/specification/v0_8/standard_catalog_definition.json`), `KNOWN`, `BUILT_IN_ALIASES` (the
  middleware default `https://a2ui.org/specification/v0_9/basic_catalog.json` to `BASIC_V09`), `catalogIds(version, configured?)`,
  `resolves(version, id, configured?)` and `checkAliases(value)`. `checkAliases` applies, per entry in this order:
  key empty; key in `KNOWN` or `BUILT_IN_ALIASES`; value not a string; value not in `KNOWN`; a value of the field that
  is not an object drops the whole field. Warning texts are exactly those of
  [config-catalog-aliases.md](contracts/config-catalog-aliases.md#warnings), with names quoted and cut at 48
  characters. Build the result with `Object.fromEntries`, read with `Object.hasOwn`. No import from React, a package
  or the DOM. Add `packages/inspector/tests/a2ui/catalogs.test.ts`: every warning text, a key named `__proto__`
  kept as data, `catalogIds('v0.9')` and `catalogIds('v0.8')` with and without config, a config alias of the other
  version not counted, and the two literals equal to `basicCatalog.id` from `@a2ui/react/v0_9` and to the default
  named in the description of `beginRendering.catalogId` in `@a2ui/web_core/v0_8`'s schema.
- [x] T004 [P] Create `src/core/a2ui/operations.ts`: `classify(operations)` and `surfaceKey(entry)` as in
  [data-model.md](data-model.md#operation-entries-corea2uioperationsts-new). An object with `"version": "v0.9"` is
  v0.9. An object with no `version` and at least one of `beginRendering`, `surfaceUpdate`, `dataModelUpdate`,
  `deleteSurface` is v0.8. Everything else is refused with `This operation is not an object.`,
  `This operation has no version and no v0.8 message name. A2UI v0.9 operations declare "version": "v0.9".` or
  `This operation declares version <value>. A2UI v0.9 operations declare "v0.9", and v0.8 messages have no version.`,
  each as a `SurfaceIssue` of source `operation` with the position and the entry as received. Add
  `packages/inspector/tests/a2ui/versions.test.ts`: all three refusals, `deleteSurface` with and without `version`,
  an explicit `"version": "v0.8"`, a v0.9 key without a version, two v0.8 kinds in one message (still classified
  v0.8), `surfaceKey` for each message kind, and a non-string `surfaceId`.
- [x] T005 [P] Extend `src/core/a2ui/actions.ts`: a function that turns the v0.8 renderer's
  `{ userAction: { name, surfaceId, sourceComponentId, timestamp, context } }` into the existing `A2uiAction`, sharing
  the five-field copy with `toA2uiAction`. It converts `Map` values to plain objects, deeply, before
  `structuredClone`. Add cases to `packages/inspector/tests/a2ui/surfaces.test.ts` (or a new
  `packages/inspector/tests/a2ui/actions.test.ts`): five fields exactly, a `Map` context value written as an object,
  and the copy is independent of the source.
- [x] T006 [P] Add the shared scenario data to `examples/reference-agent/a2ui-scenarios.ts`: `STANDARD_V08_CATALOG_ID`,
  `v08Surfaces` (the six messages of [reference-story.md](contracts/reference-story.md): `expense` with a title,
  amount `TextField`, category `MultipleChoice`, `CheckBox`, `Slider`, two-note `Tabs` and a "Submit expense" `Button`
  whose `submit_expense` action binds amount, category, receipt and urgency; `status` with a bound `Text` and a
  `Modal` whose trigger is a "Show policy" `Button`, and a "Withdraw" `Button` whose `withdraw_expense` action binds
  `{ status }` to `/status`), `v08Continuation(previous, action)` (for `submit_expense` the status
  `dataModelUpdate` and the echo `surfaceUpdate`, for `withdraw_expense` a `deleteSurface` of `expense` and a status
  `dataModelUpdate`, both keeping the first six messages as they were) and `mixedSurfaces`
  (one v0.8 surface and one v0.9 surface, with a shared surface id in one of them). No `version` key in any v0.8
  message, no address outside the reserved `.invalid` host. Erasable TypeScript only. Add
  `tests/demo/a2ui-scenarios-v08.test.ts`: every v0.8 message passes `A2uiMessageSchema` from `@a2ui/web_core/v0_8`,
  a real `A2uiMessageProcessor` shows both surfaces after the six messages, each continuation extends the list, and
  after `withdraw_expense` only `status` is visible.
- [x] T007 Rework the session in `src/core/a2ui/index.ts` per
  [data-model.md](data-model.md#session-snapshot-corea2uiindexts-extended), after T002 to T005. `apply` classifies
  with `classify`, diffs the whole list once (not a list: release and one issue showing the value; same list: nothing;
  prefix of the new list: only the tail; else rebuild with `epoch` + 1, clean issues and `order`), applies v0.9
  entries to the `MessageProcessor` as today (`structuredClone`, try/catch, original position as `index`), and for
  v0.8 entries runs `A2uiMessageSchema.safeParse` (issue text `<path>: <message>` for the first three problems, joined
  by `; `, or the schema's own message when the path is empty), then, for `beginRendering`, `resolves('v0.8', catalogId ?? STANDARD_V08, aliases)`
  and the issue `Catalog not found: <id>`, then adds `{ index, message }` to `v08.messages`. Add `v08: V08Feed`,
  `order` (`surfaceKey` of each entry's surface, first named first) and `refused(index, operation, error)` (adds a
  `source: 'operation'` issue and publishes). `SurfaceSessionOptions` gains `aliases?` and
  `catalog(report, aliasIds)`, where `aliasIds` is `catalogIds('v0.9', aliases)` without the basic id itself.
  Remove `SUPPORTED_VERSION` and `rejection`. Extend `packages/inspector/tests/a2ui/surfaces.test.ts`: v0.8 entries
  accepted and refused (strict-schema failures, two kinds, unknown `catalogId`, absent `catalogId`), order across
  versions, a surface id used by both versions kept apart, unchanged list does nothing, appended list adds only the
  tail with positions that continue, rewritten earlier entry bumps `epoch`, `refused` publishes, the received list
  never changes (`JSON.stringify` before and after), and one list of 200 v0.8 messages applied in a single pass.
  Rewrite the assertions on the old wording (`packages/inspector/tests/a2ui/surfaces.test.ts:373`
  and any other `Only A2UI v0.9 is supported`) to the new text.
- [x] T008 [P] Change `src/views/a2ui/catalog.tsx`: `createBundledCatalogs(report, aliasIds)` builds the basic
  catalog and one `Catalog` per id in `aliasIds` (same components, functions, guards and stand-ins), and the hard-coded
  `MIDDLEWARE_CATALOG_ID` goes away because `catalogIds('v0.9')` supplies it. The one-argument form keeps working
  with the built-in ids as its default. Update `packages/inspector/tests/a2ui/catalog.test.ts`: the two ids of 0.1.0
  still resolve with no config, plus a configured alias of the basic catalog with the same shared components and the
  `openUrl` guard, and a configured alias of the v0.8 catalog still gives `Catalog not found`.
- [x] T009 [P] Update the three browser or demo assertions on the old refusal wording, to the texts of
  [a2ui-operations.md](contracts/a2ui-operations.md#which-version-an-entry-is): `tests/e2e/a2ui/surfaces.spec.ts`
  (line 138, `Only A2UI v0.9 is supported`), `tests/e2e/public-demo/a2ui-showcase.spec.ts` (lines 369 and 370) and
  `tests/demo/a2ui-showcase.test.ts` (lines 484 and 485). The sandbox probe keeps its entry that declares
  `"version": "v0.8"`: it stays refused, now by the second text.

**Checkpoint**: `npm run typecheck` and `npm run test:unit -- packages/inspector/tests/a2ui tests/demo` pass. No view
shows a v0.8 surface yet.

## Phase 3: User Story 1, see a v0.8 surface and use it (P1)

**Goal**: A v0.8 activity is drawn by the official v0.8 renderer, and its actions round trip.

**Independent test**: Feed `v08Surfaces` to the fixture host, check both surfaces, type, press the button, and compare
the action and the JSON view.

- [x] T010 [P] [US1] Create `src/views/a2ui/v08-theme.ts`: one `Types.Theme` (from `@a2ui/react/v0_8`) with every key
  of `components`, `elements` and `markdown` set to `agui-a2ui-*` class maps (no utility class from the renderer).
  Export it as a constant.
- [x] T011 [P] [US1] Move the markup of the v0.9 `Tabs` and `Modal` in `src/views/a2ui/components.tsx` into
  `src/views/a2ui/parts.tsx` as `TabsView` (titles, a `renderPanel(index)` callback, an accessibility label, the
  WAI-ARIA tabs with Arrow, Home and End keys) and `ModalView` (trigger node, content node, label; native `dialog`,
  Escape and Close and backdrop shut it, focus returns to the trigger). The v0.9 components call them. No visible
  v0.9 change: `tests/e2e/a2ui/components.spec.ts` stays green.
- [x] T012 [US1] Create `src/views/a2ui/v08.tsx` (after T010 and T011). `V08Host({ session, snapshot, onAction, children })`:
  mounts `A2UIProvider` from `@a2ui/react/v0_8` with the theme of T010 and an `onAction` that maps through T005 and
  calls the activity's `onAction`; before the first provider render it adds `<template id="a2ui-structural-styles">`
  to `document.head` once (guard `typeof document`) so the renderer never injects its stylesheet; inside the provider a
  pump component (a) registers, in render and idempotently, replacements in `ComponentRegistry.getInstance()` for
  `Text` (plain text: `h1` to `h5` for the usage hints, `p` for body, small muted text for `caption`), `Image`,
  `Video`, `AudioPlayer` (the `Blocked <Kind>: <address>` note with `data-blocked`), `Icon` (humanized name in a tag
  with `role="img"` and its label), `Tabs` and `Modal` (through `TabsView` and `ModalView`) and `Button`
  (`data-variant` from `primary`, class `agui-a2ui-btn`, child through `ComponentNode`), (b) in a layout effect feeds
  `snapshot.v08.messages` to `useA2UIActions().processMessages` as clones, one at a time in try/catch, clearing the
  surfaces first when `epoch` changed and processing only unseen messages otherwise, calls `processMessages([])` after
  a throw so the surface redraws, and reports the throw through `session.refused`, (c) before feeding a `surfaceUpdate`
  registers an in-place error component for each component type the registry lacks, which shows
  `Unknown component type: <type>. The catalog has no such component, so nothing is drawn for it.` and the stored
  definition under "As received" (read from `getSurface(surfaceId).components`), (d) calls `children(ids)` with the ids
  of the v0.8 surfaces that have a component tree. Each v0.8 surface keys on `<id>:<epoch>` so a rebuild remounts.
- [x] T013 [US1] Update `src/views/a2ui/index.tsx` (after T012): `Rendered` draws `snapshot.order` as one list, a v0.9
  surface from `snapshot.surfaces` and a v0.8 surface inside `V08Host`, each in
  `<div className="agui-a2ui-surface" data-surface data-version>`. `V08Host` mounts only when
  `snapshot.v08.messages.length > 0`. `A2uiView` and `a2uiActivity` take the optional `catalogAliases` and pass it
  to `createSurfaceSession({ aliases, catalog: createBundledCatalogs })`. The `Issues` block and the lifecycle views are
  unchanged. Keep the "No surface has been created yet." note for an empty result.
- [x] T014 [P] [US1] Add the v0.8 rules to `src/views/a2ui/a2ui.css` under
  `.agui-a2ui-surface[data-version="v0.8"]`: the host classes of the stock layout components (`a2ui-row`,
  `a2ui-column`, `a2ui-list`, `a2ui-card`, `a2ui-divider`, `a2ui-textfield`, `a2ui-checkbox`, `a2ui-slider`,
  `a2ui-datetime-input`, `a2ui-multiplechoice` and their `data-alignment` and `data-distribution` attributes), the
  theme classes of T010, and the accent and font taken from `var(--p-50, var(--acc))` and
  `var(--font-family, var(--agui-font-sans))`. Colors come from `--agui-*` tokens only, so light, dark and overrides
  work. No `url(`, no `@import`, no font face.
- [x] T015 [US1] Extend the browser fixture `packages/inspector/tests/a2ui/fixture.tsx` (and `tests/e2e/a2ui/support.ts` if its helpers need the
  new calls) so `window.__a2ui.set`,
  `activity` and the continuation helper accept v0.8 lists and an `aliases(map)` call (after T013). Add
  `tests/e2e/a2ui/v08.spec.ts` with the US1 scenarios: both surfaces drawn from `v08Surfaces`; a surface with no
  `beginRendering` yet draws nothing and reports nothing; typing and pressing "Submit expense" calls back with the five
  fields and the values bound at the click (also with an object path bound, so a `Map` is read as an object); the
  scripted continuation changes the status line and keeps what was typed when the list only grows, and a rewritten
  earlier message redraws and loses it; JSON view and frames unchanged byte for byte after interaction; rendering off
  shows JSON with the note; `Image`, `Video`, `AudioPlayer` as notes, Markdown link and image syntax stays text, no
  request and no console error across the whole session; Tab reaches the controls, Enter and Space activate, Arrow
  keys move tabs, Escape closes the modal and focus returns to its trigger; an unknown component type is an error in
  place and the rest draws; every control has a role and an accessible name (`getByRole` with name for each of the 18
  types, from a new `packages/inspector/tests/a2ui/gallery-v08.ts` that lists one surface with all 18 types, the way
  `gallery.ts` does for v0.9); an overridden `--agui-r` reaches a v0.8 control; `surface.styles`
  `primaryColor` changes the accent of that surface only.
- [x] T016 [US1] Run `npm run build && npm run check:bundle` and write the totals into the PR body. Check
  `dist/app.js` for `dompurify` and `@a2ui/markdown-it` (they must be absent, since `dependencies.mdx` says so) in a
  new assertion of `packages/inspector/tests/foundation/budget.test.ts`.

**Checkpoint**: US1 works in the fixture and its tests pass. The page shows v0.8 surfaces. Aliases and mixed lists are
not covered yet.

## Phase 4: User Story 2, several surfaces and both versions in one activity (P1)

**Goal**: One list can hold both versions, and a bad entry harms nothing else.

**Independent test**: Feed `mixedSurfaces` plus bad entries. Both surfaces draw, the errors name their positions.

- [x] T017 [US2] Extend `tests/e2e/a2ui/v08.spec.ts` with the US2 scenarios from `mixedSurfaces`: both versions drawn in the
  order first named; a v0.8 and a v0.9 surface that share an id are two surfaces (`data-version` tells them apart); an
  unversioned `deleteSurface` removes only the v0.8 surface, a v0.9 one only the v0.9 surface; a non-object, a
  versionless v0.9-shaped entry, an explicit `"version": "v0.8"`, a v0.8 message with two kinds and a v0.8 message
  the schema refuses each show one alert with the right position and an "As received" block, and every valid surface
  still draws (SC-003: two bad entries, exactly two alerts); a v0.8 `surfaceUpdate` that makes a circular reference is
  reported by position and the other surface survives. Typed text in the v0.9 surface survives an appended v0.8
  tail and the reverse.
- [x] T018 [P] [US2] Add unit tests in `packages/inspector/tests/a2ui/surfaces.test.ts` for the mixed list: `order`,
  `v08.messages` positions with v0.9 entries between them, and `refused` for a message the real v0.8 processor throws
  on (a circular reference and `Invalid data; expected Text`), driven through a real `A2uiMessageProcessor`.

**Checkpoint**: Both P1 stories pass.

## Phase 5: User Story 3, name a catalog by a former id (P2)

**Goal**: A configured alias resolves, an unknown id is still "Catalog not found", and the 0.1.0 special case is a row.

**Independent test**: Load a config with one alias per version, send surfaces that use them and one that does not.

- [x] T019 [P] [US3] Parse the field in `src/core/config/index.ts`: add `catalogAliases` to the `unexpectedKey` list of
  `parseConfig`, call `checkAliases` from `core/a2ui/catalogs.ts`, append its warnings to `warnings`, and return the
  accepted aliases only when at least one survived (`...(aliases !== undefined && { catalogAliases: aliases })`).
  `ParsedConfig` carries them. Add cases to `packages/inspector/tests/config/settings.test.ts` (or a new
  `packages/inspector/tests/config/aliases.test.ts`): a valid field kept, no field means no `catalogAliases` key, each
  warning of the contract with the file still loading and the agents listed, a valid and an invalid entry together,
  `"catalogAliases": 3`, a `__proto__` key, an empty object.
- [x] T020 [US3] Plumb it (after T019 and T013): `src/app/startup.ts` returns `catalogAliases` beside `theme`, and
  `src/app/index.tsx` passes it to `a2uiActivity(entry, { renderEnabled, onAction, catalogAliases })`. Add a startup
  test beside the theme one (`the theme in config.json is handed to the page with no extra request, in every deployment mode`)
  in `packages/inspector/tests/hosted/startup.test.ts`: the aliases are handed over with no extra request.
- [x] T021 [P] [US3] Add `catalog_aliases: dict[str, str] | None = None` to `mount_inspector` in
  `packages/python/src/agui_inspector/__init__.py`. A dict goes into `config.json` as `catalogAliases`, unchanged, even
  when empty. `None` leaves the field out. Document it in the docstring in the style of `theme`. Add tests to
  `packages/python/tests/test_embedding.py`: served for Starlette and FastAPI, a custom mount path, absent when `None`,
  delivered unchanged when odd (an empty key, a non-string value), as the theme tests do.
- [x] T022 [US3] Add an end-to-end chain test in `packages/inspector/tests/a2ui/catalog.test.ts`: `parseConfig` of a text with
  aliases, then `createSurfaceSession({ aliases: parsed.catalogAliases, catalog: createBundledCatalogs })` draws a v0.9
  surface that names a former id, with the real renderer models, `noFetch` and the operations unchanged
  (`JSON.stringify` before and after), and an unlisted or near-miss id (`<id>/`, another scheme, another case) gives
  `Catalog not found: <id>` with the entry as received. Add the v0.8 equivalent (a v0.8 `beginRendering` with an
  aliased id is accepted, an id aliased to the v0.9 catalog is refused, no `catalogId` is accepted).
- [x] T023 [US3] Add browser scenarios. In `tests/e2e/a2ui/v08.spec.ts` use `__a2ui.aliases(...)` for a former id on a
  v0.9 and on a v0.8 surface, the JSON view still showing the former id, and an unknown id showing the alert. In
  `tests/e2e/config/settings.spec.ts` serve a `config.json` with `catalogAliases` for the whole hosted page and the
  reference agent: the sandbox probe's `https://catalog.invalid/custom.json` entry draws when the alias maps it to the
  v0.9 basic id, and a file with a bad alias starts with the warning in the "Configuration warnings" area and the
  valid aliases kept.

**Checkpoint**: US3 passes with US1 and US2.

## Phase 6: User Story 4, try the v0.8 scenario and read how it works (P3)

**Goal**: The reference agent has a v0.8 story that round trips, and the docs describe v0.8 and aliases.

**Independent test**: Send the quick message to the A2UI agent, act on a surface, read the new docs.

- [x] T024 [US4] Add the story to `examples/reference-agent/a2ui-showcase.ts`: `SHOWCASE.v08 = 'Review an expense report (v0.8)'`
  placed after `sandbox` in the object, `ACTIONS.submitExpense = 'submit_expense'`, `ACTIONS.withdrawExpense = 'withdraw_expense'`, the first-run snapshot from
  `v08Surfaces` (message id `a2ui-surface-expense-<runId>`, `replace: true`) and each action's answer
  from `v08Continuation`. Update the header comment ("made of the basic catalog (v0.9) alone"). Nothing is remembered
  between runs, and no address resolves.
- [x] T025 [P] [US4] Update `demo/config.json`: the A2UI agent's `quickMessages` gain `Review an expense report (v0.8)`
  before `Show the order form`, and its declared capability `custom.a2ui` becomes
  `{ "versions": ["v0.8", "v0.9"], "catalogs": ["basic", "standard"], "activityType": "a2ui-surface", "activityDeltas": true }`
  (keep the `identity.description` accurate; `grep -rn "custom" website/content/docs/demo*.mdx` for a docs line that
  quotes the old object). Update `tests/demo/a2ui-showcase.test.ts`: the quick-message list test, the
  "seven different answers" count and name, the "every operation speaks v0.9 outside the sandbox probe" test (the v0.8
  story carries no `version` key at all and no v0.9 key), the declared capability object, and a new test for the story
  (first run, both actions' answers, no resolvable address, each continuation keeps the first six messages).
- [x] T026 [US4] Add a story case to `tests/e2e/public-demo/a2ui-showcase.spec.ts`: choose the story in the demo, see both
  surfaces, submit and see the updated status line and the echo, withdraw and see `expense` disappear, and no
  request outside the origin. Add one hosted-app case
  in `tests/e2e/hosted/app.spec.ts` or `tests/e2e/a2ui/received.spec.ts` that sends the same quick message to the
  Node reference agent and checks the recorded request of the action run carries the five fields, and that the frames of the first run in the
  recording are byte for byte the same before and after acting (SC-002).
- [x] T027 [P] [US4] Rewrite `website/content/docs/a2ui.mdx`: the intro and the first bullets (drop "Only A2UI v0.9 is
  supported"), "What is drawn" (both message families), a new "Versions" section (how the version of an entry is found,
  the three refusals with their text, one id space per version, drawing order, a v0.8 surface shows once its root is
  named, the explicit-version case), a "v0.8 surfaces" section (the 18 components and which behave differently from
  v0.9: `Text` is plain text, media are notes, `obscured` shows plain text, `MultipleChoice` is one `select`, the
  surface's `styles` apply to it alone, no `openUrl`), "Versions and catalogs" rewritten for aliases (the table of
  ids, the config field, exact matching, no chains, the wrong-version alias, the built-in middleware row, "Catalog not
  found" with the entry as received), "Actions" with the v0.8 context list, "Theme and size" (the v0.8 renderer is in
  the main bundle, with the measured numbers of T016). Short plain sentences, no em dashes, no bold labels.
- [x] T028 [P] [US4] Update the neighbors: `website/content/docs/configuration.mdx` (the `catalogAliases` row in the field
  table, a "Catalog aliases" section with the example and the warning table of the contract),
  `website/content/docs/embedding.mdx` (the `catalog_aliases` argument), `website/content/docs/demo.mdx` (eight quick
  messages, a "Review an expense report (v0.8)" section, the sandbox probe's v0.8 entry described as an entry that
  declares a version), `website/content/docs/status.mdx` (line 77: A2UI v0.8 and v0.9),
  `website/content/docs/dependencies.mdx` (purpose text of the `@a2ui/react` and `@a2ui/web_core` rows names both
  versions), `website/content/docs/internals.mdx` (the A2UI view wiring: session, pump, theme, stand-in, the style
  placeholder and why, `catalogAliases`; the A2UI tests list), `README.md` and `AGENTS.md` (the line that says "A2UI v0.9
  surfaces" now says "A2UI v0.8 and v0.9 surfaces"). Run `npm run test:unit -- tests/ci tests/release` for the tests that
  read the docs.

**Checkpoint**: All four stories pass and the docs match.

## Phase 7: Polish and cross-cutting

- [x] T029 Add the changesets: `.changeset/a2ui-v08-and-aliases-inspector.md` (`agui-inspector`, minor) and
  `.changeset/a2ui-v08-and-aliases-python.md` (`agui-inspector-python`, minor), one plain paragraph each: v0.8
  surfaces are drawn, `catalogAliases` is a new optional config field, and `catalog_aliases` is a new argument of
  `mount_inspector`. Versions are never edited by hand.
- [x] T030 Run `npm run check:ci` and fix what it finds. While iterating, use targeted e2e runs with `--workers=2`.
- [x] T031 If the code and the spec disagree, run `/speckit-converge`. Write the missing work into this file.
- [ ] T032 Run `/ponytail:ponytail-review` on the diff and fix what it finds. Run the humanizer skill on the new docs
  text and on the PR body.
- [ ] T033 Rebase on `origin/main` (keep merged features intact, expect conflicts in `parseConfig`, `mount_inspector`
  and `a2ui.mdx` from the branding work), push with `--force-with-lease`, update the PR body with
  `gh api -X PATCH repos/dogganidhal/agui-inspector/pulls/<n> -F body=@<file>`, then `gh pr ready <n>`.

## Dependencies and order

```text
T001
 └─ Phase 2: T002 T003 T004 T005 T006 (parallel) ─► T007 ─► T008 T009 (parallel)
      └─ US1: T010 T011 (parallel) ─► T012 ─► T013 ─► T014 (parallel with T013) ─► T015 ─► T016
           └─ US2: T017, T018 (T018 can start after T007)
           └─ US3: T019 ─► T020; T021 and T022 any time after T007 and T008; T023 after T013 and T020
           └─ US4: T024 after T006 and T007; T025 after T024; T026 after T025 and T013; T027 and T028 after T016
 └─ Polish: T029 ─► T030 ─► T031 ─► T032 ─► T033
```

US3's core (T019, T021, T022) does not need the v0.8 view. If the view slips, those tasks can ship first and the
spec's alias scenarios 1, 3, 4, 6 and 7 pass without it.

## Parallel examples

- Phase 2 start: T002, T003, T004, T005 and T006 are five different files.
- After T012: T014 (CSS) and T015's fixture change.
- US3 and US4 docs work (T021, T027, T028) while US1's browser tests run.

## Implementation strategy

1. T001, then Phase 2, then US1. Stop and measure at T016. The v0.8 renderer is the risk, so it goes first.
2. US2 and US3 next, in either order. They are small once the session and the view exist.
3. US4 last: the story needs the finished view, and the docs need the final wording and numbers.
4. MVP: Phases 1, 2 and 3. A v0.8 agent then sees its surfaces and can act on them. Aliases and the story follow.

## Coverage

| Spec | Tasks |
| --- | --- |
| FR-001 | T004, T007, T017 |
| FR-002 | T007, T013, T017 |
| FR-003 | T007, T012, T015 |
| FR-004, FR-005 | T007, T012, T015 |
| FR-006 | T013, T015 |
| FR-007 | T005, T012, T015, T026 |
| FR-008 | T010, T011, T012, T014, T015 |
| FR-009, FR-010 | T012, T015, T016 |
| FR-011 | T003, T012 |
| FR-012 | T007, T022 |
| FR-013, FR-014, FR-016 | T003, T019 |
| FR-015 | T003, T008 |
| FR-017 | T007, T022, T023 |
| FR-018 | T021 |
| FR-019 | T006, T024, T025, T026 |
| FR-020 | T027, T028 |
| FR-021 | T001, T016 |
| FR-022 | T008, T009, T011, T030 |
| SC-001 | T015, T026 |
| SC-002 | T007, T015 |
| SC-003 | T017 |
| SC-004 | T003, T022, T023 |
| SC-005 | T015, T016, T026 |
| SC-006 | T030 |
| SC-007 | T027, T028 |

## Implementation notes

Where the work differs from the task text above. The design documents were updated to match.

- T003 and T019: `catalogs.ts` holds the table (`catalogIds`, `resolves`, `isBuiltIn` and the literals). The alias rules and
  their warnings are `parseCatalogAliases` in `core/config/index.ts`, beside `parseTheme` and `parseBrand`, and their tests
  are in `packages/inspector/tests/config/aliases.test.ts`. A warning cuts an id at 120 characters.
- T004: `classify` takes an optional `offset`, so the session can classify a tail.
- T006 and T024: the story has no `Modal` (research R10), and its activity id is the constant `a2ui-expense-v08`.
  `gallery-v08.ts` covers `Modal`.
- T011: `parts.tsx` also holds `IconView`, `ButtonView`, `BlockedView` and `UnknownView`, because the v0.8 components have the
  same shape as the v0.9 ones. See the PR body for the list of what is shared.
- T015: `gallery-v08.ts` and its unit test are new, and the browser spec opens the fixture at `/strict`
  (the page's `style-src 'self'`).
- T016: the DOMPurify check is in `budget.test.ts`. `@a2ui/markdown-it` is not checked, because the v0.9 renderer carries its
  name in a warning string.
- T020: the startup test sits beside the theme one in `tests/hosted/startup.test.ts`.
- T023 and T026: the alias end-to-end tests are in `tests/e2e/a2ui/aliases.spec.ts`, with a scripted route in
  `tests/e2e/hosted/support.ts`, and not in `settings.spec.ts`. The second half of T026 (a hosted-app case on the Node
  reference agent) is covered by the demo spec, which runs the same producers through the service worker and compares every
  run's bytes with them.
- T033 is the rebase and push after the review below.
