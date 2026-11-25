# Implementation Plan: A2UI 1.0 surfaces

**Branch**: `worktree/a2ui-1-0-surfaces-ee0d0a` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

## Summary

Move `@a2ui/react` and `@a2ui/web_core` from 0.12.0 to 0.16.1, the current release, which ships the 1.0 basic catalog
and draws 1.0 surfaces. One processor from the `@a2ui/web_core` root applies v0.9 and 1.0 entries; v0.8 keeps its own
renderer. The catalog table gains the 1.0 basic id, so aliases and the capabilities follow from it. The profile gains
`sendA2uiCapabilities`, and `composeRunInput` adds the capabilities object under the preset and profile properties.
The unknown-component stand-in becomes a small custom element, because the renderer now draws every catalog entry as
one. The reference agent gets a 1.0 card that checks the capabilities.

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Python 3.10+ for the docstring only.

**Primary Dependencies**: `@a2ui/react` 0.16.1 and `@a2ui/web_core` 0.16.1 (bumped). No new direct dependency. The
transitive set is the same packages; `@a2ui/markdown-it` 0.2.4 asks for a fixed DOMPurify, so the root override goes.

**Testing**: `node --test` through `npm run test:unit`; Playwright for `tests/e2e/a2ui`; Python `unittest` for the
distribution test that checked the DOMPurify override.

**Constraints**: the bundle budget; the page's `style-src 'self'`; no request beyond the targets; received operations
never altered.

## Design

| Area | Change |
| --- | --- |
| `core/a2ui/catalogs.ts` | `A2uiVersion` adds `'1.0'`; `BASIC_V10`; `KNOWN_CATALOGS` gains it. |
| `core/a2ui/operations.ts` | `"1.0"` is a version, with the same four message names as v0.9; refusal texts name 1.0. |
| `core/a2ui/index.ts` | Processor from `@a2ui/web_core`; `AliasIds` per version; `surfaceVersion(surface)`. |
| `core/a2ui/actions.ts` | `deniedOpenUrl(report, api)` takes the catalog's own `openUrl` API, so 1.0 keeps its schema. |
| `core/profiles/index.ts` | `sendA2uiCapabilities`; `rendererCapabilities(aliases)`; `composeRunInput` takes `catalogAliases`. |
| `core/runtime`, `app/startup.ts` | `RuntimeSettings.catalogAliases`, set from the loaded config. |
| `views/a2ui/catalog.tsx` | v0.9 catalog from `@a2ui/web_core/v0_9/basic_catalog`; 1.0 catalog from `@a2ui/web_core/catalogs/basic/v1`, guarded; aliases per version. |
| `views/a2ui/components.tsx` | `unknownComponent` returns a `WebComponentImplementation` whose element (`agui-a2ui-unknown`) draws `UnknownView` in its own React root. |
| `views/a2ui/index.tsx` | `A2uiSurface` from the package root; `data-version` per surface. |
| `views/settings` | A switch for `sendA2uiCapabilities`. |
| `headless` | 1.0 catalogs, `@path` reads, `catalogAliases` option. |
| `examples/reference-agent` | `v10Card`, `v10Continuation`, `declares10`; routed by the quick message and the `visit` surface. |

## Research notes

- `@a2ui/web_core` 0.12.0 already parses 1.0 messages but has no 1.0 catalog id or implementations. 0.13.0 adds
  `catalogs/basic/v1` and moves the v0.9 basic catalog to custom elements. `@a2ui/react` 0.14.0 draws a 1.0 surface.
- `@a2ui/react` converts the React components a catalog lists into custom elements once per catalog. A stand-in that a
  `Map.get` override returns for an unlisted type is never converted, so it must be a custom element itself.
- The processor keeps a component of an unknown type when the stand-in's schema passes any properties, so the entry
  stays as sent.
- `ComponentContext.dataContext.resolveAction` resolves `{ "@path" }` on a 1.0 surface, and an object path gives the
  data model's own object, so `toA2uiAction` keeps copying the context.
- 1.0 `Text` has only `body` and `caption` variants, and component ids must be UAX #31 identifiers.

## Constitution Check

- I. The wire comes first: operations are copied before they reach the processor and never rewritten; an unknown
  component is kept and flagged. Pass.
- II. The protocol, not a framework: the official `@a2ui/react` and `@a2ui/web_core` draw every version. Pass.
- III. Generic core: the capabilities follow the A2UI renderer capabilities schema and the configured aliases; no
  agent-specific branch. Pass.
- IV. Local-only: the capabilities ride in the run input to the configured target; no new request, no catalog fetch.
  Pass.
- V. Small and auditable: two pins move, no new dependency, the DOMPurify override is removed because the pinned range
  is fixed. Pass.
- VI. Every event type has a view: no event type changes. Pass.

## Risks

- The renderer's own v0.9 components now look as `@a2ui/web_core` draws them. Screenshots and the documented behavior
  were checked; the tests that changed are listed in tasks.md.
- Profiles exported with `sendA2uiCapabilities` do not load in 0.3.0 or earlier. Documented in the configuration page.
