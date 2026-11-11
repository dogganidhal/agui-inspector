# Feature Specification: Remembered setup and launch links

**Feature Branch**: `worktree/remembered-setup-and-launch-links-fcf81b`

**Created**: 2026-11-11

**Status**: Draft, waiting for the maintainer's review.

**Input**: The maintainer's request. Two things, in one feature because they share the start of the page and need one
precedence rule:

1. The setup survives a reload. Today the client profile and the light or dark choice are kept in browser storage.
   The selected agent, a typed endpoint and the values of preset variables (such as `user_id`) are not, so every reload
   starts from the first agent and the preset defaults.
2. A launch link. A coding agent builds a URL that opens the inspector with everything filled in: the agent or endpoint,
   preset variables, context, forwarded properties and the message. The developer checks it and presses send.

Spec 018 (an MCP server for agents) is expected to build these links, so the link format is documented and stable.

## Clarifications

### Session 2026-11-11

The spec author answered each question from the request, the constitution and the code, and took the recommended
option. The maintainer confirms or changes these answers when reviewing the spec.

- Q: A link sets values the developer had saved. Does the link also replace what is saved? → A: Yes. Opening a link is
  the same as making those choices by hand: they apply and they are saved. The link is then removed from the address
  bar, so a reload shows the saved setup and does not apply the link again. The other option, applying the link for this
  page only, breaks on the first edit: the page saves the whole profile on any change, so the link's context would be
  saved anyway, half the time. A notice on the page lists what the link set (FR-016).
- Q: Can a link send the message by itself? → A: No, never. The link only fills the composer. In embedded mode a run is
  sent with the host's cookies and runs the preset's preparation requests. A link that sends by itself would let any
  web page that links to the inspector start an authenticated run on the host with a message it chose. Pressing send is
  the developer's consent (FR-013).
- Q: Fragment or query string? → A: The fragment, the part after `#`. The browser never sends it to the server, so the
  message and the context stay out of server logs, proxies and the command's listener. It also survives the redirect a
  helper makes from `/inspector` to `/inspector/` (FR-008).
- Q: Is the thread id kept across a reload, or set by a link? → A: Neither. The conversation, its messages and its state
  live in memory and are lost on reload. A thread id without them would send a turn that the transcript on screen does
  not show, and a `full` message mode would send a history that is not the thread's. Thread continuation stays out of
  scope (see Assumptions).
- Q: Is the composer draft kept across a reload? → A: No. A draft is not setup, and a typed message may hold data the
  developer would not leave in storage. Only a link fills the composer.
- Q: Which profile settings can a link set? → A: Context and forwarded properties, as the request names. Tools, message
  mode, encoding and the automation settings stay in Settings and in an imported profile file. A key for them is an
  unknown key (FR-010).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The setup survives a reload (Priority: P1)

A developer picks the `support` agent, sets `user_id` to `42`, and works for a while. They reload the page, or the dev
server restarts and the page reloads. The inspector comes back with the `support` agent and `user_id` set to `42`, so
the next message goes to the same place with the same values.

**Why this priority**: It is the most common annoyance today, every reload starts over, and the link in story 2 builds
on the same saved setup.

**Independent Test**: Select an agent other than the first, change a variable, reload, and check the agent picker and
the variable field.

**Acceptance Scenarios**:

1. **Given** two configured agents and the second one selected with `user_id` changed to `42`, **When** the page
   reloads, **Then** the second agent is selected and `user_id` is `42`.
2. **Given** an endpoint typed in the endpoint field and applied, **When** the page reloads, **Then** the same endpoint
   is the target and no agent is selected.
3. **Given** a saved agent that the configuration no longer lists, **When** the page loads, **Then** the first
   configured agent is selected and a warning says the saved agent is no longer configured.
4. **Given** a token entered in the authentication field, **When** the page reloads, **Then** the token and its header
   name are gone, as today, and browser storage holds neither.
5. **Given** browser storage that the browser blocks, **When** the developer changes the agent, **Then** the page works
   as before and simply does not remember the choice.

---

### User Story 2 - Open the inspector from a link with everything filled in (Priority: P1)

A coding agent helps a developer debug an AG-UI server. It builds a link with the agent id, `user_id`, a context entry,
a forwarded property and the message "Book a table for two". The developer opens the link. The inspector starts with
that agent selected, the values in place and the message in the composer. A notice lists what the link set. The
developer reads it and presses send.

**Why this priority**: It is the second half of the request and the reason spec 018 builds links.

**Independent Test**: Open the reference agent's page with a link that sets each supported value, and check the agent
picker, the variable, Settings, the composer and the notice. Nothing is sent until send is pressed.

**Acceptance Scenarios**:

1. **Given** a link that names a configured agent, a variable, context, forwarded properties and a message, **When** the
   page opens, **Then** each value is in place, the message is in the composer, and no run has been sent.
2. **Given** that page, **When** the developer presses send, **Then** the run input carries the link's context and
   forwarded properties, and the preset's templates use the link's variable value.
3. **Given** a link that names an endpoint instead of an agent, **When** the page opens, **Then** that endpoint is the
   target, exactly as if it had been typed and applied.
4. **Given** a saved setup and a link that sets only the message, **When** the page opens, **Then** the saved agent,
   variables and profile apply and the message is in the composer.
5. **Given** a page opened from a link, **When** it has started, **Then** the address bar no longer shows the link's
   values, and a reload shows the saved setup with an empty composer.
6. **Given** a tab that already shows the inspector, **When** the developer pastes a new link into its address bar,
   **Then** the link applies as if it had been opened in a new tab.

---

### User Story 3 - A bad or hostile link never breaks the page or leaks a secret (Priority: P1)

A link may be wrong (an agent that does not exist, JSON that does not parse) or written by someone else. Each bad value
is skipped with a warning and the rest of the link applies. A link cannot reach a destination the page could not reach
anyway, cannot carry a credential, and cannot send anything by itself.

**Why this priority**: The constitution requires it, and a link is input from outside the page.

**Independent Test**: Open the page with links that each hold one bad value, and with a link that names a destination
outside the page's policy. Check the warnings, what still applies, and the requests the page made.

**Acceptance Scenarios**:

1. **Given** a link with an unknown agent id and a valid message, **When** the page opens, **Then** a warning names the
   `agent` key, the saved or first agent stays selected, and the message is in the composer.
2. **Given** a link whose `context` is not valid JSON, **When** the page opens, **Then** a warning names `context`, the
   saved context stays, and every other key applies.
3. **Given** a link with a key named `token`, `authorization` or `header`, **When** the page opens, **Then** the key is
   refused with a warning that says credentials never go in a link, the value is not shown anywhere, and it reaches no
   storage, recording or request.
4. **Given** an embedded page and a link whose endpoint is another origin, **When** the page opens, **Then** the
   endpoint is refused with the same reason a typed endpoint would get, and no request goes to that origin.
5. **Given** any link, **When** the page has started, **Then** no request was made because of the link: no run, no
   preparation request, no capabilities request beyond what selecting the same agent by hand makes.
6. **Given** a link longer than the size limit, **When** the page opens, **Then** the whole link is ignored with one
   warning and the page starts with the saved setup.

---

### User Story 4 - A coding agent can build a link from the documentation (Priority: P2)

An agent author, or spec 018, reads one docs page and builds correct links for any serving mode: the hosted page, an
embedded helper, the command and the public demo.

**Why this priority**: The format has to be stable and written down, or every link builder guesses.

**Independent Test**: Build a link from the docs page alone for the reference agent and open it.

**Acceptance Scenarios**:

1. **Given** the docs page, **When** a reader follows its example, **Then** the link opens the reference agent with the
   example's values.
2. **Given** a link with `v=0` or no version, **When** the page opens, **Then** it is read as version 0. **Given** any
   other version, **Then** the whole link is ignored with one warning.

### Edge Cases

- A link and a saved setup name different agents: the link's agent is selected, and saved variable values, which
  belong to the saved agent, are dropped. Variables the link does not set take the preset defaults.
- A link sets a variable that the selected agent's preset does not declare, or sets one with a typed endpoint (which has
  no preset): a warning names the variable and the value is dropped.
- A link sets a JSON variable to text that does not parse: a warning names the variable and its saved or default value
  stays. A text variable takes the link's text as written.
- A link names both `agent` and `endpoint`: both are refused with one warning, since they contradict each other, and
  the saved or first agent stays.
- A link repeats a key: the whole key is refused with a warning. A link builder must not rely on first or last wins.
- A link sets `forwardedProps` with the reserved `a2uiAction` key, or `context` entries that fail the protocol's schema:
  the same message that Settings or a profile import gives, as a warning, and the saved value stays.
- The saved setup's endpoint is refused by the current policy (the deployment changed its allowed origins): the first
  agent is selected and a warning says why.
- The saved setup's variables include a name the preset no longer declares, or a value of the wrong kind: that value is
  dropped with a warning, and the others apply.
- An imported recording is open: nothing here changes. A link opened in that tab starts the page again, which closes
  the recording, as a reload does today.
- The fragment holds something that is not a launch link, such as a leftover anchor (`#top`): it is a link with an
  unknown key and gives a warning. The page has no anchors of its own.
- Storage holds a saved setup written by a newer, incompatible version: it is not used, and a warning says so, as a bad
  saved profile does today.
- Opening a link restarts the page, so a token typed in that tab is cleared and the conversation on screen is lost, as
  with a reload.
- A link written on one page is opened on another that has different agents: the agent id or the variables do not
  match, and the warnings say so. Nothing else is affected.

## Requirements *(mandatory)*

### Functional Requirements

Remembered setup

- **FR-001**: The page MUST remember the developer's selection: either the selected configured agent, by id, or the
  endpoint the developer applied, as typed. Selecting an agent or applying an endpoint MUST update what is remembered.
- **FR-002**: The page MUST remember the values of the selected agent's preset variables as the developer edits them.
  Values belong to the remembered selection: changing the selection starts from the new agent's defaults, as today.
- **FR-003**: On start, the page MUST restore the remembered selection and variable values, after the configuration is
  read and before the first render. A remembered value that no longer fits the configuration or the request policy
  MUST be dropped with one warning that names it, and the rest MUST apply. Without a usable selection, the first
  configured agent MUST be selected, as today.
- **FR-004**: The remembered setup MUST be kept in the same browser storage as the profile and the theme choice, under
  its own key, in a versioned envelope at version 0. Blocked or full storage MUST NOT stop the page or show an error: the
  setup is simply not remembered. A remembered setup that cannot be read MUST be ignored with one warning.
- **FR-005**: The remembered setup MUST NOT hold a token, a header name, a header value, a recording, a thread id, the
  conversation or the composer draft. The client profile and the theme choice keep their existing keys and formats.

Launch link

- **FR-006**: The page MUST read a launch link once when it starts, in every serving mode that loads the page: the
  hosted page, the Starlette and FastAPI helper, the Express, Hono and Next.js helpers, the command and the public demo.
- **FR-007**: A launch link MUST be able to set: the agent by id, or an endpoint; the value of each preset variable; the
  profile's context; the profile's forwarded properties; and the composer's message. Each key is optional.
- **FR-008**: The link MUST be carried in the URL fragment as `name=value` pairs joined by `&`, with each name and value
  percent-encoded, which is the form browsers and URL libraries write by default. The page MUST read the fragment and
  nothing else, and MUST NOT read the query string for launch values.
- **FR-009**: The keys MUST be exactly: `v` (format version, `0`, optional), `agent`, `endpoint`, `var.<name>` (one per
  variable), `context` (a JSON list of context entries), `forwardedProps` (a JSON object) and `message` (text). Text
  values are taken as written. JSON values MUST pass the same checks Settings and profile import apply.
- **FR-010**: Each bad key or value MUST be refused on its own with one warning in the place configuration warnings use,
  marked as coming from the link. Startup MUST continue and every other valid key MUST apply. A warning MUST name the key
  and MUST NOT repeat the value. Unknown keys, repeated keys, and `agent` together with `endpoint` are bad keys.
- **FR-011**: An `endpoint` from a link MUST be checked by the same rule as an endpoint typed in the endpoint field, and
  MUST be refused with the same reason. A link MUST NOT widen what the page may reach, change the request policy, name
  the configuration file, or load a plugin or any other code.
- **FR-012**: A key that names a credential (`token`, `auth`, `authorization`, `header`, `headers`, or any key starting
  with `header.`) MUST be refused with a warning that says credentials never go in a link and where to enter a token.
  Its value MUST NOT reach storage, a recording, a view, a log, an export or a request. An endpoint with a user name or
  password MUST be refused as a typed one is.
- **FR-013**: A link MUST NOT send anything by itself: no run, no preparation request, no raw request. The message fills
  the composer, and the developer sends it. The page MUST make no request because of a link beyond what the same
  selection made by hand makes (reading the selected agent's capabilities URL).
- **FR-014**: Values from a link MUST take precedence over the remembered setup and the saved profile, and those over
  the configuration's defaults. Values the link does not set MUST come from the remembered setup, then the defaults.
  When the link selects a different agent from the remembered one, the remembered variable values MUST be dropped.
- **FR-015**: Values a link applies MUST be saved as if the developer had made them by hand: the selection and variables
  in the remembered setup, the context and forwarded properties in the saved profile. The message MUST NOT be saved.
- **FR-016**: After reading a link, the page MUST remove it from the address bar without adding a history entry, and
  MUST show a notice that lists which keys the link set (by name, not value) and asks the developer to check them
  before sending. The notice MUST stay until the page reloads, like a configuration warning.
- **FR-017**: When the fragment changes while the page is open (a new link pasted in the same tab), the page MUST start
  again so the link applies exactly as on a fresh open.
- **FR-018**: A fragment longer than 65,536 characters MUST be ignored as a whole with one warning.
- **FR-019**: A link MUST NOT be able to run code. Every value is text or JSON data, shown as text, and never evaluated.

Documentation and quality

- **FR-020**: A docs page under `website/content/docs` MUST describe the remembered setup (what is kept, what never is,
  how to clear it) and the link format: every key, its value, the precedence rule, the warnings, the security limits,
  and one example per serving mode. The format is version 0 and MUST only change in a way a version-0 link still opens.
- **FR-021**: Each behavior above MUST have a regression test. End-to-end tests MUST use the reference agent and check
  that a link sends nothing by itself and that no request leaves the policy. Tests MUST search storage, recordings,
  exports and the page's text for a synthetic credential placed in a link and find none.

### Key Entities

- **Remembered setup**: The developer's selection (an agent id or an endpoint) and the selected agent's variable values,
  kept in browser storage under one key with a format version. It never holds credentials or conversation data.
- **Launch link**: A URL to the inspector page whose fragment carries launch values. It is input from outside the
  page: every value is checked, and none of it can widen the policy or send a request.
- **Launch values**: The keys of a launch link: `v`, `agent`, `endpoint`, `var.<name>`, `context`, `forwardedProps`,
  `message`.
- **Link notice**: A message under the top bar, in the place of configuration warnings, that names the keys a link set
  and asks the developer to check them before sending.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a reload, the selected agent or endpoint and every edited variable value are the same as before the
  reload, in 100% of the end-to-end runs, and the developer makes zero clicks to restore them.
- **SC-002**: From opening a launch link to a sent run takes one action: pressing send.
- **SC-003**: A link with every supported key, opened on the reference agent, shows each value in place. The run sent
  next carries each of them.
- **SC-004**: For each bad value listed in the edge cases and in FR-010 to FR-012, the page starts, shows exactly one
  warning for that key, and applies every other key.
- **SC-005**: Opening any link, valid or not, causes zero runs, zero preparation requests and zero requests outside the
  page's policy until the developer presses send.
- **SC-006**: A unique synthetic credential placed in a link appears in zero places the inspector writes: browser
  storage, the recording, the exported session, the exported profile and the page's text.
- **SC-007**: Without a link and without anything saved, the page looks and requests exactly as before this feature.
- **SC-008**: An agent author builds a working link for each serving mode from the docs page alone.
- **SC-009**: The production bundle stays within the existing size budgets.

## Assumptions

- "Preset" in the request means the configured agent, since a preset belongs to an agent. Selecting a preset is selecting
  an agent.
- One remembered setup per browser origin, like the saved profile. Two inspector pages on one origin with different
  configurations share it, and the warnings in FR-003 cover a mismatch.
- The endpoint is stored and recorded as typed, as the recorder already records its path and query. The docs say a
  secret belongs in the authentication field, never in an endpoint URL.
- A button to forget the remembered setup is out of scope. Clearing the site's data in the browser does it, and the docs
  say so.
- Continuing a thread across a reload, or opening one from a link, is out of scope (see Clarifications). It could come
  with a later feature that also restores the conversation.
- Links set no tools, message mode, encoding or automation settings. A later version may add keys; a version-0 link keeps
  working.
- Pane, tab, filter and other view choices are not remembered.
- Spec 017 (a clear button) and spec 018 (MCP for agents) are separate features. Spec 018 builds links in the format this
  spec defines and adds nothing to it.
