# Feature Specification: Headless sessions for tests and agents

**Feature Branch**: `worktree/inspector-mcp-for-agents-326ea2`

**Created**: 2026-11-11

**Status**: Spec and plan accepted by the maintainer on 2026-11-12. Tasks follow.

**Input**: The maintainer asked whether agui-inspector needs an MCP server so that coding agents can act on the inspector
for the developer. The first draft of this spec answered no. The maintainer then set a wider goal: use the inspector for
end-to-end and integration tests of AG-UI agents, "Playwright for AG-UI agents". A test or a coding agent loads the
inspector, drives a session, and makes assertions on the outcome: A2UI surfaces, activities, several messages in one
run, interrupts, tool calls, state. It must work for projects that use the embedded inspector too, such as a Python
server with `mount_inspector` that the developer runs locally and then asks their coding agent to drive. An independent
audit of that design ([research.md](research.md), section 3) recommended a smaller first step and a different order:
the headless engine and a test API first, the one-shot command on top, the conformance suite (#83) on that engine, and
the MCP server last. The maintainer accepted that order.

## Clarifications

### Session 2026-11-11

- Q: Is an MCP server worth building? → A: Yes, for coding agents that drive a session step by step: answer an
  interrupt, return a tool result, fire an A2UI action, read what changed. It comes last, as a thin layer over the same
  engine, once the engine's API has been used by the test API and the conformance suite (FR-030 to FR-037).
- Q: What is the goal? → A: End-to-end and integration tests of AG-UI agents, with assertions on outcomes. Coding agents
  that drive and inspect sessions for the developer are the second audience.
- Q: In what order? → A: The audit's order. Milestone 1: the headless session and the test API, with the one-shot
  command on top. Milestone 2: the conformance suite (#83) on the engine, as its own feature. Milestone 3: the MCP
  server.
- Q: Must it work with the embedded inspector? → A: Yes. The developer points the session at the agent endpoint of
  their running server, embedded or not (FR-005). Reading the embedded page's agents and presets from its
  configuration is deferred until cookie authentication and plugins have an answer (see Assumptions).
- Q: Can an agent read or drive the session open in the developer's browser? → A: Not in this feature. It needs a
  channel from the page to a local process and an amendment to principle IV. A session file and a launch link
  (feature 016) are the hand-off in both directions (User Story 5).
- Q: Which release? → A: 0.3.0 for all three milestones. Milestone 1 lands before #83, and the MCP server ships in
  0.3.0 as well (maintainer, 2026-11-12).

### Session 2026-11-12, approval

The maintainer approved this spec on 2026-11-12 and chose 0.3.0 for the MCP server. Planning follows.

The maintainer approved the plan on 2026-11-12, with the three readings of principle IV in its constitution check.

### Session 2026-11-12, analysis

The maintainer approved the fixes from `speckit-analyze`.

- Feature 005 FR-016 forbids the command any request other than its relay and any file storage of its own, and a test
  enforces it on `src/cli`. Spec 005 now carries a dated note: FR-016 governs serving the page; `run` and `mcp` follow
  FR-023, FR-037 and FR-043 here. The requests and file writes live in the headless session, outside `src/cli`.
- Principle IV requires a warning on every session export. Writing a session file from the library, `run` or `mcp` is
  an export (FR-043).
- A step of the MCP server returns the summary of what changed, not only counts (FR-031).

## User Scenarios & Testing *(mandatory)*

The actors are a developer who builds an AG-UI agent, the tests they run in CI, and the coding agent that works in their
repository and terminal. The coding agent runs commands and reads files. It has no browser the developer watches.

### User Story 1 - A test drives a session and asserts on the outcome (Priority: P1)

A developer writes an integration test for their AG-UI agent. The test opens a headless session against the agent's
endpoint, sends a message, waits until the session is idle, and checks what came back: the messages, the tool calls,
the interrupts, the activities, the state, the A2UI surfaces and the protocol findings. It answers an interrupt or
returns a tool result, waits again, and checks the next run. When the test fails, the session file it saved opens in
the page, so the developer sees every frame.

**Why this priority**: This is the product. It is deterministic, runs in CI without a model, and serves the conformance
suite (#83). The command and the MCP server are thin layers over it.

**Independent Test**: Against the reference agent's interactive scenarios over real HTTP, a test sends a message, finds
the interrupt, resolves it, waits, and finds the expected messages, state and findings.

**Acceptance Scenarios**:

1. **Given** a running agent, **When** a test opens a session and sends a message, **Then** waiting until idle returns
   once the run and every follow-up run have ended, and the test can read the messages, tool calls, interrupts,
   activities and state as the page's conversation view would show them.
2. **Given** a run that pauses on an interrupt, **When** the test resolves or cancels it, **Then** the next run is sent
   as the page would send it and is recorded in the same session.
3. **Given** a run that pauses on a client tool call, **When** the test returns a result, **Then** the next run carries
   it as the page would.
4. **Given** a run that sends A2UI v0.9 messages, **When** the test reads the surfaces, **Then** it gets each surface's
   components and data model as the page holds them, and it can fire an action on a component, which is sent as the
   page would send it.
5. **Given** any run, **When** the test reads the findings, **Then** they match the page's findings for the same run,
   by rule id.
6. **Given** a malformed or fragmented stream, a non-JSON frame or a missing terminal event, **When** the test reads the
   frames, **Then** they are exactly as received, in arrival order, and nothing is repaired, dropped or reordered.
7. **Given** a run input that fails the protocol schema, **When** the test sends it as a raw input, **Then** it is sent
   unchanged and recorded with a finding.
8. **Given** a run that never ends, **When** the time limit passes, **Then** waiting returns, capture stops, what was
   received is kept, and the exchange is marked stopped.
9. **Given** a session, **When** the test saves it, **Then** the file is the version-0 session file that Export session
   writes, and the page imports it with the same exchanges, frames and findings.

---

### User Story 2 - One command runs an input and reports findings (Priority: P1)

A coding agent fixing a server, or a CI step, runs one command with the target, any headers, and a run input or a
message. The command runs it through the same headless session, writes the session file and exits with a code that says
whether findings were found.

**Why this priority**: The quickest use for an agent with a shell and for CI scripts that are not written in
JavaScript, such as a Python project's pipeline. It costs little once User Story 1 exists.

**Independent Test**: Run the command against a reference agent scenario with a known protocol error, and check the
session file and the exit code.

**Acceptance Scenarios**:

1. **Given** a running target and a run input, **When** the command runs, **Then** it writes one session file and exits
   with the code for "no findings" or "findings".
2. **Given** a client profile with automatic replies (feature 004), **When** the command runs a scenario that pauses,
   **Then** it answers as the page would and stops at the same automatic-reply limit.
3. **Given** an unreachable target, a non-2xx answer or the time limit, **When** the command runs, **Then** it writes
   what it recorded and exits with the code for "could not complete the run".

---

### User Story 3 - A coding agent drives a session step by step (Priority: P2)

The developer runs their agent locally and asks their coding agent to explore it: send a message, look at the frames
and findings, answer the interrupt, press the button on the A2UI surface, check the state, and then write a test from
what it saw. The coding agent does this through MCP tools that keep the session open between calls.

**Why this priority**: The maintainer's second audience. It comes last because it adds no capability the engine lacks;
it only exposes the engine as tools.

**Independent Test**: An MCP client, scripted without a model, calls the tools in order against the reference agent's
interactive scenario and gets the same messages, frames and findings as User Story 1.

**Acceptance Scenarios**:

1. **Given** the MCP server started with a target and headers, **When** a client opens a session and sends a message,
   **Then** the tool result says when the session is idle and summarizes the new messages, interrupts, tool calls,
   surfaces and findings.
2. **Given** a session with many frames, **When** the client reads frames, **Then** results are paged and each page has
   a size limit.
3. **Given** a header passed to the server, **When** any tool returns, **Then** the header value is absent from every
   result and every message the server writes.
4. **Given** any tool result that holds data from the target, **When** the client receives it, **Then** that data is
   marked as untrusted target content, separate from the tool's own text.
5. **Given** a session, **When** the client asks to save it, **Then** the server writes a session file the page can
   import.

---

### User Story 4 - It works with an embedded Python project (Priority: P2)

A developer has a Python server that exposes an AG-UI agent and mounts the embedded inspector. They start it locally.
Their test, the command or their coding agent points a headless session at the agent's endpoint on that server and
gets everything in User Stories 1 to 3.

**Why this priority**: The maintainer requires it. It needs no change to the Python package; the docs show it.

**Independent Test**: Start the FastAPI example in `examples/fastapi`, point the command at its agent endpoint, and get a
session file with frames and findings.

**Acceptance Scenarios**:

1. **Given** a locally running embedded Python server without authentication, **When** a headless session targets its
   agent endpoint, **Then** runs behave as against any other target.
2. **Given** a server that needs a token or a cookie, **When** the developer passes it as a header from an environment
   variable, **Then** the target receives it and it appears nowhere in outputs.
3. **Given** the docs page, **When** a Python developer reads it, **Then** it states that the command and the MCP server
   need Node on the developer's machine, and that the Python package itself is unchanged.

---

### User Story 5 - The agent hands the session to the developer (Priority: P3)

After driving a session, the coding agent saves the session file and tells the developer its path; the developer
imports it in the page, embedded or not. Or the agent builds a launch link (feature 016) to the developer's page and
opens it, so the developer can try the same message themselves. The other way round, the developer exports a session
from the page and gives the agent the path; the agent opens it in a headless session to read it.

**Why this priority**: Session files and feature 016 already exist; this story is mostly docs plus loading a file into
a headless session.

**Independent Test**: Save a headless session, import it in the page; export from the page, load it headless; check
both ways that frames and findings are equal.

**Acceptance Scenarios**:

1. **Given** a session file from the page, **When** a headless session loads it, **Then** it can be read like a live one,
   and it cannot send a run.
2. **Given** feature 016 has merged, **When** the agent follows the docs page, **Then** it builds a link in 016's format,
   and the docs page links to 016 rather than repeating it.

---

### Edge Cases

- The target URL holds credentials, a query or a fragment: refused, with the rules and messages of the command of
  feature 005.
- A header value would appear in an error from the network layer: the message names the target, never the value.
- The agent under test is backed by a model and answers differently each time: the test API offers assertions on
  structure (an interrupt exists, a surface has a button with this label, a rule fired) as well as exact equality.
- Two sessions run at the same time in one process or one MCP server: each keeps its own thread, headers and frames.
- A preset that needs preparation requests, or a plugin with a hook or a header provider: not run headless in this
  feature. A test that needs a preparation step makes that request itself and passes the result in the run input.
- A2UI v0.8 surfaces: frames and findings are available; the surface model is not (see Assumptions).
- The output file exists: replaced only when asked; otherwise the command refuses and writes nothing.

## Requirements *(mandatory)*

### Functional Requirements

Headless session (milestone 1)

- **FR-001**: The npm package MUST offer a headless session that runs outside a browser and uses the same recording,
  frame reading, protocol checks, client behavior and session format as the page.
- **FR-002**: A session MUST be able to: send a message; send a run input unchanged, valid or not; resolve or cancel an
  interrupt; return a client tool result; fire an action on an A2UI v0.9 component; stop the current capture.
- **FR-003**: A session MUST be able to report: exchanges and frames as received; findings with rule ids; the
  conversation as the page projects it (messages, tool calls, interrupts, activities, subagent runs); the state and its
  history; A2UI v0.9 surfaces with components and data model; what is pending (interrupts, tool calls).
- **FR-004**: A session MUST offer a wait that returns when no run is active and nothing is pending except what needs
  the caller, or when a time limit passes. A time limit MUST always apply, with a default the caller can change.
- **FR-005**: A session MUST target an agent endpoint by URL with the rules of feature 005 (absolute http or https, no
  credentials, query or fragment). Headers belong to that target and stay in memory.
- **FR-006**: A session MUST accept a client profile, including automatic replies and their limit (feature 004) and the
  encoding (feature 013).
- **FR-007**: A session MUST save to and load from a version-0 session file. A loaded session MUST be read-only.
- **FR-008**: Frames MUST keep raw bytes, arrival order and timing, including non-JSON, invalid and binary frames.
  Nothing is dropped, repaired or reordered. The recorder MUST NOT read headers.
- **FR-009**: For the same run, the headless session and the page MUST record the same frames and the same findings by
  rule id. A test MUST check this for every reference agent scenario.
- **FR-010**: A session MUST allow its clock and identifiers to be fixed, so a test against a scripted agent produces the
  same session file each time.

Test API (milestone 1)

- **FR-011**: The npm package MUST offer the headless session as a library entry for JavaScript and TypeScript tests,
  usable from the Node test runner and the common test frameworks without adapters.
- **FR-012**: The library MUST offer assertions on structure: a message with this role and text pattern exists, an
  interrupt or a tool call with this name is pending, a surface has a component of this type with this property, a rule
  id fired or did not fire, the state matches a partial value. A failed assertion MUST say what it expected and what it
  found, and MUST be able to save the session file next to the failure.

One-shot command (milestone 1)

- **FR-020**: The command MUST offer a way to run one message or run input against one target through a headless
  session, with optional headers, client profile, time limit and output path, and write one session file.
- **FR-021**: The exit code MUST tell apart: no findings, findings, could not complete the run, wrong arguments. A docs
  table MUST list them.
- **FR-022**: The session file MUST go to standard output when no output path is given, and every message MUST go to
  standard error.
- **FR-023**: The command MUST open no listening socket and MUST connect only to its target.

MCP server (milestone 3)

- **FR-030**: The command MUST offer an MCP server over standard input and output only. It MUST open no listening
  socket.
- **FR-031**: Its tools MUST map one to one to the headless session's actions and reports (FR-002, FR-003, FR-004,
  FR-007), with sessions named by an id the server returns. A tool that takes a step MUST return the step and a summary
  of the new messages, interrupts, tool calls, surfaces and findings.
- **FR-032**: Targets and headers MUST be given when the server starts, not in tool inputs. Header values MUST NOT
  appear in any tool result, log or file.
- **FR-033**: Tool results that hold data from the target (frames, messages, tool arguments, surface text, state) MUST
  be marked as untrusted target content, apart from the tool's own text.
- **FR-034**: Results MUST be bounded: frames and long lists are paged, each result has a size limit, and a cut is said
  in the result.
- **FR-035**: A tool MUST NOT wait longer than its time limit. A run continues in the background, and a later call can
  wait again.
- **FR-036**: The server MUST be able to run several sessions at once without sharing threads, headers or frames.
- **FR-037**: The server MUST send no request except to its targets, and no telemetry.

Shared

- **FR-040**: All new code MUST stay out of the page bundle.
- **FR-041**: Tests MUST search every output (files, standard output and error, exit messages, tool results) for a
  synthetic header value. A frame in which the target itself echoes the value is evidence and keeps it (principle IV);
  the value appears nowhere else.
- **FR-042**: The docs site MUST have a page for tests and coding agents. It covers the test API, the command, the MCP
  server once it ships, the embedded Python case, the hand-off through session files and launch links, passing a token
  through an environment variable, and two warnings: a session file and every tool result can hold sensitive data from
  the target, which an agent sends to its model provider; and target data in a tool result can contain text written to
  mislead the agent.
- **FR-043**: Writing a session file is an export under principle IV. The command MUST print a warning to standard error
  each time it writes one, the MCP server's save result MUST carry the warning in its own text, and the library's `save`
  MUST document it. The warning says that raw frames and request bodies may contain personal or sensitive data,
  including a credential the target echoed, and that headers are not in the file.

### Key Entities

- **Headless session**: one conversation with one target, held in memory. It has a thread, headers in memory, a client
  profile, the recorded exchanges, frames and findings, and what is pending. Live or loaded from a file.
- **Session file**: the version-0 file Export session writes. Holds exchanges, runs, frames and findings, no headers.
- **Finding**: a rule hit with a rule id from the catalogue (feature 007).
- **Launch link**: defined by feature 016. Referred to only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every reference agent scenario, a headless session and the page record the same frames in the same
  order and the same findings by rule id.
- **SC-002**: A test for the reference agent's interrupt scenario (send, resolve, wait, assert) fits in 20 lines.
- **SC-003**: A coding agent with only a shell and the docs page can find the failing rule for a broken scenario without
  opening a browser.
- **SC-004**: A synthetic header value is absent from every output listed in FR-041.
- **SC-005**: Milestone 1 adds no runtime dependency and nothing to the page bundle.
- **SC-006**: Against the reference agent, a headless run takes at most one second longer than the scenario takes to
  stream.

## Assumptions

- Milestone 2 is the conformance suite (#83), specified on its own. It is listed here only to fix the order.
- The engine is the existing framework-free core. Its unit tests already run the runtime in Node, and the audit ran it
  over real HTTP against the reference agent (research.md, section 3).
- A2UI: the v0.9 surface model is in scope. It needs a catalog that does not use React, which the plan must provide.
  v0.8 surfaces exist only inside the React renderer today, so their model is out of scope. Rendered checks (what the
  renderer draws) are out of scope: they need a browser, and browser automation on the page with a launch link already
  covers them.
- Presets, variables, preparation requests and plugins are not run headless in this feature. Reading agents and presets
  from an embedded page's configuration is deferred until cookie authentication and plugin loading have an answer.
- The Python package does not change. Python projects use the command (and later the MCP server), which needs Node on
  the developer's machine. A pytest helper may come later through the command.
- Driving the session open in the developer's browser is out of scope (Clarifications).
- A token reaches the session through an environment variable that the shell expands, so a coding agent writes the
  variable's name and never sees the value.
