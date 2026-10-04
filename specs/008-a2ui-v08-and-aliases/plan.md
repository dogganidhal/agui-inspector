# Implementation Plan: A2UI v0.8 surfaces and catalog aliases

**Branch**: `gh-78-a2ui-v08-and-aliases` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: `specs/008-a2ui-v08-and-aliases/spec.md`, [issue #78](https://github.com/dogganidhal/agui-inspector/issues/78),
the 0.2.0 roadmap (item 6).

**Status**: Planning only. Implementation waits for the maintainer's approval of the spec and this plan.

## Summary

Draw A2UI v0.8 surfaces with the v0.8 renderer of `@a2ui/react` 0.12.0 and accept catalog aliases in the config.

The activity session classifies each operation by its shape, applies v0.9 entries as it does today, and validates v0.8
entries with the strict v0.8 schema and a catalog check, because the v0.8 processor ignores `catalogId`. A small
component inside `A2UIProvider` pumps the accepted v0.8 messages into the provider's processor, which is the only way
to draw them. The renderer's own stylesheet cannot load under the page's policy, so the provider gets an inspector
theme styled from the existing tokens. Eight stock components are replaced to keep media, links and fonts off the wire
and to meet the keyboard and naming bar of v0.9. One small table of catalog ids holds the built-in middleware alias and
the config's aliases, so the 0.1.0 special case becomes a row. A new optional top-level `catalogAliases` field, and a
matching `catalog_aliases` argument of the Python helper, carry the aliases. The reference agent gets a v0.8 story with
an action that round trips, and `a2ui.mdx` and its neighbors are updated.

No new dependency. The renderer packages are already pinned and bundled.

## Technical Context

**Language/Version**: Strict TypeScript 7.0.2 (`noUncheckedIndexedAccess`, `erasableSyntaxOnly`), React 19.3.0, Node
>=24, Python >=3.10.
**Primary Dependencies**: Existing exact pins: `@a2ui/react` 0.12.0 (`/v0_8` and `/v0_9`), `@a2ui/web_core` 0.12.0
(`/v0_8` and `/v0_9`), `zod` 3.25.76. Nothing is added.
**Storage**: None. Aliases come from `config.json`. No credential is involved.
**Testing**: `node --test` through the esbuild test runner, Playwright (Chromium) against the scripted reference agent,
Python `unittest`. The bundle-budget script.
**Target Platform**: The one static bundle: hosted page, embedded Python helper, npm static assets, public demo.
**Project Type**: Static browser app with framework-free core and React views.
**Performance Goals**: No new target. The A2UI code runs only for `a2ui-surface` activities, so the inherited
responsiveness criteria of the MVP (5,000-frame sessions, filter and expand within 200 ms) are not touched. The
unit tests include one list of 200 v0.8 messages applied in a single pass to catch accidental quadratic work.
**Constraints**: Production bundle at most 2,000,000 bytes minified and 600,000 gzipped. Content security policy
unchanged (`style-src 'self'`, no `eval`). No request except to configured targets.
**Scale/Scope**: An estimated 700 lines of source across 10 files, 900 lines of tests, one docs page rewritten in
part and six more touched.

## Constitution Check

*GATE: passes before Phase 0, and again after Phase 1.*

| Rule | Assessment |
| --- | --- |
| I. Wire first | Pass. The recorder, store and frame reader are untouched. Operations are cloned before any renderer sees them, so what the agent sent is what every view shows. v0.8 entries that cannot be applied are reported with their position and the entry, and nothing is dropped from the record |
| II. Protocol, not a framework | Pass. v0.8 uses `@a2ui/react/v0_8` and `@a2ui/web_core/v0_8`, the packages the principle names, for the supported versions. `core/` stays React-free: it imports only the web_core schema. No chat framework |
| III. Generic core, presets | Pass. Aliases are configuration. The core has no agent-specific branch. The only built-in alias is the middleware default of 0.1.0, which the MVP spec already accepted |
| IV. Local-only, credentials | Pass. No request, no catalog fetch, no font or stylesheet load. The renderer's attempted style injection is prevented, not allowed. `style-src`, `script-src` and `connect-src` do not change. No credential is read or kept. A v0.8 `Image`, `Video` or `AudioPlayer` is a note, and a v0.8 `Text` cannot make a link or an image |
| V. Small and auditable | Pass. No dependency. One new table of ids replaces a special case. Eight components are replaced, and two of those share markup with v0.9 rather than copy it. The renderer's 308 KB utility stylesheet is not used. Simplest design: the session stays the single interpreter of the list |
| VI. Every event type has a view | Not affected. No event type is added. The activity view changes inside its card |
| Architecture and distribution | Pass. One bundle for all modes. The Python helper only gains an optional argument that writes the same `config.json` field. Embedded mode needs no new route |
| Release scope | Pass. 0.2.0 item 6, [#78](https://github.com/dogganidhal/agui-inspector/issues/78), accepted scope. Only released upstream features: both renderer versions are released in 0.12.0 |
| Quality gates | Pass. Behavior changes have regression tests, including A2UI actions. End-to-end tests run against the reference agent. The bundle budget runs in `check:ci`. Config warnings keep the "never stops startup" rule of `theme` |
| Formats | Pass. Config stays at version 0 with one optional field. A file without it behaves as before. No migration |

**Post-design re-check**: the design adds no `unsafe-inline`, no constructable stylesheet and no `eval`. The
placeholder element that stops the style injection is a plain `<template>` in `document.head`. No violation, so no
complexity table.

## Project Structure

### Documentation (this feature)

```text
specs/008-a2ui-v08-and-aliases/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── config-catalog-aliases.md
│   ├── a2ui-operations.md
│   └── reference-story.md
├── checklists/requirements.md
├── spec.md
└── tasks.md            # speckit-tasks
```

### Source code

```text
packages/inspector/src/
├── contracts.ts                    # ConfigFile.catalogAliases, A2uiViewProps.catalogAliases
├── core/
│   ├── a2ui/
│   │   ├── catalogs.ts             # new: id table, built-in alias, catalogIds, resolves, isBuiltIn
│   │   ├── operations.ts           # new: classify, surfaceKey
│   │   ├── actions.ts              # toA2uiAction accepts the v0.8 userAction (Map to object)
│   │   └── index.ts                # session: classification, v0.8 validation and feed, order, refused()
│   └── config/index.ts             # parseCatalogAliases and the catalogAliases branch of parseConfig
├── app/
│   ├── startup.ts                  # returns catalogAliases beside theme
│   └── index.tsx                   # hands them to a2uiActivity
└── views/a2ui/
    ├── catalog.tsx                 # createBundledCatalogs(report, aliasIds)
    ├── parts.tsx                   # new: TabsView, ModalView (moved from components.tsx)
    ├── components.tsx              # v0.9 Tabs and Modal call the parts
    ├── v08.tsx                     # new: V08Host, pump, v0.8 components, stand-in, style placeholder
    ├── v08-theme.ts                # new: the Types.Theme with agui classes
    ├── index.tsx                   # Rendered draws snapshot.order; props carry catalogAliases
    └── a2ui.css                    # v0.8 rules

packages/python/src/agui_inspector/__init__.py     # catalog_aliases argument

examples/reference-agent/
├── a2ui-scenarios.ts               # v08Surfaces, v08Continuation, mixedSurfaces, ids
└── a2ui-showcase.ts                # SHOWCASE.v08, ACTIONS.submitExpense, the story
demo/config.json                    # quick message, declared A2UI versions

packages/inspector/tests/a2ui/      # versions, catalogs, session-v08, actions, gallery-v08, fixture host
packages/inspector/tests/config/    # alias parsing
packages/inspector/tests/hosted/    # startup hands the aliases over
tests/e2e/a2ui/v08.spec.ts          # new: the v0.8 renderer under the page's real style-src
tests/e2e/a2ui/aliases.spec.ts      # new: aliases through the assembled application
tests/e2e/hosted/support.ts         # a scripted route that names a former catalog id
tests/e2e/public-demo/              # extended
tests/demo/a2ui-showcase.test.ts    # extended
packages/python/tests/test_embedding.py
scripts/bundle-budget.mjs           # representative build names both renderers

website/content/docs/               # a2ui, configuration, embedding, demo, status, dependencies, internals
README.md, AGENTS.md                # "A2UI v0.9" becomes "A2UI v0.8 and v0.9"
.changeset/                         # agui-inspector minor, agui-inspector-python minor
```

**Structure Decision**: The existing layout. Classification and the alias table are new core modules next to
`lifecycle.ts` and `actions.ts`. The v0.8 view code sits beside the v0.9 view code, and the two share the parts that
would otherwise be copied (tabs and modal markup, the blocked-media note, the issue list, the action mapping).

## Phases

0. **Research** ([research.md](research.md)): done. The gate (R1) passes.
1. **Design**: [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md): done.
2. **Tasks** (`speckit-tasks`): small tasks in dependency order. The build order below is for the work. The pull request
   ships all of it together, because after slice 2 alone a v0.8 entry would be accepted and not drawn:
   1. Catalog table and config field (`catalogs.ts`, `parseConfig`, startup, Python argument, docs for the field).
      Builds on nothing. The v0.9 alias becomes a row.
   2. Classification and the session (`operations.ts`, `index.ts`), with unit tests and the new refusal wording.
   3. The v0.8 view: provider, pump, theme, components, CSS, parts shared with v0.9, the `catalogAliases` prop. The
      bundle is measured first, right after the import is added.
   4. The reference story and the demo.
   5. Docs, changesets, README and AGENTS lines.

## Complexity Tracking

None. The Constitution Check has no violation.
