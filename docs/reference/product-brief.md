> Historical reference, archived 2026-10-02. The original text below is preserved for source
> traceability and planning input. [Feature specifications](../../specs/) define current requirements;
> [the roadmap](../../ROADMAP.md) tracks releases. Recorded feature clarifications take precedence
> over this snapshot.

# agui-inspector specification

Status: draft. This document defines the first release, **0.1.0 (MVP)**, and the release that makes the project stable,
**1.0.0 (target)**. Sections 1 to 9 hold for both. Sections 10 and 11 say what each release contains and how it is
accepted, section 12 lays out the repository, and section 13 lists what is still open.

## 1. Purpose

[AG-UI](https://docs.ag-ui.com) connects agents to user-facing applications through a stream of typed events. Agent
servers that speak it need a tool that shows what they actually send, the way the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) does for MCP servers and the
[A2A Inspector](https://discuss.google.dev/t/announcing-the-a2a-inspector-a-ui-tool-for-a2a-protocol-development/242240)
for A2A agents. AG-UI has none that works against any server:

- The [AG-UI Dojo](https://github.com/ag-ui-protocol/ag-ui/tree/main/apps/dojo) is a gallery of demos. Each page is
  bound to a demo agent and its tools, and runs behind a Next.js server and a CopilotKit runtime.
- CopilotKit's inspector runs inside a CopilotKit application, and its VS Code event inspector reads a CopilotKit
  runtime's debug endpoint. Neither connects to an AG-UI endpoint directly.
- A chat framework shows what it understands, after it has parsed and merged the events, and answers interrupts and
  tool calls its own way.

**agui-inspector** is a developer tool that connects to any AG-UI server and shows the wire: every request it sends,
every event that comes back, in order, with its timing, checked against the protocol. It drives runs the way a client
does (messages, interrupt answers, tool results, A2UI actions) and sends requests no client would.

## 2. Principles

1. **The wire comes first.** Every event is shown as it was received. An event that is not JSON, that the protocol's
   schema refuses, or that breaks the protocol's sequence rules is kept and flagged, never dropped or repaired.
2. **The protocol, not a framework.** The inspector is built on the protocol's own packages (`@ag-ui/core`,
   `@ag-ui/client`) and renders A2UI with the A2UI project's own renderer. No chat framework sits between the wire
   and the view.
3. **Generic core, application presets.** Nothing in the core knows a particular server. What an application needs
   around a run (preparing a session, extra forwarded props, sending only a turn's new messages) is a preset.
4. **Nothing leaves the machine but the requests to the target.** No telemetry, no analytics, no third-party
   requests. A credential the inspector holds is never recorded, displayed or exported. A server can still repeat one
   in a payload, and the inspector keeps those bytes as received.
5. **Small and auditable.** Few runtime dependencies, exact pins, a committed lockfile, no install scripts.
6. **Every event type has a view.** Each event type of the protocol has a rendering, including those few servers emit
   today.

## 3. Users

- **Agent server developers**, the primary users: debug an AG-UI endpoint, try a protocol feature the day the server
  emits it, check that the server keeps to the protocol and to the capabilities it declares.
- **Client developers**: replay a recorded session to a client under test.
- **Framework and SDK authors**: run the conformance suite against their AG-UI integration.

## 4. Protocol baseline

The inspector targets **AG-UI 1.x** through `@ag-ui/core` and `@ag-ui/client`. The parts it relies on:

- **Events.** The 31 event types of AG-UI 1.0:

  | Family | Event types |
  | --- | --- |
  | Run | `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR` |
  | Steps | `STEP_STARTED`, `STEP_FINISHED` |
  | Text | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `TEXT_MESSAGE_CHUNK` |
  | Tool calls | `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_CHUNK`, `TOOL_CALL_RESULT` |
  | Reasoning | `REASONING_START`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `REASONING_MESSAGE_CHUNK`, `REASONING_END`, `REASONING_ENCRYPTED_VALUE` |
  | State | `STATE_SNAPSHOT`, `STATE_DELTA`, `MESSAGES_SNAPSHOT` |
  | Activities | `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA` |
  | Subagents | `SUBAGENT_STARTED`, `SUBAGENT_FINISHED`, `SUBAGENT_ERROR` |
  | Extension | `CUSTOM`, `RAW` |

- **Run input.** `RunAgentInput`: `threadId`, `runId`, `protocolVersion`, `parentRunId`, `state`, `messages`,
  `tools`, `context`, `forwardedProps`, `resume`.
- **Run outcomes.** `RUN_FINISHED` ends a run as a success (with the tool calls it left to the client, its pending
  tool calls), an interrupt (with its interrupts), or a cancellation. The next run answers interrupts with `resume`
  and pending tool calls with tool messages.
- **Capabilities.** An agent describes what it supports with `AgentCapabilities`, in eleven groups: `identity`,
  `transport`, `tools`, `output`, `state`, `multiAgent`, `reasoning`, `multimodal`, `execution`, `humanInTheLoop` and
  `custom`.
- **A2UI.** AG-UI carries A2UI surfaces as activities of type `a2ui-surface` whose content holds `a2ui_operations`,
  and a press on a surface comes back in `forwardedProps.a2uiAction.userAction` (`name`, `surfaceId`,
  `sourceComponentId`, `context`, `timestamp`), the conventions of `@ag-ui/a2ui-middleware`.

## 5. Distribution modes

One static bundle, loaded four ways.

| Mode | How | Network path | Release |
| --- | --- | --- | --- |
| **Embedded** | A server SDK helper mounts the bundle next to the agent routes, at `/agui-inspector` by default | Same origin: no CORS, the host's own authentication applies | 0.1.0 (Python), 1.0.0 (JS servers) |
| **Hosted** | The project publishes the bundle as a static site; anyone can host their own copy | Browser to the target, cross-origin: the target allows the page's origin | 0.1.0 |
| **CLI** | `npx agui-inspector --target <url>` serves the bundle on localhost and proxies to the target | Browser to localhost to the target: no CORS, headers set on the command line | 1.0.0 |
| **In-app** | A custom element, `<agui-inspector>`, attached to an `AbstractAgent` the host application already runs | No requests of its own: it reads the agent's events | 1.0.0 |

**Embedded is the primary mode.** It is how API frameworks ship their documentation UI: the server mounts the page,
the page finds the server's agents in a config the server serves, and every request stays on one origin.

- **Python (0.1.0).** `pip install agui-inspector`. For Starlette and FastAPI:

  ```python
  from agui_inspector import Agent, mount_inspector

  mount_inspector(
      app,
      agents=[Agent(id="support", url="/agents/support/stream")],
      enabled=settings.debug,
  )
  ```

  The wheel ships the prebuilt bundle: the host needs no Node toolchain.
- **Any other server (0.1.0).** The npm package ships the bundle as static files and their path. A server serves
  them, plus the config of section 6, under one path.
- **JS servers (1.0.0).** Helpers for Express, Hono and Next.js route handlers, from the same npm package.
- **Guards.** `mount_inspector` mounts nothing unless `enabled` is true, and the examples tie `enabled` to the host's
  debug setting. Whenever it mounts, it logs a warning at startup with the path. It serves the page with its own
  content security policy.

**Hosted mode** suits a quick look at a server you run. The target must allow the page's origin (CORS). A page served
over HTTPS can call a plain-HTTP target on localhost only, and a page on a public address that calls a private one
triggers the browser's private-network checks. Traffic goes from the browser to the target only, but the page's code
comes from whoever hosts it: for regulated data, host your own copy or use embedded mode.

## 6. Configuration

The page reads a JSON config: `config.json` next to the bundle in embedded and CLI modes, a file or URL the user
loads in hosted mode. Each agent needs an `id` and a `url`; everything else is optional.

```json
{
  "agents": [
    {
      "id": "support",
      "name": "Support assistant",
      "url": "/agents/support/stream",
      "capabilities": "/agents/support/capabilities",
      "preset": {
        "variables": {
          "userId": { "default": "dev-{{uuid}}" },
          "seed": { "default": { "plan": "free" }, "type": "json" }
        },
        "forwardedProps": { "user_id": "{{userId}}" },
        "messages": "turn",
        "prepare": [
          {
            "method": "PUT",
            "path": "/agents/support/sessions/{{threadId}}",
            "body": { "user_id": "{{userId}}", "context": "{{seed}}" }
          }
        ]
      }
    }
  ]
}
```

- `url` is the agent's run route, relative to the page's origin in embedded mode, absolute otherwise.
- `capabilities` is the agent's `AgentCapabilities`, inline or as a URL to fetch.
- `preset` holds what an application needs around a run:
  - `variables`: values the user edits in the page, text or JSON, with defaults. Built-in variables: `threadId`,
    `runId`, `uuid`.
  - `forwardedProps`: merged into every run's `forwardedProps`.
  - `messages`: `"full"` sends the whole transcript, as most AG-UI agents expect; `"turn"` sends only what the turn
    adds, for agents that keep the conversation server-side.
  - `prepare`: HTTP requests sent, in order, before each run; a failure fails the run, and each is recorded like any
    other request.
- Templates (`{{name}}`) are replaced in strings; a JSON variable that fills a whole string value is inserted as JSON.
- The config never holds credentials. Tokens are typed in the page and kept in memory.
- 1.0.0 freezes this schema as version 1 and publishes it as JSON Schema.

## 7. Architecture

```text
recorder ──► frame reader ──► session store ──► views
   ▲              │                 ▲
   │              ▼                 │
 fetch      rule checks       AbstractAgent (transcript, state, interrupts)
```

- **Recorder.** Wraps the `fetch` the agent uses. Each request becomes an *exchange*: method, path, body, status,
  duration. An event-stream answer is teed: the agent reads one branch untouched, the recorder the other. The
  recorder never reads headers.
- **Frame reader.** Splits the stream into events wherever the network cuts it, and reads each one: JSON, then
  `EventSchema`. A frame keeps its raw text, its offset from the request's start, its type, a one-line summary and
  any issue.
- **Rule checks.** Sequence rules (the protocol's, as `@ag-ui/client` enforces them), the terminal-event rule (a run
  ends with `RUN_FINISHED` or `RUN_ERROR`), and in 1.0.0 the declared capabilities. A violation is attached to the
  frame where it happens; the log goes on.
- **Agent.** `@ag-ui/client`'s `HttpAgent` keeps the transcript, the state and the open interrupts, with the preset's
  middleware. In the in-app mode the host's own `AbstractAgent` takes its place.
- **Session store.** Exchanges, frames and runs, observable. Views hear of changes at most once per animation frame.
- **Views.** The conversation, the frames, the state, the capabilities, the raw request editor.

The core (recorder, frame reader, rule checks, session store, presets) is framework-free TypeScript. The views are
React. A2UI surfaces render with `@a2ui/react` and `@a2ui/web_core`.

## 8. Features

### 8.1 Connection

- Agents come from the config, or from a URL the user types.
- A token field sends a header the user names (`Authorization` by default). It lives in memory, is dropped on reload
  and when the target changes, and appears in no view and no export.
- Embedded mode sends cookies to its own origin. Other modes send none.

### 8.2 Conversation

- The transcript by role: user, assistant, tool, reasoning, activity, system and developer messages.
- Text shows as sent, with an option to render Markdown.
- Tool calls show their arguments as they stream, parsed once complete, and their results.
- What a run leaves to answer is answered in place:
  - **Interrupts**: a payload editor prefilled from the interrupt's response schema, with Resolve and Cancel. The next
    run carries `resume` once every interrupt has an answer.
  - **Pending tool calls**: a result editor. The next run starts once each has a result.
  - **A2UI surfaces**: rendered; a press starts a run with `forwardedProps.a2uiAction`.
- New thread, stop, and the commands a preset offers as one-click messages.

### 8.3 Event views

Every event type has a view in the frames list (type, offset, summary, raw JSON on demand) and, where it changes what
a user sees, in the conversation.

| Family | Conversation | Inspection |
| --- | --- | --- |
| Run | A run header: ids, `parentRunId`; its outcome: success with result and pending tool calls, interrupt, cancellation, error | Run boundaries and durations |
| Steps | A collapsible group per step | Step durations |
| Text, tool calls, reasoning | Messages and cards, live as they stream | Each delta |
| `*_CHUNK` | As the events they stand for | The chunk as received, next to the events the client expands it into |
| `REASONING_ENCRYPTED_VALUE` | A badge: subtype, entity and size. Never decoded | The raw value |
| `STATE_SNAPSHOT`, `STATE_DELTA` | None | The state, and each delta's operations |
| `MESSAGES_SNAPSHOT` | The transcript it replaces, with a marker | Messages added and removed |
| Activities | A card: A2UI surfaces rendered, other types as JSON, updated by each delta | Each patch |
| Subagents | A marker per start, finish or error, nested under the parent run | The subagent's run, linked by `parentRunId` and `subagentRunId` |
| `CUSTOM`, `RAW` | A marker with the name or source, and the value | The value |

### 8.4 Inspection

- **Frames**: exchanges newest first, the newest expanded. A filter on types, content and issues. Copy an exchange's
  frames as JSON.
- **State**: the agent's state as the events left it.
- **Raw request**: any JSON, posted as written to an agent route, outside the conversation; checked against
  `RunAgentInputSchema` and sent even when it fails. Its answer lands in the frames.
- **Sessions**: export the exchanges, frames and run inputs of a session as a file, without headers; import one to
  read it again.

### 8.5 Capabilities

A capability has two sides: what the agent declares, and what the client does.

- **Agent capabilities**: shown by group, from the config, the agent's capabilities route, or `getCapabilities()`
  in the in-app mode.
- **Client profile**: what the inspector sends and how it behaves, each part switched on or off:
  - the `protocolVersion` it declares;
  - client tools, defined in the profile with their JSON Schema, sent in `tools`, their calls answered by hand or
    by a scripted result;
  - context entries, sent in `context`;
  - A2UI: the renderer on, or surfaces as JSON only; the `render_a2ui` tool injected through `@ag-ui/a2ui-middleware`,
    or not;
  - how interrupts and pending tool calls are answered: by hand, or automatically resolved, cancelled or answered;
  - the preset's `messages` mode and `forwardedProps`.
  Profiles are saved per browser, and export and import as JSON.
- **Consistency (1.0.0)**: frames that contradict the declared capabilities are flagged. Examples: a reasoning event
  from an agent that declares `reasoning.supported: false`, an interrupt outcome when `humanInTheLoop.interrupts` is
  false, a state delta when `state.deltas` is false. The conformance suite plays only the scenarios the declared
  capabilities allow.

### 8.6 Conformance (1.0.0)

- **Reference agent.** A scripted AG-UI server with no model: one command per scenario, every event type, every
  outcome, the round trips (interrupt, client tool, A2UI action), and the edge cases: a run error mid-message, a stream
  that stops without a terminal event, long pauses, thousands of one-character deltas, interleaved messages, chunks,
  encrypted reasoning, subagents. It serves the inspector's own end-to-end tests and lets client developers exercise a
  client without a model.
- **Server suite.** `agui-inspector test --target <url> [--profile <file>] [--report json|junit]` sends canned inputs
  to a server and checks every rule of the catalogue: protocol sequence rules, outcome shapes, id consistency,
  capability consistency. Each rule has an id and a page in the documentation.
- **Replay.** `agui-inspector replay <session file>` serves a recorded session as an AG-UI endpoint, for client tests.

## 9. Security and privacy

- No telemetry and no analytics. The page makes requests to the target only, and to its own origin for its config;
  the end-to-end tests check that no other request leaves the page.
- Credentials are kept in memory. The recorder reads no header, and exports contain none.
- The page's content security policy allows scripts from its own origin only and no `eval`. Hosted mode narrows
  `connect-src` at startup to the targets it may call.
- Embedded mode mounts nothing unless enabled, and says so in the host's log when it does (section 5).
- The CLI listens on localhost only, proxies only to the targets it was given, and passes bytes through untouched.
- Exports warn that frames may hold sensitive data. Nothing is stored server-side.
- Releases are built in CI with provenance: npm provenance, PyPI trusted publishing.

## 10. 0.1.0, the MVP

The smallest release a developer can point at their own AG-UI server and use in minutes.

### What 0.1.0 contains

- **Modes**: hosted page; embedded for Starlette and FastAPI (PyPI); the bundle on npm for any server.
- **Transport**: HTTP with server-sent events.
- **Recorder and frames**: section 7; schema check of every frame; sequence violations as the client reports them,
  attached to the run; the terminal-event rule.
- **Conversation**: section 8.2, without Markdown rendering.
- **Event views**: every event type of section 8.3. Subagents as nested markers; chunks shown as received and as
  expanded.
- **Inspection**: frames, state, raw request, session export and import.
- **Capabilities**: declared capabilities shown; client profile with protocol version, client tools answered by
  hand, context entries, the A2UI switches, the preset's `messages` mode and `forwardedProps`.
- **Config and presets**: section 6, as version 0.
- **A2UI**: v0.9, with `@a2ui/react` and `@a2ui/markdown-it`.
- **Reference agent**: one scenario per event family and per round trip, for the end-to-end tests.

### How 0.1.0 is accepted

1. The hosted page, pointed at an AG-UI SSE endpoint that allows its origin, lists every frame of a run with its
   offset and schema verdict, and renders the transcript.
2. `mount_inspector` on a FastAPI app serves the page at `/agui-inspector`, lists the agents of its config, and runs
   them on the host's own origin and authentication.
3. Every event type of section 4 renders, in the frames and in the conversation where section 8.3 says so: one
   fixture per type in the unit tests, and the reference agent in the end-to-end tests.
4. Against the reference agent: an interrupt resolved and one cancelled, a pending tool call answered, an A2UI press,
   each continued by the next run as the protocol says.
5. Each switch of the client profile changes the next `RunAgentInput` as it says, as the frames show.
6. The raw request editor sends an invalid input, flagged, and shows the server's answer.
7. A session exported and imported again shows the same exchanges and frames, without headers.
8. No request other than to the target and the page's own origin; no telemetry; no header in any export.
9. A run of 5,000 frames stays responsive. The production bundle is at most 2 MB minified and 600 KB gzipped.

### Not in 0.1.0

The CLI and its proxy, binary and WebSocket transports, reconnection, the JS server helpers, the in-app mode, a plugin
API, capability consistency checks, the conformance suite, replay, subagent lanes, state history, Markdown rendering.

## 11. 1.0.0, the target

The release that commits to stable formats and covers the whole protocol.

### What 1.0.0 contains

- **Modes**: all four of section 5, with embedded helpers for Starlette/FastAPI, Express, Hono and Next.js.
- **Transports**: server-sent events and binary (protobuf); reconnection and resumable runs through `connectAgent`;
  WebSocket and push notifications once AG-UI specifies them (section 13).
- **Rules**: a catalogue of rules, each with an id, checked without stopping the stream: sequence rules, outcome
  shapes, id consistency, the terminal event, capability consistency, protocol version handling (including the older
  event versions the client accepts).
- **Event views**: subagent lanes in the conversation and a timeline; state history with a diff per delta and a view
  of any past point; a waterfall of runs, steps, messages and tool calls; Markdown rendering on demand.
- **Capabilities**: discovery, consistency checks, automatic answers, profiles as files.
- **Conformance**: the reference agent in Python and TypeScript; the server suite with JSON and JUnit reports; replay.
- **Plugins**: a documented API for what presets cannot declare: hooks before a run and on its input, header
  providers, renderers for custom events and activity types.
- **A2UI**: v0.8, v0.9 and v1.0, as `@a2ui/web_core` supports them; catalog aliases in the config, for agents that
  name a catalog by a former id.
- **Formats**: config, session file, profile and plugin API frozen as version 1, with JSON Schemas.
- **Quality**: WCAG 2.2 AA, keyboard navigation, 50,000 frames per session, the A2UI renderer loaded on demand.
- **Documentation**: a site with a page per rule, and examples for the major AG-UI server frameworks.

### How 1.0.0 is accepted

1. Each mode of section 5 runs the reference agent's full suite of scenarios.
2. The server suite runs in CI against the reference agents in both languages, with every rule of the catalogue
   covered by a test that breaks it.
3. Each event type has a dedicated view, covered by a fixture test.
4. Formats of version 1 are published, and any change to them after 1.0.0 is additive or waits for 2.0.0.
5. An accessibility audit at WCAG 2.2 AA passes.

## 12. Repository and tooling

```text
packages/
  inspector/          TypeScript: core, views, the static bundle, the npm package (and the CLI in 1.0.0)
  python/             the PyPI package: mount_inspector, the bundle as package data
examples/
  reference-agent/    the scripted reference agent
  fastapi/            an embedded inspector in a FastAPI app
docs/
SPEC.md
```

- TypeScript in strict mode, React, esbuild, tests with `node --test`, end-to-end tests with Playwright against the
  reference agent.
- Python 3.10+, built with uv, Starlette as an optional dependency.
- CI on every pull request: types, unit tests, build, bundle budget, end-to-end tests, Python tests. Releases from tags.
- Semantic versioning. Releases before 1.0.0 may change the config and file formats; the changelog says how.

## 13. Open questions

- **License.** MIT matches AG-UI and keeps the door open upstream; A2UI's packages are Apache-2.0, which is compatible.
- **Upstream.** Whether `ag-ui-protocol/ag-ui` would take the inspector as `apps/inspector`, and before which release.
- **Names.** `agui-inspector` on npm and PyPI; `@ag-ui/inspector` if it moves upstream.
- **Capability discovery.** `@ag-ui/client`'s `HttpAgent` does not fetch capabilities, so 0.1.0 reads them from the
  config or a route the config names. 1.0.0 follows the protocol's discovery once it defines one.
- **WebSocket and push.** `AgentCapabilities.transport` names WebSocket and push notifications; which of them AG-UI
  specifies for 1.x decides what 1.0.0 implements.
- **The in-app element.** React inside a shadow root, or a lighter element library; the A2UI renderer injects its
  styles into the document, which a shadow root does not see.
