# Research: Plugin API

Decisions for [spec.md](spec.md). Each has the choice, the reason and what was rejected. Facts about the code were read
on `main` at 8cb1a6f. Facts about the browser were checked in Chromium.

## 1. Where plugins are declared

**Decision**: An optional `plugins` list in `config.json`, validated by the configuration reader, with the same
"warn, drop the entry, carry on" rule as `theme` and `brand`.

**Reason**: The helpers (`mount_inspector`, the JavaScript helpers, the command of feature 005) already write only
`config.json`, and `brand` lives there. `hosting-config.json` is the request policy. Adding to it would make the Python
and JavaScript helpers write a second file, and the embedded page reads "no `hosting-config.json`" as "embedded". A
plugin widens nothing in the policy: the address must be on the page's own origin, and the content security policy text
is unchanged. Whoever writes `config.json` can only choose among files that the page's own origin already serves.

**Rejected**:

- A field in `hosting-config.json`. Strict parsing is attractive, but it splits the deployment's wishes across two
  files and needs helper changes that `brand` did not.
- A `<script>` tag or a query parameter. The first needs a different `index.html` for each deployment. The second lets a
  link choose code, which breaks the rule that only the deployer's file does.
- The client profile. A profile is imported from a file and stored in the browser. Code must not come from there.

## 2. How a module is loaded

**Decision**: `import(url)` of the resolved address, from `startPage`, after the configuration is read and before the
page renders. All modules are requested together. Each is activated on its own, in the order written. The import and the
activation each get 10 seconds.

**Facts checked**:

- Under `script-src 'self'` a dynamic `import()` of a same-origin module works. A module that redirects to another
  origin is blocked by the policy ("violates ... script-src"). A module served as `text/plain` is refused ("Expected a
  JavaScript-or-Wasm module script"). A missing file fails. All three fail with the same message, so the page names the
  address and says that it could not be loaded.
- `esbuild --format=esm --platform=browser` keeps `import(variable)` as written, so the bundle needs no change and no
  plugin of its own.
- No `eval`, `new Function` or inline script is involved, so the existing source test (`\beval\s*\(|new\s+Function\s*\(`)
  stays true.
- A module request carries the page's own credentials (same-origin mode), so a plugin behind the host's authentication
  loads like the page does.

**Rejected**:

- A web worker. It cannot draw into the page, and renderers are one of the three extension points.
- A sandboxed iframe. Same reason, and it would need `postMessage` for every hook and header.
- `fetch` and `new Function`. Forbidden by the constitution.
- Loading after the first render. A run could then be sent before a hook that redacts input has loaded. Waiting costs one
  round trip to the same origin.

**Consequence**: a plugin module needs a JavaScript content type. The docs say so. Python's `StaticFiles` and every
static server do this for `.js`.

## 3. The shape of a plugin

**Decision**: The default export is a function that receives a frozen API object. The object has `version` and four
registration functions. The function may return a promise. Everything a plugin registers is kept only if the function
finishes without error.

**Reason**: The issue asks for an API that carries a version number, and the assignment asks for the object a plugin
receives. One function and one object are the least a plugin needs to learn. New abilities are new members of the object,
so they break nobody. Collecting registrations and committing them at the end gives all-or-nothing activation without
asking plugin authors to think about it. The registration functions stop working when the activation ends, so a plugin
cannot add a hook later from a timer that the page cannot see.

**Rejected**:

- A declarative default export (`{ beforeRun, provideHeaders, renderers }`). It is as small, but the plugin then
  receives nothing, and the issue's version number has no place to live. A plugin could not find out which version it runs
  under.
- A named export per extension point. A plugin that exports `beforeRun` and nothing else works, but the module has no
  place to run code once at startup (a token endpoint check, for example) and no way to refuse a version.
- An export named `apiVersion` that the page compares. It is a second mechanism for the same fact. A plugin that cares
  reads `api.version` and throws, and the throw is already a warning.

## 4. One run hook

**Decision**: `beforeRun({ input, agentId, url, signal })` returns an input or nothing. It runs after
`composeRunInput` and before the preparation requests. It is not called for raw submissions or while a recording is open.

**Reason**: See the clarification. The run input is built once per dispatch in `dispatchRun`, and `execute` sends it. The
hook sits between them. Before the preparations, a refusal means nothing at all was sent, which is the cleanest meaning of
"the run was not sent". Preparations do not feed the input in this code base, so the hook loses nothing by running first.

**Checks on what comes back**:

1. The value goes through the same schema check as `composeRunInput` (`RunAgentInputSchema`), which is moved into a
   small exported function `checkRunInput` so the two cannot drift.
2. `threadId` and `runId` must equal the originals. The recorder, the run record and the client's own bookkeeping use
   them.
3. The checked value is copied (`structuredClone`) before it is used. A plugin that kept the reference cannot change the
   recorded input after the fact.

The hook receives a copy too. The page's `input` object is the one `execute` stores in the run record.

**Not changed**: the client's `initialMessages` and `initialState`. The hook edits what goes out on the wire. The
conversation the inspector keeps is what the developer typed and what came back. The spec lists the consequence for a hook
that removes tool messages.

**Rejected**:

- A second hook after the preparations. No case needs it.
- A hook that receives the whole preparation plan. Presets own preparations (principle III).
- A hook that can change `threadId` or `runId`. Both name the run in the recording.

## 5. Header providers

**Decision**: `provideHeaders({ method, url, body, signal })` returns an object of headers or nothing. The runtime calls the
providers before each preparation request, run request and raw request, and puts the result in a new optional field,
`TransportRequest.headers`. The guarded transport validates the headers again, merges them below the typed token and
sends them.

**Where the call sits**: before `recorder.record`, never inside the `send` callback. If a provider fails inside `send`, the
recorder would write an exchange with a transport error for a request that never left the page. Resolving first means a
failed provider records nothing. The recorder is not given `TransportRequest`, so it still cannot see a header. The three
call sites are the preparation loop (`runPreparations`), the run (`dispatchRun`, just before the point where owed replies are
carried) and `sendRaw`.

**Why before `replies = NO_REPLIES`**: `dispatchRun` clears the answers a run was waiting for once the run is sure to go
out. A provider that fails after that would lose the developer's answers. Resolving the run's headers earlier keeps them
for the retry. The preparations of that attempt were sent already, as for any failure between them and the run.

**Which requests**: the same three that the typed token reaches. Configuration and capabilities requests do not carry the
token today and do not get provider headers. The configuration loads before any plugin does.

**Merge rule**: providers in order, a later one wins for a name compared without case. The typed token replaces a header of
its name. The helper in the transport deletes the key it replaces, because the headers object is a plain record with
whatever case the caller used.

**Validation**: names by `headerNameProblem` (already used for the token). Values by a new check: a string made of tab,
space and printable ASCII or Latin-1 characters (`/^[\t\x20-\x7e\x80-\xff]*$/`). `fetch` throws a `TypeError` for anything
else, which the transport would report as a CORS problem. The check gives the real reason. A message names the header and
never the value.

**Credentials in memory**: the value exists in the local variable of one call and in the `RequestInit` that `fetch`
receives. Nothing in `RuntimeState`, the store, the recorder, the profile or the session file refers to it.

**Rejected**:

- Passing the typed token to the provider. The token is read in exactly one place, the transport call. A provider that
  needs a secret keeps its own, or asks its own origin for one.
- Caching provider results. A header that "changes for each request" is the case.
- A request `kind` field. The address says enough, and a provider that wants to treat preparations differently can look at
  the method and the path.
- Running providers inside the transport. The transport would need to know about plugins, and the failure would be recorded
  (see above).

## 6. Renderers

**Decision**: `renderCustomEvent(name, render)` and `renderActivity(type, render)`. `render(data, container)` draws into an
empty `<div>` that the inspector provides and may return a cleanup function.

**Data passed**: `{ name, value }` for a custom event, `{ messageId, activityType, content }` for an activity. Both are
JSON copies made by `JSON.parse` of the text the page already built for its own comparison (see below).

**Calling**: a small component, `PluginSlot`, owns the container. Its effect depends on the renderer and on the JSON text of
the data, so it runs again when the content changes and not on every render. The conversation view re-projects the whole
thread on each store change, so entries are new objects each time and identity cannot be the key. The text is compared
instead. This costs one `JSON.stringify` of the entry for each slot on each conversation render. That is the same order of
work as the JSON view the card already builds, and it only exists for entries that have a plugin renderer.
`// ponytail: ...` records the ceiling: a plugin view over a very large activity re-renders for every frame of the stream.
The upgrade path is a content version number from the projection.

**Cleanup and errors**: the inspector calls the cleanup, then empties the container, before each new call and when the slot
unmounts. A throw in `render` or in the cleanup shows the JSON view in the card and reports one warning. React is not told
about the plugin's DOM, so nothing a plugin does inside the container can confuse a reconciliation.

**Where it shows**: the activity card already switches between a rendered view and JSON when `renderActivity` returns
something. A custom event is a one-line marker today, so a custom event with a renderer becomes a card with the same
header facts, the same switch and the same container. The seam is the existing `renderActivity?(entry)` in
`ConversationViewExtras`, with a twin `renderCustom?(entry)`. The app puts the A2UI view first and a plugin renderer second,
so `a2ui-surface` cannot be taken (principle II).

**Rejected**:

- React elements from the plugin. The plugin would need the bundle's React. See the clarification.
- A JSON description of a view that the page interprets. It is the safest, but it is a UI language to design, document and
  keep stable, and no case in the issue asks for it.
- Letting a renderer change the frames list or the inspection pane. Those are evidence (principle I and VI).

## 7. Failures and warnings

**Decision**: `PluginHost` keeps a list of warning strings (no duplicates, at most 20) and tells the page when it changes.
The page shows them in the existing warnings area with the kind "Plugin". A configuration problem keeps the kind
"Configuration". A failure on the send path also stops that one request and puts the message in the line under the
composer, which is where a failed preparation shows.

**Messages**: one form, `<address>: <extension> <what happened>: <message>`, with the plugin's message cut to 200
characters. Text is rendered by React, so markup in a message is shown as text. A stop by the user is not a failure and
reports nothing.

**Why a list in the host and not in React state**: renderers fail inside effects, and hooks and providers fail inside the
runtime. Neither has React state to use. The page subscribes once with `useSyncExternalStore`, the way it already reads the
runtime.

## 8. The version number

**Decision**: An integer. It is 0 in this feature. It rises by one with each change that can break a plugin, and the
changelog of each package that ships the page carries the migration steps. A change that cannot break one keeps the number.

**Reason**: The issue wants "migration notes in the changelog". A number that can rise is how a plugin finds out which side
of a change it is on. The file formats are at version 0 for the same reason, which the roadmap decisions keep.

**Rejected**: A string such as `"0.2"`. It invites partial ordering questions that an integer does not.

## 9. Helpers

**Decision**: `mount_inspector(..., plugins=[...])` and the `plugins` option of the JavaScript helpers write the list into
`config.json` as given, and leave the key out when it is not set. The helpers neither check the values nor serve the
module.

**Reason**: This copies `brand` exactly. The Express, Hono and Next.js adapters pass their options to one core function, so
the JavaScript side is one type member and one key in the `JSON.stringify` call. The key goes last, so a mount without
plugins serves the same bytes as before.

**Rejected**: A helper that takes file paths and serves them. It adds routes to a helper whose promise is "mounts one
page and `config.json`", and it would need a second mechanism for each framework's static files.

## 10. The command of feature 005

**Decision**: `--plugin <file>`, repeatable. The command checks each file at start, serves it at `/plugins/<n>.js` and
lists `/plugins/<n>.js` in the `plugins` of the `config.json` it serves.

**Facts** (read in the 005 worktree, PR #97, not merged): `listen()` builds one `createInspectorHandler({ agents, ... })`
and answers the proxy and every other path through it. A plugin route fits in `serve()` next to the proxy branch.

**Open**: whether the file is served by the command or by the shared core (an internal option that maps a name to a local
file, like `assetsDir`). The choice is made against the merged 005 code, when this story is implemented. The behavior in
the spec does not change.

**Rejected**: A directory option such as `--plugins-dir`. It would serve every file in a directory, and the command's
promise is to serve only what it was told.

## 11. Proving that no header is recorded

**Decision**: Three layers.

1. A unit test over the runtime with a fake `fetch` and a provider that returns a unique value. The fake sees the header.
   `JSON.stringify` of the store snapshot, of `serializeSession` output and of `runtime.getState()` must not contain it.
2. A unit test of the transport: the provider's header is in `RequestInit.headers`, the typed token replaces a header of
   the same name, an invalid name or value is refused with a message that does not hold the value.
3. An end-to-end test with the reference agent behind a recording origin of the test site: the request that arrived has
   the header (the test site's `Seen` entries gain `headers`), the exported file and the page's text and storage do not.

**Why not only one**: the unit layer proves the code path. The end-to-end layer proves what a person would see and what the
browser sent.

## 12. DOM tests

The repository has no DOM emulation (no jsdom or happy-dom) and this feature adds none. The mount and cleanup rules live in
a plain function that takes anything with `replaceChildren()`, so a unit test can drive them with a fake container. What a
real container shows is checked in Playwright.

## 13. Cost when no plugin is used

`PluginHost.beforeRun` and `headers` return at once when nothing is registered, with no copy and no clone. A renderer lookup
is a `Map.get`. `PluginSlot` exists only for an entry that has a renderer. The footer count is a number. No new
dependency, so the bundle grows by the host (a few kilobytes) and the slot.

## 14. Constitution

No amendment. Principle III names "the specified plugin scope" and this is it. Principle IV's "scripts MUST remain
same-origin only, dynamic code evaluation MUST remain forbidden" holds: a module file is loaded by address, and nothing is
evaluated from a string. The architecture line about adding plugins to the MVP is answered by the 0.2.0 roadmap, item 9.
The 1.0.0 line that wants plugin API formats at version 1 applies to a 1.0.0 release, which is not planned. Version 0 here
is the pre-1.0 convention, with migration notes in the changelog.
