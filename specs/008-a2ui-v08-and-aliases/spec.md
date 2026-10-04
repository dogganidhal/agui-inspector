# Feature Specification: A2UI v0.8 surfaces and catalog aliases

**Feature Branch**: `gh-78-a2ui-v08-and-aliases`

**Created**: 2026-10-04

**Status**: Draft for review. 0.2.0 item 6 of 9 ([issue #78](https://github.com/dogganidhal/agui-inspector/issues/78)).

**Input**: Render A2UI v0.8 surfaces and accept catalog aliases in the config. The inspector draws A2UI v0.9
only, so an agent that is still on v0.8 cannot see its surfaces. An agent that names a catalog by a former id gets
"Catalog not found", except for the one middleware default id added in 0.1.0. Detect the A2UI version of each
surface and draw v0.8 surfaces with the v0.8 renderer that `@a2ui/react` 0.12.0 already ships. Add optional
catalog aliases to the config. The received operations stay as sent, and the config format stays at version 0.

## Clarifications

Nobody answered these interactively. They were answered from the issue, the 0.2.0 roadmap, the constitution
and the code, taking the recommended option each time.

### Session 2026-10-04

- Q: Where do catalog aliases live in the config: at the top, inside each agent, or under a new `a2ui` object? → A: At the top, as `catalogAliases`, for every agent. One id maps to one catalog, so agents never need different answers.
- Q: Does the inspector ship built-in aliases for older v0.8 catalog addresses, so an agent of that era works with no config? → A: No. The one built-in alias stays the middleware default id from 0.1.0. The docs show how to add the older ones.
- Q: Should a bad alias stop startup or only warn? → A: Warn, name the entry and ignore it, as for a bad theme value. A config with a bad alias still lists its agents.
- Q: Does a v0.8 surface keep the styles it carries (primary color, font), or does it always follow the inspector's theme? → A: It keeps them, for that surface only. The renderer validates the color as a hex value, and a font is a plain name. Neither can request anything.
- Q: How close to the v0.9 accessibility standard must v0.8 components be? → A: The same standard, for the same controls. A component that the renderer draws without a role, an accessible name or keyboard operation is replaced by the inspector's own drawing. One that meets all three is used as it is.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See a v0.8 surface and use it (Priority: P1)

A developer whose agent still speaks A2UI v0.8 sends an `a2ui-surface` activity. The inspector draws each
surface, the developer fills in a field and presses a button, and the agent receives the action as it would
from any other client.

**Why this priority**: Without it, a v0.8 agent shows raw JSON and nothing else. This is the point of the issue.

**Independent Test**: Run the reference agent's v0.8 story in a browser, check that its surfaces are drawn, type
into a field, press the button, and compare the next run's input with the five action fields. Then compare the
activity's JSON with what the agent sent.

**Acceptance Scenarios**:

1. **Given** rendering is on and an activity carries v0.8 messages (component definitions, data values and a
   message that names the root), **When** the activity arrives, **Then** the surface is drawn with its data
   values, and a surface whose root has not been named yet is not shown and causes no error.
2. **Given** a drawn v0.8 surface with a text field and a button whose action binds the field, **When** the
   developer types and presses the button, **Then** a new run starts. Its input carries the action with name,
   surface id, source component id, context and timestamp. The context holds the bound values as they were at
   the click.
3. **Given** the developer typed into a v0.8 field, **When** more v0.8 messages are appended to the activity,
   **Then** the new messages apply and the typed text stays. A change to an earlier message rebuilds the
   surface and the typed text is lost, as for v0.9.
4. **Given** rendering is off, **When** a v0.8 activity arrives, **Then** the operations show as JSON exactly as
   received, with the note that rendering is off.
5. **Given** a v0.8 surface asks for a picture, a video, a sound or a link in a text, **When** it is drawn,
   **Then** nothing is requested or opened. Media show as notes with the address as text, and link and image
   syntax in text stays as typed.

---

### User Story 2 - Several surfaces and both versions in one activity (Priority: P1)

A developer inspects an activity whose list has several surfaces, some in v0.8 and some in v0.9, and entries
that no version accepts. Each surface is drawn by the renderer for its own version, and a bad entry harms
nothing else.

**Why this priority**: The version is found per surface, as the issue requires. A gateway or an agent in the
middle of a migration sends both.

**Independent Test**: Feed one list with a v0.8 surface, a v0.9 surface, an entry with no recognizable shape and
an entry that declares another version. Check that both surfaces are drawn and two errors name their positions.

**Acceptance Scenarios**:

1. **Given** a list with one v0.8 surface and one v0.9 surface, **When** it is drawn, **Then** both appear, in
   the order the agent first named them, each by the renderer for its version.
2. **Given** an entry that is not an object, has no version and no v0.8 message name, or declares a version other
   than v0.9, **When** the list is applied, **Then** an error names the entry's position and shows it as
   received, and every other entry still applies.
3. **Given** a v0.8 surface and a v0.9 surface share a surface id, **When** the list is drawn, **Then** they are
   two surfaces. A message changes only the surface of its own version.
4. **Given** a message that deletes a surface, **When** it has no version, **Then** it removes the v0.8 surface
   of that id. **When** it declares v0.9, **Then** it removes the v0.9 surface of that id.
5. **Given** a v0.8 message the renderer refuses, such as one that holds two message kinds, **When** the list is
   applied, **Then** an error names its position with the entry as received, and the others still apply.

---

### User Story 3 - Name a catalog by a former id (Priority: P2)

A developer's agent names its catalog with an id that was valid once, such as an older address of the same
catalog. The developer adds the id to the config as an alias of a catalog the inspector knows. The surface is
drawn, and the activity still shows the id the agent sent.

**Why this priority**: It removes the "Catalog not found" dead end for agents the developer cannot change. It
matters less than drawing v0.8 at all.

**Independent Test**: Load a config with one alias for each version. Send surfaces that name the former ids, and
one that names an id that is not listed. Check the first two are drawn and the third shows "Catalog not found"
with the entry as received. Check the JSON view still shows the former ids.

**Acceptance Scenarios**:

1. **Given** the config aliases a former id to the v0.9 basic catalog, **When** a v0.9 surface is created with
   that id, **Then** it is drawn with the bundled basic catalog and the received message is unchanged.
2. **Given** the config aliases a former id to the v0.8 standard catalog, **When** a v0.8 message that starts
   rendering names that id, **Then** the surface is drawn.
3. **Given** a surface names an id that is neither a known catalog nor an alias, **When** the list is applied,
   **Then** the error says "Catalog not found" with the id and shows the entry as received. The surface is not
   drawn, and later messages for it are reported.
4. **Given** no config alias, **When** a v0.9 surface names the middleware's default catalog id, **Then** it is
   drawn with the basic catalog, as in 0.1.0. That id is a built-in alias in the same list the config extends.
5. **Given** a v0.8 message that starts rendering and names no catalog, **When** it is applied, **Then** the
   standard catalog is used, as the protocol says.
6. **Given** a config with a bad alias, **When** the page starts, **Then** it shows a configuration warning that
   names the alias, ignores that entry, keeps the valid ones and starts normally.
7. **Given** a server that mounts the inspector with the embedded helper and passes aliases, **When** the page
   loads its config, **Then** the aliases arrive as given and behave as in a hand-written config.

---

### User Story 4 - Try the v0.8 scenario and read how it works (Priority: P3)

A developer or a maintainer runs the reference agent's v0.8 scenario, in the tests or in the public demo, and
finds v0.8 support and aliases described in the A2UI page.

**Why this priority**: The tests and the docs prove and explain the first three stories. They deliver no new
behavior of their own.

**Independent Test**: Choose the v0.8 story of the reference agent's A2UI agent, act on each surface and see the
updated surface after the round trip. Read the A2UI and configuration pages for the version rules and the alias
field.

**Acceptance Scenarios**:

1. **Given** the reference agent's A2UI agent, **When** the developer sends the quick message of the v0.8
   story, **Then** it answers with v0.8 surfaces. Acting on a surface starts a run whose answer changes
   a surface, and a second action removes one, so both actions complete a round trip.
2. **Given** the docs, **When** a developer reads the A2UI page, **Then** it says how the version of a surface
   is found, what a v0.8 surface can do, how catalog ids resolve and how to add an alias. The configuration
   page lists the new field.

### Edge Cases

- A v0.8 message holds a `version` field. The v0.8 protocol has none, so the entry is an error for an unsupported
  version, as for any version other than v0.9.
- A message holds a v0.8 key and a v0.9 key, or two v0.8 keys. It is an error with the entry as received.
- A v0.8 surface receives components and data but never a message that names its root. It is never shown, and
  no error is raised. If nothing else is drawn, the view says no surface has been created yet.
- A v0.8 message names a component type the standard catalog does not have. An error shows in the place of that
  component, names the type and keeps the definition as received. The rest still draws.
- An alias whose key is a catalog id the inspector already knows, or whose value is another alias or an unknown
  id, is a configuration warning and is ignored. An alias never chains.
- An alias whose target is a catalog of the other version applies only to surfaces of that version. A surface of
  the first version that names it gets "Catalog not found".
- The id differs from a known one only by a trailing slash, a scheme or a case. It is not an alias and gets
  "Catalog not found". Matching is exact.
- The config has no aliases, or an empty list of them. The page behaves as in 0.1.0, with the one built-in alias.
- A v0.8 list is very large or rebuilt by many deltas. Typed text keeps while the list only grows, as in v0.9.

## Requirements *(mandatory)*

### Functional Requirements

#### Versions

- **FR-001**: The inspector MUST find the A2UI version of each entry of `a2ui_operations` from the entry itself.
  An object that declares `"version": "v0.9"` is v0.9. An object that declares no version and holds at least one
  of `beginRendering`, `surfaceUpdate`, `dataModelUpdate` or `deleteSurface` is v0.8, and the v0.8 check refuses it
  if it holds more than one kind or any other key. Any other entry is an error that names its position and shows
  the entry as received, and it MUST NOT stop the other entries.
- **FR-002**: Each surface MUST be drawn by the renderer of the version of the messages that build it. One list
  MAY hold surfaces of both versions. A surface id is scoped to its version: a v0.8 surface and a v0.9 surface
  with the same id are two surfaces, and a message changes only the surface of its own version. Surfaces appear
  in the order the agent first named them.
- **FR-003**: A v0.8 surface MUST be shown only after a message has named its root component. Before that its
  components and data are kept and nothing is shown for it, and that is not an error.
- **FR-004**: The received operations MUST stay exactly as sent for both versions. The renderer is given copies,
  so typing into a field or acting on a surface changes none of the JSON view, the recorded frames, the exported
  session and the projection.
- **FR-005**: An unchanged list MUST do nothing. A list that only grew at the end MUST apply the new entries
  and keep what the developer typed. Any other change MUST rebuild the surfaces. This holds for both versions.
- **FR-006**: With rendering off, an activity of either version MUST show its operations as JSON, as received.
  The existing generation lifecycle (building, retrying, failed) MUST behave as before for an activity that has
  no operations.

#### Drawing and actions

- **FR-007**: An action on a v0.8 surface MUST start a normal run with the same action envelope as v0.9: name,
  surface id, source component id, context and timestamp. The context MUST hold the values bound at the click,
  copied, and the action MUST NOT be sent as a tool reply.
- **FR-008**: The v0.8 standard catalog's 18 components (Text, Image, Icon, Video, AudioPlayer, Row, Column,
  List, Card, Tabs, Divider, Modal, Button, CheckBox, TextField, DateTimeInput, MultipleChoice, Slider) MUST be
  drawn from the inspector's theme tokens in light and dark mode. Each MUST have a role and an accessible name
  from its label and MUST work with the keyboard, to the standard FR-020 of the MVP sets for v0.9. A component
  that the renderer draws without one of the three MUST be replaced by the inspector's own drawing, and one that
  has all three MUST be used as it is. A component type that is not in the catalog MUST show as an error in
  place that names the type and keeps the entry as received. The primary color and font that a v0.8 message
  carries MUST apply to that surface alone.
- **FR-009**: A v0.8 surface MUST NOT make the page request, open or load anything. Image, Video and AudioPlayer
  MUST become notes that show the address as text. Link and image syntax in text MUST stay as typed. No font or
  style MUST be loaded from an address. The page's security policy MUST NOT be loosened.
- **FR-010**: Typed values, selections and open dialogs on a v0.8 surface MUST update only the surface's own
  data. Nothing a surface does may reach outside the page (the guards of FR-037 of the MVP apply to v0.8).

#### Catalogs and aliases

- **FR-011**: The inspector MUST know two catalogs: the v0.9 basic catalog and the v0.8 standard catalog. It MUST
  never fetch a catalog or load one from an address.
- **FR-012**: A v0.8 message that starts rendering MUST be checked against the known catalogs and aliases by its
  catalog id. With no id, the v0.8 standard catalog applies. An id that is neither known nor aliased MUST show
  "Catalog not found" with the id and the entry as received, and the surface MUST NOT be drawn. The same holds
  for a v0.9 message that creates a surface.
- **FR-013**: The config MAY hold `catalogAliases` at its top level, an object from a former catalog id to the
  id of a known catalog. It applies to every agent. The field is optional and the format version stays 0. A
  config without it MUST behave as in 0.1.0.
- **FR-014**: An alias MUST apply to the surfaces of the version its target belongs to. Matching MUST be exact,
  with no normalization. An alias MUST NOT chain, and it MUST NOT replace a known catalog id or a built-in alias.
- **FR-015**: The middleware's default catalog id from 0.1.0 MUST stay a working id with no config. It MUST be
  one built-in entry of the same alias list, not a separate rule, and it MUST be the only built-in alias.
- **FR-016**: A bad alias entry (not an object, a value that is not a string or not a known catalog, a key that
  is empty or already known) MUST cause a configuration warning that names the entry and MUST be ignored. It
  MUST NOT stop startup and MUST NOT discard the valid aliases.
- **FR-017**: An alias MUST change only which bundled catalog a surface uses. It MUST NOT rewrite a received
  message, so the activity JSON, the frames and the recording show the id the agent sent.
- **FR-018**: The embedded helper MUST accept the aliases as an optional argument and write them into the config
  it serves as given. The page validates them as for a hand-written config.

#### Reference agent, docs and constraints

- **FR-019**: The reference agent's A2UI agent MUST answer one more quick message with a scripted v0.8 story. It
  MUST draw more than one v0.8 surface and offer two actions, and each action MUST round trip: the run's answer
  changes a surface for one action and removes a surface for the other. The story is model-free and uses no
  address that resolves. The demo shares the reference agent, so the story is there too.
- **FR-020**: The A2UI page MUST document v0.8 support: how the version is found, what a surface can do, the
  guards, the catalog ids and aliases, and the entries the inspector refuses. The configuration page MUST list
  `catalogAliases`. Pages that say the inspector draws only v0.9 MUST be corrected, and the page for embedded
  hosts MUST list the new argument.
- **FR-021**: The feature MUST use `@a2ui/react` and `@a2ui/web_core` for v0.8, as the constitution requires,
  with no new runtime dependency and no dynamic code evaluation. The production bundle MUST stay inside the
  2,000,000 byte minified and 600,000 byte gzip limits.
- **FR-022**: Every existing v0.9 behavior MUST stay as it is, except that v0.8 is no longer refused and the two
  refusal texts change (FR-001): v0.9 drawing, its catalog rules, actions, guards, lifecycle and tests do not
  change. This feature replaces the clauses of the MVP that limit drawing to v0.9 and defer general aliases.

### Key Entities

- **Operation**: One entry of an activity's `a2ui_operations`, kept as received. It is v0.8, v0.9 or neither.
- **Surface**: One rendering area named by a surface id. It has a version (the version of the messages that build
  it), components, data and a catalog.
- **Known catalog**: A catalog the inspector bundles and can draw with: the v0.9 basic catalog or the v0.8
  standard catalog.
- **Catalog alias**: An id that stands for a known catalog. Built-in ones ship with the inspector. The config adds
  more. An alias never changes a message.
- **Alias list**: The built-in aliases plus the config's aliases, checked exactly and without chains.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the v0.8 reference story, 100% of surfaces are drawn and 100% of actions start a run whose input
  holds the five action fields with the values bound at the click. An end-to-end test checks both.
- **SC-002**: After typing into fields and acting on surfaces, the activity JSON and the recorded frames of the runs
  that were already captured are byte for byte what the agent sent, for v0.8 and for v0.9. Acting adds only the new
  run.
- **SC-003**: A list that mixes both versions with two bad entries draws every valid surface and reports exactly
  two errors with their positions, in one pass.
- **SC-004**: Every valid config alias resolves. An id that is not known, not aliased or only near a known one
  shows "Catalog not found" with the entry as received, in 100% of the cases a test lists for both versions.
- **SC-005**: A page that draws v0.8 surfaces with media, links and font requests sends zero requests to any
  address that is not a configured target, and the browser reports no policy violation.
- **SC-006**: `npm run check:ci` passes: all existing tests and the bundle limits, with the new tests added.
- **SC-007**: A developer finds how to alias a catalog id and what v0.8 supports on the A2UI and configuration
  pages, with no need to read the code.

## Assumptions

- The v0.8 renderer and processor in `@a2ui/react` 0.12.0 and `@a2ui/web_core` 0.12.0 are used as shipped. A
  check of both packages found a v0.8 message processor, a React renderer with a provider, a component registry
  and the 18 standard components. The processor does not check a message's catalog id, so the inspector checks it.
- The v0.8 standard catalog id is `https://a2ui.org/specification/v0_8/standard_catalog_definition.json`, the
  default the protocol names. The v0.9 basic catalog id and the middleware's default id are the ones of the MVP.
  Older addresses of the v0.8 catalog are not built in. A developer adds the ones their agent uses.
- Aliases live once at the top of the config and apply to every agent. Ids map to the same few catalogs, so two
  agents never need different answers for one id. Per-agent aliases are not part of this feature.
- Styles that a v0.8 message carries (primary color, font) are plain values: the renderer's schema limits the
  color to a hex value, and a font is a name. Applying them starts no request.
- The embedded helper is the primary integration, and its config is built from its arguments. Without an argument
  there, embedded users could not use aliases, so it is in scope. It is one optional argument.
- Out of scope: A2UI v1.0, catalogs from an address, custom catalogs, aliases per agent, chains of aliases, any
  rewrite of a received message, other A2UI transports, and a built-in list of older v0.8 ids.
- Out of scope for the files: `ROADMAP.md` (the maintainer updates it when release scope changes) and the specs
  of other features.
