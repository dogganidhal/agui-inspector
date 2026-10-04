# Feature Specification: Plugin API

**Feature Branch**: `gh-81-plugin-api`

**Created**: 2026-10-04

**Status**: Accepted by the maintainer on 2026-10-04. Implementation follows.

**Input**: Issue [#81](https://github.com/dogganidhal/agui-inspector/issues/81), "Add a plugin API for run hooks,
header providers and custom renderers", item 9 of 9 of the 0.2.0 roadmap. Presets declare values, setup requests and
quick messages. Some servers need code: a header that changes for each request, an input that has to be adjusted before
each run, or a view for a custom event or activity type. A deployment names plugin modules from its own origin in
`config.json`. A plugin has three extension points: a hook before each run that can adjust its input, header
providers, and renderers for custom events and activity types. The inspector keeps its rules: scripts come from the
page's own origin, the recorder reads no header, hooks never change recorded frames, and a plugin that fails shows a
warning and never stops the page. The API carries a version number.

## Clarifications

No maintainer was available, so the spec author answered each question from the issue, the 0.2.0 roadmap, the
constitution and the code, and took the recommended option.

### Session 2026-10-04

- Q: The issue names "hooks before a run and on its input". Are those two functions or one? → A: One, `beforeRun`.
  The input exists before the run is sent, so a hook that runs first and may replace the input covers both. A guard is
  a hook that throws, and a hook with side effects is the same function. A second function would have no case of its
  own. It is easy to add later, because adding a function does not break a plugin (FR-006, FR-007).
- Q: When a run hook or a header provider fails, does the inspector send the request without it, or stop that request?
  → A: It stops that one request. A hook may redact or guard, and a provider may sign. Sending the request anyway could
  send what the plugin was there to remove, or an unsigned request that the server answers in a confusing way. This is
  how a failed preparation already behaves: the run is not sent and the message says why. A renderer is different: it
  only changes a view, so the JSON view takes its place (FR-009, FR-012, FR-017).
- Q: A provider and the token typed in the page return the same header name. Which one does the target receive? → A: The
  typed one. A developer who types a wrong token wants to see the server's answer to it, and feature 005 decided the same
  way for `--header`. The plugin supplies the default (FR-012).
- Q: Does a renderer return React elements or draw into a container element? → A: It draws into a container element
  that the inspector provides. Returning React elements would make the plugin API depend on the React version in the
  bundle, and a plugin would need its own copy of React or a handle to ours. A container works for any library and keeps
  the API stable across React upgrades. The text-only default and the JSON view stay available (FR-014).
- Q: Which file declares plugins: `config.json` or `hosting-config.json`? → A: `config.json`. The helpers write only
  `config.json`, and branding already lives there. `hosting-config.json` is the request policy, and a plugin widens
  nothing in it: the address must be on the page's own origin and the content security policy is unchanged. Whoever
  writes `config.json` can only choose among files the page's own origin serves. The deployer already controls those
  (FR-002, FR-020).

### Session 2026-10-04, after approval

The maintainer accepted the spec and the plan, and answered the open question. Features 005 (the command), 008 (A2UI
v0.8) and 013 (protobuf streams) have merged since the draft.

- Q: Does the command of feature 005 get `--plugin` in 0.2.0? → A: Yes. A per-request signature is the case for a
  server that cannot change. `--plugin` is a sixth option of the command. Spec 005 carries a dated note with the new
  option list, pointing here (FR-021).
- Q: Feature 013 lets a profile or a preset ask for protobuf, and the transport turns the encoding into the `Accept`
  header. Can a provider change `Accept`? → A: No. The transport owns `Accept` and `Content-Type`. A provider that
  returns either is invalid, whatever the encoding, and that one request is not sent. The encoding wins because the
  recorder, the client and the frame reader decide how to read the answer from it (FR-012).
- Q: Which requests of the command pass its `Host`, `Origin` and `Sec-Fetch-Site` checks? → A: A request for a plugin
  file passes the same checks as the relay, and the listener stays on `127.0.0.1` only. A plugin file can hold a signing
  key, so a page on another site must not be able to load it (FR-021).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Name a plugin in the deployment and have it load (Priority: P1)

A team runs the inspector for its own AG-UI server. It has a small JavaScript module that its developers need in the
inspector. It adds the module's address to the `plugins` list of `config.json`, or to the `plugins` argument of the
helper it already uses, and serves the module from the same origin as the page. A developer opens the inspector and the
plugin is active. No rebuild, no fork and no change to the page's security policy.

**Why this priority**: Nothing else in this feature works without it. It also holds the safety property of the feature:
plugin code comes from the page's own origin and from nowhere else.

**Independent Test**: Serve the production build with a `config.json` that lists the example plugin, in each serving
mode. Open the page and check that the plugin ran. Then list a module on another origin, a `data:` URI and a missing
file, and check the warnings, the requests and the policy.

**Acceptance Scenarios**:

1. **Given** a `config.json` with `"plugins": ["plugins/example.js"]` and that module beside the page, **When** the page
   loads, **Then** the module is loaded, the plugin is active, and the footer says that one plugin is loaded.
2. **Given** a mount through `mount_inspector`, through the Express, Hono or Next.js helper, or through a host that
   serves the static files itself, each with the same plugin, **When** the page loads, **Then** the result is the same in
   all of them.
3. **Given** a deployment with no `plugins` entry, **When** the page loads, **Then** the page, the footer, the content
   security policy and the requests it makes are the same as before this feature, and the `config.json` of each helper is
   byte for byte the one it served before.
4. **Given** a hosted deployment whose `config.json` is read from another file named in `hosting-config.json`, **When**
   that file lists a plugin, **Then** the plugin loads from the page's own origin, and the startup policy that file
   belongs to is unchanged.
5. **Given** an entry that names a module on another origin, **When** the page loads, **Then** a "Configuration"
   warning appears, no request goes to that origin, and the agents and every other entry still apply.
6. **Given** two entries, **When** the page loads, **Then** the plugins are activated in the order written, whichever
   module arrives first.

---

### User Story 2 - A header that changes for each request (Priority: P1)

A developer's server wants a header that differs on every request: a signature of the body and a timestamp, a request id,
or a short-lived token that the host's own session endpoint hands out. A preset cannot say it, because a preset holds
fixed values. The token field and the CLI's `--header` hold one fixed value too. The team's plugin registers a header
provider. For each request to the target, the provider receives the method, the address and the exact body, and returns
the headers for that one request.

**Why this priority**: This is the case the issue names first, and it comes with the strictest privacy rule. A header
provider is the one extension that handles credentials.

**Independent Test**: Run the reference agent with a plugin whose provider returns a header with a unique synthetic
value. Send a run with a preparation request and a raw request. Check the headers the target received, then search the
recorded exchanges, the frames, the exported session and the page for the value.

**Acceptance Scenarios**:

1. **Given** a provider that returns `X-Example-Signature`, **When** the developer sends a message, **Then** the
   preparation request and the run request each reach the target with that header, and the provider was called once for
   each of them with that request's method, address and body.
2. **Given** the same provider, **When** the developer sends a raw request, **Then** it reaches the target with the
   header too, and its body is exactly the text that was entered.
3. **Given** the same provider, **When** the session is recorded and exported, **Then** the exchanges, the frames and
   the exported file hold no header and none of the provider's values. The footer still says that headers are never
   recorded.
4. **Given** a provider that returns a new value for each call, **When** two runs are sent, **Then** the target
   receives a different value in each, and the inspector keeps neither.
5. **Given** a provider and a token typed in the page for the same header name, **When** a run is sent, **Then** the
   target receives the typed token. The developer can still test a wrong token.
6. **Given** a provider that throws or returns an invalid header, **When** the developer sends a message, **Then** the
   request is not sent, the line under the composer says which plugin failed, and a warning shows. The page stays
   usable.
7. **Given** a provider, **When** the page reads `config.json` or a capabilities URL, **Then** the provider is not
   called. It is called only for preparation, run and raw requests.
8. **Given** a provider that returns `Accept`, or `Content-Type`, **When** the developer sends a message, **Then** that
   one request is not sent and the warning names the header. **Given** a profile that asks for protobuf and a provider
   that returns another header, **When** a run is sent, **Then** the target receives the protobuf media type in `Accept`
   and the provider's header beside it.

---

### User Story 3 - Adjust or guard the input of each run (Priority: P1)

A developer's server wants something in the run input that only code can supply for each run: a current timestamp or a
signed value in `forwardedProps`, a context entry read from the page's own session, or a history cut to the last few
messages. A preset can fill in `{{uuid}}` and the values the developer edits, and nothing more. The team's plugin
registers a run hook. Before each run is sent, the hook receives a copy of the input that the preset and the client
profile produced, and returns an adjusted input or nothing. The hook can also refuse a run: a guard that stops a run
when the input holds something that must not leave the page.

**Why this priority**: The issue names it, and it is the only extension that changes what is sent. It comes after
headers because fewer deployments need it.

**Independent Test**: Run the reference agent with a plugin whose hook adds a field to `forwardedProps`. Send a message
and check the recorded request body, the run's recorded input and the target's answer. Then make the hook throw and
check that nothing is sent.

**Acceptance Scenarios**:

1. **Given** a hook that adds `forwardedProps.example` to the input, **When** the developer sends a message, **Then** the
   run request body holds that field, the recorded exchange and the run's recorded input show the same body, and the
   frames of the answer are recorded as received.
2. **Given** a hook that returns nothing, **When** the developer sends a message, **Then** the input is the one the
   preset and profile produced.
3. **Given** two plugins with hooks, **When** a run is sent, **Then** the second hook receives what the first returned.
4. **Given** a hook that throws, returns an input that is not valid, or changes `threadId` or `runId`, **When** the
   developer sends a message, **Then** no preparation request and no run is sent, nothing is recorded as an exchange,
   the line under the composer says which plugin stopped the run and why, and a warning shows.
5. **Given** a hook that is still working, **When** the developer presses Stop, **Then** the run is not sent and no
   warning shows.
6. **Given** a profile that answers interrupts and tool calls automatically, **When** the automatic continuation is
   sent, **Then** the hook runs for it too, because it is a run.
7. **Given** a hook, **When** the developer sends a raw request, **Then** the hook is not called and the raw body is sent
   unchanged. **When** an imported recording is open, **Then** nothing is sent and the hook is not called.

---

### User Story 4 - See a custom event or activity the way the product shows it (Priority: P2)

A server emits `CUSTOM` events and activity types of its own, such as a list of citations or a plan with steps. The
inspector shows them as JSON. The team's plugin registers a renderer for one event name or one activity type and draws
the content the way its product does. The renderer draws into a container that the inspector provides, and the JSON
stays one click away.

**Why this priority**: It is the third extension of the issue. A renderer changes how a developer reads evidence, not
what is sent, so the evidence rules are the point: the raw frames and the JSON view stay.

**Independent Test**: Run the reference agent scenario that emits a custom event and an activity of a custom type, with
and without the plugin. Compare the conversation, the frames list and the exported session.

**Acceptance Scenarios**:

1. **Given** a renderer for the custom event `example.note`, **When** such an event arrives, **Then** the conversation
   shows the renderer's output in a card with the event name, a reference to its frame and a switch to the JSON.
2. **Given** a renderer for the activity type `example-plan`, **When** an activity of that type arrives and later
   changes through a delta, **Then** the card shows the renderer's output for each new content, and the renderer's
   cleanup runs before it draws again and when the card goes away.
3. **Given** the same events with and without the plugin, **When** the frames list and the exported session are
   compared, **Then** they are the same.
4. **Given** a renderer that changes the value it received, **When** the developer opens the frames list, the JSON view
   and the exported session, **Then** they show the value as received.
5. **Given** a custom event or activity type with no renderer, **When** it arrives, **Then** it looks as it does today.
6. **Given** a renderer for `a2ui-surface`, **When** the plugin is activated, **Then** that registration is refused with
   a warning, and the A2UI view draws the surface as before.
7. **Given** a renderer that throws, **When** its event or activity is shown, **Then** the card shows the JSON, a warning
   names the plugin, and the rest of the conversation is unaffected.
8. **Given** an imported recording with such events, **When** the plugin is loaded, **Then** the renderers draw them too.

---

### User Story 5 - A plugin that fails never stops the page (Priority: P1)

A plugin has a bug: the file is missing, it has a syntax error, it does not export what the page needs, it throws while
it registers, or one of its functions throws later. The inspector starts anyway, every other plugin and every agent
keeps working, and a warning names the plugin and what failed.

**Why this priority**: The issue makes it an acceptance criterion, and a plugin is code that the inspector does not
control.

**Independent Test**: Load a set of broken plugins and one good one, in one page. Check the warnings, then use the page.

**Acceptance Scenarios**:

1. **Given** a plugin file that does not exist, is not JavaScript, or has a syntax error, **When** the page loads,
   **Then** a "Plugin" warning names the entry, the page starts, and the other plugins are active.
2. **Given** a module with no default function, **When** the page loads, **Then** the same happens.
3. **Given** a plugin that registers a hook and then throws, **When** the page loads, **Then** nothing it registered is
   kept, and the warning says so.
4. **Given** a module whose function does not finish within 10 seconds, **When** the page loads, **Then** it is skipped
   with a warning and the page starts.
5. **Given** the same failure repeating, **When** a renderer throws on each patch of an activity, **Then** the warning
   shows once, not once for each patch.
6. **Given** any failing plugin, **When** the developer uses the conversation, the frames list, the state view,
   settings, session export and import, **Then** all of them work.

---

### User Story 6 - Use a plugin with the command line inspector (Priority: P3)

A developer reaches a server through the command `npx agui-inspector --target <url>` (feature 005) because the server
cannot change. The server needs a signed header on every request, and `--header` holds one fixed value. The developer
passes `--plugin ./sign.js`. The command serves that file from its own address and lists it in the `config.json` that
it serves.

**Why this priority**: The need is real, and the maintainer wants it in 0.2.0. The story adds an option to the command, so
it comes last. The other stories do not depend on it.

**Independent Test**: Start the command with a target and a plugin file. Open the printed address and check that the
plugin ran and that the target received the plugin's header.

**Acceptance Scenarios**:

1. **Given** `--target <url> --plugin ./sign.js`, **When** the page loads, **Then** the plugin is active and its header
   reaches the target through the command's relay.
2. **Given** a `--header` and a provider for the same name, **When** a run is sent, **Then** the target receives the
   provider's value, because the page's value wins over the command line (feature 005).
3. **Given** a `--plugin` file that does not exist, **When** the command starts, **Then** it stops before it listens,
   with a message that names `--plugin`, and exit code 2.
4. **Given** the command, **When** a client requests any path other than the listed plugin files and the page's own
   files, **Then** nothing of the local file system is served.
5. **Given** a request for a plugin file with a foreign `Host`, a foreign `Origin` or a `Sec-Fetch-Site` of `cross-site`,
   **When** it arrives, **Then** it is refused with a 403 and no file is read. The listener is still the IPv4 loopback
   address only.
6. **Given** `--plugin ./a.js --target <url> --plugin ./b.js`, **When** the page loads, **Then** both plugins are active,
   in the order given, whatever their position among the targets.

---

### Edge Cases

- A module URL with a query or a fragment, such as `plugins/example.js?v=3`, is valid.
- A module URL with credentials, a scheme-relative address (`//host/x.js`), a backslash, or a tab or newline that a URL
  parser would strip, cannot be used to reach another origin. Each is rejected before any request.
- An entry written as `data:`, `blob:`, `file:` or `javascript:` is rejected. Plugins do not use `data:` URIs.
- A same-origin module that redirects to another origin is blocked by the page's policy and handled as a load failure.
- A module served with a type that browsers do not accept for scripts fails to load and shows a warning. The
  documentation names the requirement.
- The same module listed twice loads once, with a warning for the second entry.
- `plugins: []` is valid and changes nothing. `plugins` that is not a list, and an entry that is not a nonempty
  string, are rejected with a warning that names the field and never repeats the value.
- A page with no `config.json` has no plugins. Plugins come from the configuration only. A profile, a recording, a query
  string, a typed endpoint and the settings view cannot name one.
- Two plugins that register a renderer for the same name or type: the first one wins and the second gets a warning.
- Two providers that return the same header name: the later one wins, in the order the plugins are written.
- A provider that returns a header name that the transport owns (`Content-Type`, `Accept`, `Content-Length`, `Host`,
  `Cookie`, `Set-Cookie`) is invalid. `Accept` is the one that carries the encoding of a run, so a provider cannot ask
  for a different encoding than the profile or the preset chose. So is a value with a line break or another control character.
- A provider that returns a credential for every address sends it to every target the visitor picks. A hosted
  deployment that opted in to visitor targets (feature 002) must have its provider look at the address. The
  documentation says so. The inspector cannot know which origin a credential belongs to.
- A run hook that removes tool messages or `resume` entries from the input changes what the server sees. The
  conversation still shows what the inspector tracked. That is the hook's responsibility, and the documentation says so.
- A hook or a renderer that keeps a copy of what it received cannot reach the recording through it: it only holds a
  copy.
- A plugin that calls `fetch` itself is not recorded and not guarded by the inspector. The browser's content security
  policy limits it to the same origins as the page. The documentation says so.
- A renderer that writes markup with a script, an event handler attribute or an inline style gets no script run, because
  the policy forbids inline script. The documentation advises text nodes for content that comes from the target.
- Switching agents or targets keeps the plugins. The hook receives the agent's id, or none for a typed endpoint.
- Reloading the page clears everything the plugins held in the inspector. A plugin's own variables are its own.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The configuration MUST accept an optional `plugins` field: a list of module addresses. The configuration
  format stays at version 0. A file without `plugins` MUST read and behave as before, and a page without plugins MUST
  look and request exactly as before.
- **FR-002**: A plugin address MUST be a nonempty string that resolves to the page's own origin: a path relative to the
  page, an absolute path, or a full URL with the page's origin. It is read against the page's own location, as `logo`
  is, and never against the location of a configuration file that was read from somewhere else. Everything else MUST be
  rejected before any request: another origin, a scheme-relative address, any other scheme, a URL with credentials, a
  value with a backslash or a control character, and a value that is not a string.
- **FR-003**: A bad `plugins` value MUST give a nonfatal "Configuration" warning in the place and form that theme and
  brand problems use. Startup MUST continue. Each bad entry MUST be dropped on its own, and every other entry, the
  agents, the presets, the theme and the brand MUST still apply. A warning MUST name the field and the entry's position
  and MUST NOT repeat the rejected value. A `plugins` value that is not a list MUST be ignored with a warning. An entry
  that resolves to an address already listed MUST be ignored with a warning.
- **FR-004**: Plugins MUST be loaded as script modules from the page's own origin, after the configuration is read and
  before the page accepts a message. The content security policy MUST NOT change: scripts stay limited to the page's
  own origin, there is no inline script, and no `eval` and no `new Function` appear in the page's code. Modules MUST be
  requested together and activated one at a time in the order written. The page MUST send no request to a target until
  every plugin has loaded or failed.
- **FR-005**: A plugin module MUST export a function as its default export. The page MUST call it once, with the plugin
  API object, and MUST wait for it if it returns a promise. A module that does not export a function, or whose function
  throws, rejects or does not finish within 10 seconds, MUST be skipped with a warning. Nothing that the plugin
  registered before it failed MUST stay in effect.
- **FR-006**: The plugin API object MUST carry a `version` number and four registration functions: `beforeRun`,
  `provideHeaders`, `renderCustomEvent` and `renderActivity`. It MUST add nothing else in this feature. A function
  called after the plugin's activation has ended MUST do nothing and give a warning. Registration order across plugins
  is the order the addresses are written, and within a plugin the order of the calls.
- **FR-007**: The API version starts at 0. A change that can break an existing plugin MUST raise the number by one and
  come with migration steps in the changelog of each package that ships it. An addition that breaks no plugin, such as
  a new optional field in what a function receives, MUST keep the number. The number is documented, and a plugin can
  read it to refuse a version it does not support.
- **FR-008**: A run hook registered with `beforeRun` MUST be called for each run that the inspector sends to the target:
  a message, a continuation, a surface action and every automatic continuation. It MUST be called after the input is
  made from the preset and the client profile, and before any preparation request is sent. It receives the input as a
  copy, the id of the selected agent when there is one, the target address and a signal that ends when the user presses
  Stop. It MAY be asynchronous. It returns an adjusted input or nothing, and nothing means no change. Hooks run in
  order, and each receives what the one before returned.
- **FR-009**: The input a hook returns MUST be a valid run input and MUST keep the same `threadId` and `runId`. The run
  that is sent, its recorded request body and its recorded input MUST be the adjusted input. A hook that throws or
  rejects, or returns an input that is not valid, MUST stop that one run: no preparation request and no run is sent,
  nothing is recorded as an exchange, the line under the composer names the plugin and the reason, and a warning shows.
  A refusal is a hook that throws. A hook that is stopped by the user MUST give no warning. The conversation's own
  thread, its messages and state are not changed by a hook.
- **FR-010**: A run hook MUST NOT be called for a raw submission, which sends exactly the entered text, and MUST NOT be
  called while an imported recording is open.
- **FR-011**: A header provider registered with `provideHeaders` MUST be called before each preparation request, each
  run request and each raw request, and for no other request. It receives the request's method, its absolute address,
  its exact body text when it has one, and a signal that ends when the request is stopped. It MAY be asynchronous. It
  returns an object of header names and values, or nothing. Providers are called in order and the later one wins when
  two return the same name. A provider is called again for every request, and the inspector caches nothing.
- **FR-012**: A provider's header MUST be valid: a name that is an HTTP header token and that the transport does not
  own, and a value that is a string valid in an HTTP header. The transport owns `Accept`, which it sets from the encoding of
  the request (server-sent events or the AG-UI protobuf media type), and `Content-Type`. A provider cannot change either,
  so the encoding always wins. A header the user typed in the token field with the same
  name, compared without case, replaces the provider's. A provider that throws, rejects, returns something that is not
  an object, or returns an invalid header MUST stop that one request, with a warning. For a preparation request the run
  is not sent and the message says so, as it does for any failed preparation. A message about an invalid header MUST
  name the header and MUST NOT repeat its value.
- **FR-013**: Header values from a provider MUST live in memory for the one request they were made for. The inspector
  MUST NOT write them into configuration, browser storage, a recording, an inspection view, a log, an exported session
  or a profile, and MUST NOT show them anywhere. The recorder MUST NOT read them and MUST NOT be given them. The
  provider's own variables are the plugin's.
- **FR-014**: A renderer registered with `renderCustomEvent(name, render)` MUST be used for each `CUSTOM` event with
  exactly that name, and one registered with `renderActivity(type, render)` for each activity with exactly that type.
  `render` receives the event's `name` and `value`, or the activity's `messageId`, `activityType` and `content`, as a
  copy, and an empty container element to draw into. It MAY return a cleanup function. The inspector MUST call `render`
  again with the new content when an activity's content changes, calling the cleanup first and emptying the container,
  and MUST call the cleanup when the card goes away.
- **FR-015**: A custom event or an activity with a renderer MUST appear in a card of the conversation, with its header as
  today and a switch between the rendered view and the JSON. Without a renderer it MUST look as today. Renderers MUST NOT
  change the frames list, the state view, the raw view or the exported session. The type `a2ui-surface` belongs to the
  A2UI view: a renderer registered for it MUST be refused with a warning. When two plugins register the same name or
  type, the first registration wins and the second MUST get a warning. Renderers draw for an imported recording too.
- **FR-016**: Hooks, providers and renderers MUST receive copies. Nothing a plugin does to what it received may change
  a recorded frame, an exchange, a derived entry or the stored session. A frame is recorded as received, whatever the
  plugins do.
- **FR-017**: Every plugin failure MUST show a warning in the place of the configuration warnings, on every tab. It
  names the plugin by its address and the extension that failed, and gives the plugin's message, cut to a short length.
  A warning that repeats MUST show once. A failure MUST NOT stop the page, another plugin, or an agent. A failing
  renderer MUST show the JSON view in its card.
- **FR-018**: When at least one plugin is active, the footer MUST say how many. Nothing else about the footer changes,
  and "headers never recorded" stays true.
- **FR-019**: `mount_inspector` MUST accept an optional `plugins` argument, a list of strings, and the Express, Hono and
  Next.js helpers MUST accept the same `plugins` option. Each MUST write the list into the `config.json` it serves, as
  given, and leave the field out when it is not set, so that a mount with no plugins serves a `config.json` identical to
  the one served before this feature. A helper MUST NOT check the values, add a route, change a header or serve a
  plugin file. The host serves the module from one of its own routes, as it does for a logo.
- **FR-020**: Plugins MUST work in every mode with the same result: embedded through `mount_inspector`, embedded through
  the JavaScript helpers, embedded through a host that serves the static files and its own `config.json`, hosted, and
  the npm static assets. Only `config.json`, or the file that `hosting-config.json` names in its place, declares
  plugins. Plugins MUST NOT read from, write to or widen `hosting-config.json` or the request policy.
- **FR-021**: The command of feature 005 MUST accept `--plugin <file>`, repeatable, in any position (it belongs to the
  command, not to a target). A value that is not a file that can be read MUST stop the command before it listens, with exit
  code 2 and a message that names `--plugin` and does not echo the value. The command MUST serve each file, and only
  those, at `/plugins/<n>.js` on its own address (`n` from 1, in the order given), with a JavaScript content type and the
  same content security policy as its other files, for GET and HEAD, reading the file when it is requested. A request for
  a plugin file MUST pass the same `Host`, `Origin` and `Sec-Fetch-Site` checks as the relay, and the listener MUST stay on
  `127.0.0.1` only. The command MUST list the addresses in the `plugins` field of the `config.json` it serves, and MUST
  NOT give a plugin any header, credential or other option. The page's header wins over a `--header` of the same name, as
  feature 005 says. Spec 005 carries a dated note that lists the new option.
- **FR-022**: An example plugin MUST use each extension point against the scripted reference agent: a run hook, a header
  provider, a renderer for a custom event and a renderer for an activity type. The reference agent MUST gain a scenario
  that emits both. An end-to-end test MUST load the example through `config.json` and show what each one does, and the
  same test MUST show the plugin's header on the request, its absence from the recording and the export, and the
  adjusted input in the recorded body.
- **FR-023**: A documentation page MUST describe the plugin API: how a deployment declares plugins in each mode, the
  module shape, each function with what it receives and returns, the version and how it changes, the failure rules, and
  the trust note that a plugin is the deployer's code with the page's rights and is not sandboxed. The configuration page
  MUST describe the field and carry the compatibility note: 0.2.0 adds the optional `plugins` field, and before 0.2.0 an
  unknown field was an error. The embedding page MUST describe the helper arguments, and the documentation of the command
  MUST describe `--plugin`. The hosted page MUST point to the same rules.
- **FR-024**: Tests MUST cover each rejected value in FR-002 and FR-003, the load and failure paths in FR-005, FR-006
  and FR-017, the hook, provider and renderer rules above, the helpers and every serving mode, and a no-plugin page that
  is unchanged. Tests MUST show that a provider's header never reaches a recording or an export, that no request goes to
  another origin, that the content security policy text is unchanged, and that no `eval` or `new Function` is in the
  page's code. A change that ships in the wheel or the npm package MUST add a changeset for that package: both here.
- **FR-025**: The production bundle MUST stay within the existing 2,000,000-byte minified and 600,000-byte gzip budgets,
  and a page with no plugin MUST do the same work as before for the 5,000-frame acceptance and responsiveness criteria.

### Key Entities

- **Plugin**: A script module from the page's own origin that a deployment lists in its configuration. It is the
  deployer's code and runs with the page's rights.
- **Plugin API object**: What a plugin's function receives: a version number and the four registration functions. It is
  the whole contract between the page and a plugin.
- **Run hook**: A function that sees a copy of a run's input before the run is sent and may return an adjusted input.
- **Header provider**: A function that returns headers for one request to the target. Its values live in memory for that
  request only.
- **Renderer**: A function that draws the content of one custom event name or one activity type into a container in the
  conversation.
- **Plugin warning**: A message under the top bar that says a plugin failed. It names the plugin and the extension, and
  shares its place with the configuration warnings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With one `plugins` entry or one helper argument, a deployer makes a plugin active in all five serving
  modes, with no rebuild, and the footer shows it.
- **SC-002**: With no `plugins`, the page, the content security policy text, the set of origins the page contacts and the
  `config.json` bytes of each helper are the same as before this feature.
- **SC-003**: For each rejected value in FR-003, the page shows one warning, drops only that entry, keeps the agents and
  every other valid entry working, and makes zero requests to another origin.
- **SC-004**: One example plugin uses all three extension points against the reference agent in the end-to-end tests,
  and each one's effect is checked on the page.
- **SC-005**: A unique synthetic value returned by a provider appears in zero places the inspector writes: the
  recorded exchanges, the frames, the exported session, the page's text and the browser storage. The target received it
  on each preparation, run and raw request.
- **SC-006**: For each extension point, a plugin that fails produces one warning and leaves the page, the other plugins
  and the agents working. On the send path it also leaves that one request unsent, and no exchange is recorded for it.
- **SC-007**: Frames, raw envelopes, the frames list and the exported session of the same answer are identical with and
  without renderers and providers. A run hook changes the request body and its recorded copy, and nothing else.
- **SC-008**: A developer writes a working plugin for each of the three extension points from the documentation page
  alone.
- **SC-009**: The production bundle stays within the existing size budgets, and the 5,000-frame criteria are unchanged.

## Assumptions

- Scope comes from issue #81 and the accepted 0.2.0 roadmap, item 9. The constitution needs no amendment. Principle III
  already sends application behavior beyond presets to "the specified plugin scope", which this feature is. Principle IV
  already allows scripts from the page's own origin and forbids dynamic code evaluation. Loading a module file by
  address is not evaluation of code from a string. The 1.0.0 line about plugin API formats applies to a 1.0.0 release,
  and none is planned.
- A plugin is the deployer's code. It runs in the page with the page's rights: it can read the page and the token the
  developer typed, and it can call `fetch`. The inspector does not sandbox it. Safety comes from where the code loads
  from: the deployer's own origin, named in the deployer's own file. The documentation says this plainly.
- The three extension points of the issue map to four registration functions, and the issue's "hooks before a run and
  on its input" is one function. The input exists before the run is sent, so a hook before the run that sees and may
  replace the input is a hook on the input. A second hook would have no case of its own: a guard throws, and a hook with
  side effects is the same function. Frame observers, an after-run hook and state hooks have no case yet and are left
  out.
- Renderers draw into a container element and are not React components, so the plugin API does not depend on the React
  version the inspector bundles. The container sits in the page, so a plugin can use the theme's `--agui-*` properties.
- Headers: the token field and the CLI's `--header` already cover a fixed header. Presets have no headers and stay
  that way. The provider is for a header that needs code.
- The API version number is 0, like the file formats. It rises by one with each change that can break a plugin.
- The helpers write `plugins` as given and the page checks it, as for `theme` and `brand`. The host serves the plugin
  file, as it serves a logo. In the CLI there is no host, so the command serves the file (FR-021).
- Raw submissions keep their promise to send the entered text unchanged, so no hook sees them. A provider still adds its
  headers, because headers belong to the connection, as the typed token does.
- A deployer who serves a plugin from a shared origin trusts everyone who can put a file there. The page cannot tell
  one same-origin file from another.
- A file that carries `plugins` is read by 0.2.0 and later. An earlier inspector rejects it as an unknown field, the way
  it rejected `brand` before 0.2.0. The documentation says so, with no migration step.
- Out of scope: loading plugins from another origin, a package or a CDN, plugin options and settings, enabling or
  disabling a plugin in the page, per-agent plugins, a sandbox, a published type package, hot reload, a plugin that adds
  a tab, a control or a route, views for the built-in event types, observers of frames or runs, and a hook for raw
  submissions.
- Publishing, tags and releases stay with the maintainer. The changesets only record the change.
