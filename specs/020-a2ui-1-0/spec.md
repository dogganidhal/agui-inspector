# Feature Specification: A2UI 1.0 surfaces

**Feature Branch**: `worktree/a2ui-1-0-surfaces-ee0d0a`

**Created**: 2026-11-25

**Status**: Implemented on the branch. The spec and the plan wait for the maintainer's review in the pull request.

**Input**: Agents now send A2UI 1.0 surfaces: an `ACTIVITY_SNAPSHOT` of type `a2ui-surface` whose
`a2ui_operations` hold entries with `"version": "1.0"`, often one `createSurface` that carries the components and the
data model, on the agent's own catalog id. Such an agent sends a surface only to a client that lists the catalog in
`forwardedProps.a2uiRendererCapabilities["1.0"].supportedCatalogIds`. A tap comes back as a run that carries
`forwardedProps.a2uiAction.userAction`. Version 0.3.0 of the inspector refuses every 1.0 entry, so a developer sees the
frames and the refusal but no card, and cannot tap anything. This feature extends feature 008 (A2UI v0.8 and catalog
aliases) to 1.0.

## Clarifications

### Session 2026-11-25

- Q: Which renderer draws 1.0? → A: The official one. `@a2ui/web_core` ships the 1.0 basic catalog from 0.13.0
  (`@a2ui/web_core/catalogs/basic/v1`) and `@a2ui/react` draws 1.0 surfaces from 0.14.0 (`A2uiSurface` from the package
  root). The pins move from 0.12.0 to 0.16.1. No hand-written renderer (FR-001, FR-002).
- Q: Does the upgrade change v0.9? → A: Only where the renderer itself changed. From 0.13.0 the renderer's own v0.9
  components are custom elements from `@a2ui/web_core`, `DateTimeInput` draws a date and time as a date input and a
  time input and writes seconds, and nothing injects a `<style>` any more. The eight components the inspector draws
  itself, the session, the version rules, the catalog table, the aliases and the action envelope stay as they are
  (FR-010).
- Q: How does a 1.0 surface on the agent's own catalog id draw? → A: Through `catalogAliases`, as for v0.9: the id maps
  to the 1.0 basic catalog. The alias also goes into the renderer capabilities (FR-004, FR-007).
- Q: Is the renderer capabilities switch tied to Render A2UI surfaces? → A: No. It is its own profile setting,
  `sendA2uiCapabilities`, on when absent. Rendering off keeps its documented promise that the run input does not change,
  and a developer who reads surfaces as JSON still gets them from the agent (FR-006).
- Q: Which versions go into the capabilities? → A: v0.9 and 1.0, the shape `MessageProcessor.getRendererCapabilities`
  gives. v0.8 has no such declaration (FR-005).

### Session 2026-11-25, after 0.4.0

- Q: A 1.0 button binds a context entry to a path the data model lacks, so it resolves to `undefined`, and the runtime
  refuses the whole tap ("An A2UI action needs a context that is a JSON object"). What should happen? → A: Send the
  action as JSON would write it: an object entry with no value is left out, a list item with no value becomes `null`,
  and `null` stays `null`. The surface shows a warning that names each entry left out. The same holds for v0.9 and
  v0.8 actions (FR-012).

### Session 2026-11-25, capabilities

- Q: Who wins when the preset or the profile already sets `a2uiRendererCapabilities`? → A: Theirs. The inspector's
  object goes first in the merge, so a written property replaces it, with the switch on or off (FR-006).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A 1.0 card draws and can be tapped (Priority: P1)

A developer points the inspector at an agent that answers with a 1.0 card on its own catalog id. They add one alias to
`config.json` (or `catalog_aliases` in `mount_inspector`). The card draws in the activity, they fill it in, press its
button, and the action reaches the agent in the same envelope as a v0.9 tap.

**Why this priority**: Without it the developer cannot test 1.0 cards locally at all.

**Independent Test**: The reference agent's "Book a visit (A2UI 1.0)" story in the demo, and `tests/e2e/a2ui/v10.spec.ts`.

**Acceptance Scenarios**:

1. **Given** an alias from the agent's catalog id to the 1.0 basic catalog, **When** the agent sends a 1.0
   `createSurface` with components and data model, **Then** the card draws with the official 1.0 renderer and the
   received operations are unchanged.
2. **Given** the card, **When** the user edits a field bound with `@path` and presses the button, **Then** a run starts
   with `forwardedProps.a2uiAction.userAction` holding `name`, `surfaceId`, `sourceComponentId`, `context` and
   `timestamp`, the context resolved and copied at the click. In `turn` message mode the run has `messages: []`.
3. **Given** no alias, **When** the same card arrives, **Then** the page shows `Catalog not found: <id>` with the entry
   as received.

### User Story 2 - The agent knows what the inspector draws (Priority: P1)

An agent that checks renderer capabilities sends its card only to a client that declares the catalog. The inspector
declares, in every run, the catalog ids it draws for v0.9 and 1.0, aliases included.

**Independent Test**: Compose a run input with and without aliases and with the switch off; the reference agent answers
the card only when its id is declared.

**Acceptance Scenarios**:

1. **Given** default settings, **When** a run is sent, **Then** `forwardedProps.a2uiRendererCapabilities` lists the
   bundled v0.9 ids under `v0.9` and the 1.0 basic id under `1.0`.
2. **Given** an alias to the 1.0 basic catalog, **When** a run is sent, **Then** the alias follows the basic id under
   `1.0`.
3. **Given** the switch off, **When** a run is sent, **Then** the run input has no `a2uiRendererCapabilities`.

### User Story 3 - An unknown component is flagged, never dropped (Priority: P2)

An agent catalog adds components to the basic catalog. Each one the basic catalog lacks shows as an error in its place
that names its type and component id, with its definition and properties under "As received". The rest draws.

**Independent Test**: The reference card's `StarRating` in the unit and browser tests.

### Edge Cases

- `"version": "v1.0"`, `"1.0.0"` or `"v0.9.1"` is refused with the version error, as any other unknown version.
- A 1.0 and a v0.9 surface share one processor, so they cannot share an id. The second `createSurface` is an error at
  its position. A v0.8 surface can still share an id with either.
- A 1.0 surface that names an alias of the v0.9 catalog is "Catalog not found".
- 1.0 rules the renderer enforces, such as component ids that are Unicode identifiers and `Text` without heading
  variants, are operation errors at their position, as the renderer words them.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An entry of `a2ui_operations` with `"version": "1.0"` MUST be read as A2UI 1.0. Matching is exact. The
  refusal texts MUST name 1.0, v0.9 and v0.8.
- **FR-002**: 1.0 `createSurface`, `updateComponents`, `updateDataModel` and `deleteSurface` MUST be applied by the
  `@a2ui/web_core` processor and drawn by `@a2ui/react`, with the 1.0 basic catalog of `@a2ui/web_core`.
- **FR-003**: The 1.0 basic catalog MUST keep the guards of the v0.9 one: media components load nothing and `openUrl`
  opens nothing.
- **FR-004**: `catalogAliases` (and `catalog_aliases`) MUST accept the 1.0 basic catalog id as a target, and an alias of
  it MUST serve 1.0 surfaces only.
- **FR-005**: Every run MUST carry `forwardedProps.a2uiRendererCapabilities` of the form
  `{ "v0.9": { "supportedCatalogIds": [...] }, "1.0": { "supportedCatalogIds": [...] } }`: each bundled catalog's own id,
  then its built-in alias, then the configured aliases of that version.
- **FR-006**: The client profile MUST have an optional boolean `sendA2uiCapabilities`, true when absent, with a switch
  in Settings. False MUST leave the capabilities out. A forwarded property of the same name from the preset or the
  profile MUST win. Render A2UI surfaces MUST NOT change the run input.
- **FR-007**: Headless sessions MUST accept `catalogAliases`, use them for their surfaces and their capabilities, and
  read 1.0 `@path` bindings.
- **FR-008**: A component type the catalog does not list MUST show, in its place, an error naming the type and the
  component id, with the definition and properties as received. The entry MUST stay in the surface as sent.
- **FR-009**: A 1.0 button's action MUST reach the agent in `forwardedProps.a2uiAction.userAction` with the same five
  fields as v0.9, its context resolved and copied at the click.
- **FR-010**: v0.8 and v0.9 behavior MUST stay as it is, except where the pinned renderer changed it (see the
  clarifications).
- **FR-011**: The reference agent MUST have a 1.0 story with made-up ids that sends its card only to a client that
  declares the agent catalog id, and the demo config MUST alias that id.
- **FR-012**: A tap MUST NOT be refused because a context entry has no value. The envelope's context MUST be what
  `JSON.stringify` writes: such an object entry left out at any depth, such a list item written as `null`, `null`
  kept. The surface MUST show a warning that names the action, its component and each entry left out.

### Key Entities

- **Renderer capabilities**: the object in `forwardedProps.a2uiRendererCapabilities`, by A2UI version.
- **Catalog table**: bundled catalog ids (1.0 basic, v0.9 basic, v0.8 standard), the built-in alias and the configured
  aliases.

## Success Criteria *(mandatory)*

- **SC-001**: The reference 1.0 card draws, its unknown component is flagged and its button sends the envelope, in a
  browser under the page's `style-src 'self'` with no policy violation.
- **SC-002**: Every existing v0.8 and v0.9 unit and end-to-end test passes, with changes only where the renderer's own
  markup changed.
- **SC-003**: The production bundle stays under 2,000,000 bytes minified and 600,000 bytes gzipped.
- **SC-004**: No new dependency, and no request beyond the configured targets.

## Assumptions

- The agent follows the official 1.0 schema: `{ "@path": ... }` bindings and the basic catalog's component names.
- Loading a catalog from its address stays out of scope, as in feature 008.
