# MVP interface contracts

Approved-name (`agui-inspector` on npm/PyPI), version-0 contracts. Published stable JSON Schemas are a 1.0.0 obligation, not
introduced here. F01 translates these boundaries into strict TypeScript types in
`packages/inspector/src/contracts.ts`; W2 does not widen them without coordinated review.

## Static distribution and Python helper

One built directory contains index HTML, external JS/CSS, and all local renderer assets. npm exposes
its location through `staticAssetsPath` and packages those files; it does not expose a CLI or JS
server-mount helper. Python copies the identical built files into wheel and sdist package data.
An installed wheel serves them using `importlib.resources`, without invoking Node or downloading.
Both distributions include MIT LICENSE (`Copyright (c) 2026 Nidhal Dogga`) and third-party notices
covering bundled dependencies, including Apache-2.0 texts and any NOTICE for `@a2ui/react`,
`@a2ui/web_core` and `@a2ui/markdown-it`. npm's `files` includes notices; wheel/sdist package data
includes them. Publishing remains unauthorized and private metadata remains in place.

The proposed Python API follows the existing brief:

```python
from agui_inspector import Agent, mount_inspector

mount_inspector(
    app,
    agents=[Agent(id="support", url="/agents/support/stream")],
    enabled=settings.debug,
    theme={"light": {"--agui-accent": "#2563eb"}, "dark": {"--agui-accent": "#93c5fd"}},
)
```

`Agent` requires id and URL, with optional name/capabilities/preset matching the browser config.
`mount_inspector` defaults `enabled=False`, `path="/agui-inspector"`; disabled calls mount nothing,
including config or assets. Enabled mounting serves the page, nested assets and adjacent config,
and emits a startup warning containing the actual mount path. Starlette is optional; absent
embedding dependencies cause an actionable error only when enabling embedding. FastAPI follows
its Starlette routing interface. Custom mount paths, trailing-slash handling and adjacent
`<mount>/config.json` must be tested. No session endpoints/storage or agent proxy are created.

## Configuration and client profile

Version-0 configuration contains `agents`; accept the historical config without a `version` field
as version 0, or explicit `version: 0`, and reject other versions visibly. Export examples use
explicit version 0. Each agent requires unique `id` and `url`; optional `name`, `capabilities`
(inline eleven-group declaration or URL), and `preset`. Embedded relative targets resolve against
the page origin; hosted targets must be absolute permitted HTTP(S) URLs.

Optional `theme` is `{ "light": { ...properties }, "dark": { ...properties } }`; either map may be
omitted. The Python `mount_inspector(..., theme=...)` accepts the same shape and exposes it in adjacent
`config.json`. Only the ten public names in [design](../design/design.md#public-properties) are accepted;
values are strings. Unknown/non-public names, invalid shape/value types and unsafe values yield a
visible nonfatal configuration warning, rejecting the affected overrides while preserving usable
agent configuration. Omitted maps/properties keep their defaults. Values cannot initiate requests
or escape declarations: at minimum reject case-insensitive `url(`/`image-set(`, including whitespace
before `(`, `@`, `;`, `{`, `}` and backslash escapes. The CSP stays unchanged. Every MVP mode loads
this field through `config.json`; effective overrides follow the existing automatic/manual theme
selection: the page sets the accepted entries for the mode in use as custom properties on the root
element through the CSS object model (no request, no CSP change), and swaps them when the system
preference or the top-bar switch changes the mode. Each rejected entry gives one warning in a
"Configuration" region under the top bar, visible on every tab; its map, the rest of the theme and
the agents are kept. The Python helper writes `theme` into `config.json` unchanged and the page alone
validates it. Generic derived tokens and their dark variants are declared on the inspector mount
`#root`, not document `:root`; the namespaced public `--agui-*` defaults stay on `:root` so a
stylesheet override or a theme map sits on the same element as the defaults that derive from them.

Preset variables have text/JSON kind and defaults; missing kind means text. Built-ins `threadId`,
`runId`, `uuid` use Web Crypto, not an added UUID dependency. `uuid` is generated once per dispatch
attempt and reused across that attempt's defaults/preparations/input. Replace `{{name}}` in strings;
if a whole string is a JSON variable, substitute the actual JSON value. Embedded JSON replacements
inside a longer string use JSON serialization. Undefined variables and malformed edited JSON are
visible validation errors, not empty strings. Never use eval or executable templates.

Preparation entries require method/path and optional JSON body. Execute in declared order before
every conversation run/continuation; response/transport failures stop the sequence visibly and
prevent the run request. Default message mode is full; turn selects only the current turn's added
messages, including required tool results/resume handling. Quick messages use the same path.

Profile JSON envelope is `{ "version": 0, "profile": { ...settings } }`; browser persistence uses
the same validated settings envelope. Settings are protocolVersion, tools, context, renderA2ui,
injectA2uiTool, messageMode and forwardedProps. Profile-selected mode overrides the preset mode;
profile forwarded properties override same-named preset properties. Tools/context replace their
selected profile values, not concatenate duplicate tool names. Protocol-required A2UI action data
and resume/tool-result fields cannot be overwritten by generic forwarded-property editing.
No auth-header/token fields are accepted or serialized; unknown envelope/version errors are visible.
`renderA2ui` changes display only and persists/exports without changing run inputs.
`injectA2uiTool` remains the A2UI input-affecting control.

## Request, recording and security boundary

The guarded transport accepts destination, method, supplied body text and request kind. The caller
may supply in-memory credentials separately; the recorder receives no header metadata. It uses
same-origin credentials for embedded same-origin requests and `omit` for hosted targets. All
configuration/capability/preparation/run requests obey the startup allowlist. Reject URL userinfo,
disallowed targets and redirects visibly rather than following to another origin. CSP includes
`script-src 'self'`, excludes inline scripts/eval, and fixes hosted `connect-src` to the explicit
deployment destinations before any application request. Config loading never expands it.
Bundle catalogs/assets/fonts locally or use platform defaults; surface-provided remote resources
must not introduce third-party requests.

Every preparation, conversation, and raw request creates an exchange recording method/path/body,
available status, elapsed time and response evidence. The caller identifies an expected SSE body;
the recorder must not inspect Content-Type or other headers. A non-SSE error response is retained
as body evidence even if it cannot form protocol events. Browser transport errors are shown
without dumping request objects or credentials. No client debug logger records auth/request headers.

Raw input must be syntactically valid JSON. Syntax errors block submission visibly; schema-invalid
JSON is flagged but sent as the exact entered string, outside conversation/preparation/transformation.
It shares target security/auth/recording but must not update the conversation as an ordinary turn.

## Frame reader and store

Streaming UTF-8 decoding accepts LF/CRLF/CR, multiline data, event boundaries split across chunks,
comments/control-only blocks, multiple events per chunk and EOF partial blocks. Keep the original
envelope text including delimiters, plus separate extracted data text. Record control-only/partial
evidence with an explicit non-protocol classification; it must not create a fictitious AG-UI event.
Data-frame arrival indices and raw offsets are append-only. Retained data frames, not emitted
client expansions or keepalive comments, determine the 5,000-frame count.

Validate extracted data as JSON, then with upstream EventSchema. Findings are additive; unknown
types, schema failures and non-JSON data are never discarded. A terminal-event finding is determined
from valid observed RUN_FINISHED/RUN_ERROR evidence on stream end; schema-invalid lookalikes do
not satisfy it. Client sequence errors attach to run; they do not abort the recording reader.

The store exposes append/update/read/subscribe operations and snapshots of
[entities](../data-model.md), with stable ids and source links. Subscription notifications occur
at most once per animation frame, but every frame is appended immediately. Tests inject a scheduler
without React. Original chunks and client-expanded events are separate records/provenance.

## Conversation and interactive seams

F01 freezes entry exports for settings, connection/run controls, conversation/state, frames/raw/session,
A2UI and app boot. They accept the shared store and typed callbacks; direct imports remain explicit,
not discovered through a plugin registry. The unavailable scaffold state disables actions visibly.
L07 replaces the boot/assembly surface without taking ownership of lane internals.

Conversation inputs use RunAgentInputSchema with threadId/runId, selected protocolVersion, optional
parentRunId, current state, chosen messages/tools/context, merged forwardedProps and applicable
resume. `HttpAgent` uses the recorder-injected fetch. Client callbacks supply derived state/messages,
interrupts, outcomes and sequence errors; uncommon event views project valid raw protocol events
without pretending they are client-emitted. See the full event/view mapping in the spec's source
section 8.3; text stays plain and encrypted reasoning stays opaque.

Interrupt Resolve/Cancel drafts use the upstream resume-entry shapes, seeded from a supplied JSON
response schema. Only all answered interrupts permit continuation. Pending client tools similarly
wait for all manual results and add corresponding tool messages. Argument fragments display while
streaming and parse at completion; invalid arguments produce inspection errors, not dropped calls.

A2UI renders `a2ui-surface` activity content's `a2ui_operations` using v0.9 bundled catalog packages.
The catalog factory in `packages/inspector/src/views/a2ui/catalog.tsx` recognizes exactly one built-in
alias: `https://a2ui.org/specification/v0_9/basic_catalog.json` (middleware 0.0.11 default) resolves
to `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json` (renderer basic catalog).
This performs no network fetch and does not rewrite recorded operations; other aliases remain
deferred to 1.0.0 and unsupported ids still produce visible renderer errors.
Renderer-disabled and unknown activities remain JSON. Actions preserve
`forwardedProps.a2uiAction.userAction.{name,surfaceId,sourceComponentId,context,timestamp}` and
dispatch a new ordinary run with preparations. Tool injection uses the official `RENDER_A2UI_TOOL`
only when selected; it must not inject prompts or automate replies unexpectedly.

## Session files

Envelope: `{ "version": 0, "session": { ...inspectionData } }`. Include ordered exchanges,
original frames, run inputs and inspection provenance/timing; no request/response header fields,
volatile connection/auth state or executable request metadata. Do not export by serializing an
HttpAgent/fetch Request object. Warn explicitly that raw bodies/frames may contain sensitive data
before download. Browser memory is the only capture storage.

Validate the whole file and references before import commits; reject malformed JSON, wrong versions,
invalid timing/order/index data, header-bearing records and incomplete envelopes with visible errors.
Preserve the old loaded session on failure. Successful import opens an inspection-only recording and
initiates zero network requests. Same-version round trips preserve inspectable text/order/time/input.
Future incompatible version-0 changes document migration in the changelog; no v1 promise is made.

G-07 is closed under constitution 1.0.3: credentials held by the inspector stay memory-only and are
never written from auth state into configuration, browser storage, recordings, views, logs or exports.
Target bytes remain unchanged evidence even when they echo credentials. No redaction; the export
warning remains mandatory. The recorder never reads headers and exports contain no headers.
