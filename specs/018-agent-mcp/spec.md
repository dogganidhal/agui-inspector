# Feature Specification: Agent access to the inspector

**Feature Branch**: `worktree/inspector-mcp-for-agents-326ea2`

**Created**: 2026-11-11

**Status**: Draft. Waiting for the maintainer's go or no-go. No plan until then.

**Input**: The maintainer asked whether agui-inspector needs an MCP server so that coding agents can act on the
inspector for the developer. Candidate uses: build a launch link (feature 016) and open it, run a scenario against a
target and get back the recorded frames and rule findings without a browser, read the session the developer just
recorded, and send a raw request. The question to answer first: what would an agent do with an MCP server that it cannot
already do with the command of feature 005, the launch link of feature 016, session file export and plain HTTP?

[research.md](research.md) answers that question tool by tool. Its conclusion: three of the four uses already work, or
will work once feature 016 lands, with a shell and a documented format. Only one is missing: a run without a browser that
returns the frames and the rule findings. A coding agent has a shell, so a command does that job as well as an MCP tool,
and it adds no dependency. This spec therefore describes a command and a docs page. An MCP server is out of scope, and
research.md records when to look at it again.

## Clarifications

None yet. The three open questions are marked below and listed in research.md, section 7.

## User Scenarios & Testing *(mandatory)*

The actors are a developer who builds or integrates an AG-UI server, and the coding agent that works in the developer's
repository and terminal for them. The agent runs commands, reads files and edits code. It has no browser of its own that
the developer watches.

### User Story 1 - The agent runs an input against a target and reads the result (Priority: P1)

The developer asks their agent to fix an AG-UI server. The agent changes the code, then wants to know whether the server
now answers correctly. It runs one command with the target, any headers, and the run input (or a single user message).
The command sends the run like the page would, records every exchange and frame exactly as received, applies the same
protocol checks as the page, and writes the result as a session file. The agent reads the frames and the rule findings,
fixes what is wrong and runs it again. The developer can open the same file in the page to see what the agent saw.

**Why this priority**: This is the one use that has no answer today. Plain HTTP returns the bytes but not the findings,
and the findings (sequence rules, schema checks, capability checks) are what the inspector adds. It is also the engine
that the conformance suite (issue #83) needs: that suite plays canned inputs against a target and reports rule findings.

**Independent Test**: Start the reference agent, run the command against one of its scenarios with a known protocol
error, and check that the output is a valid session file that holds every frame in order and the expected finding, and
that the exit code says findings were found.

**Acceptance Scenarios**:

1. **Given** a running target and a run input, **When** the agent runs the command, **Then** it writes one session file,
   in the same version-0 format as Export session, that holds the exchange, the run, every frame as received and every
   finding, and it ends with the exit code for "ran, no findings" or "ran, with findings".
2. **Given** a target that sends a malformed or fragmented stream, a non-JSON frame or no terminal event, **When** the
   command runs, **Then** the file keeps those frames byte for byte in arrival order with their findings, and nothing is
   repaired, dropped or reordered.
3. **Given** a header passed for the target, **When** the command runs, **Then** the target receives it, and its value
   appears nowhere in the output file, standard output, standard error or the exit message.
4. **Given** a run that pauses on an interrupt or a client tool call, **When** the agent passes a client profile with
   automatic replies (feature 004), **Then** the command answers as the page would, records the follow-up runs, and
   stops at the same automatic-reply limit.
5. **Given** a run input that does not pass the protocol schema, **When** the agent passes it, **Then** the command sends
   it unchanged and records a finding for it, as the raw request editor does.
6. **Given** a target that never ends the stream, **When** the time limit passes, **Then** the command stops capture,
   keeps what it received, marks the exchange as stopped, writes the file and exits with the code for "stopped".
7. **Given** the file the command wrote, **When** the developer imports it in the page, **Then** the page shows the same
   exchanges, frames and findings.

---

### User Story 2 - The agent reads a session the developer recorded (Priority: P2)

The developer reproduced a bug in the page and wants the agent to look at it. They press Export session, save the file in
the repository or another folder, and give the agent the path. The agent reads the file without help from the inspector,
using the published description of the format.

**Why this priority**: It already works. The export holds every exchange, frame and finding, and the format is documented
in the recordings page. What is missing is a page written for agents that says where to look in the file. No code
changes.

**Independent Test**: Follow the docs page with the reference agent: record a run in the page, export it, and check that
every field the page tells an agent to read exists in the file.

**Acceptance Scenarios**:

1. **Given** an exported session, **When** an agent follows the docs page, **Then** it can find the runs, each run's
   frames in order, each frame's raw text and event type, and each finding with its rule id.
2. **Given** the docs page, **When** a developer reads it, **Then** it states that the file can contain sensitive data
   from the target and that giving it to an agent sends that data to the agent's model provider.

---

### User Story 3 - The agent opens the page prefilled for the developer (Priority: P3)

After a fix, the agent wants the developer to try the server themselves. It builds a launch link (feature 016) with the
endpoint, preset, variables and first message, and opens it in the developer's browser with the system's usual open
command. The developer presses send.

**Why this priority**: Feature 016 delivers the link. This feature only documents how an agent builds and opens it. It
depends on 016 and adds no behavior.

**Independent Test**: With feature 016 merged, follow the docs page to build a link for the reference agent, open it,
and check that the page shows the prefilled values.

**Acceptance Scenarios**:

1. **Given** feature 016 has merged, **When** the agent follows the docs page, **Then** it builds a link in the format
   that feature 016 defines, and the docs page links to 016's description rather than repeating it.
2. **Given** a target that needs a token, **When** the agent builds a link, **Then** the docs page tells it that a link
   never carries a credential and that the developer types the token in the page or passes it to the command of
   feature 005.

---

### Edge Cases

- The target cannot be reached, refuses the connection, or answers with a non-2xx status: the command records the
  exchange as the page would, writes the file, and exits with the code for "could not complete the run". The message
  names the target number, never a header.
- The target URL holds credentials, a query or a fragment: refused with the same rules and messages as the command of
  feature 005.
- The output file exists: it is replaced only when the agent asks for that; otherwise the command refuses and writes
  nothing.
- Standard output is the file when no output path is given. Every message goes to standard error, so the output stays
  valid JSON.
- The agent stops the command (interrupt signal): capture stops, the file is written with what was received, and the
  exchange is marked stopped.
- The target answers in the protobuf encoding (feature 013), chosen in the profile: binary frames are kept as the export
  keeps them.
- A preset that needs preparation requests: out of scope for the first version (see Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The command-line tool MUST offer a way to run one conversation run against one target without a browser,
  given the target, optional headers for it, and either a run input or a single user message.
- **FR-002**: It MUST record every exchange and frame with the same rules as the page: raw content, arrival order and
  timing kept, including non-JSON, invalid and binary frames. Nothing is dropped, repaired or reordered.
- **FR-003**: It MUST apply the same protocol checks as the page and record the same findings with the same rule ids,
  so that a run in the page and the same run from the command give the same findings.
- **FR-004**: It MUST write the result as one session file in the format that Export session writes, so the page can
  import it and the same docs describe it.
- **FR-005**: A run input that fails the protocol schema MUST be sent unchanged and recorded with a finding, never
  rejected or corrected.
- **FR-006**: It MUST accept a client profile file and, with it, answer interrupts and client tool calls automatically
  as the page does under feature 004, including its limit on automatic replies.
- **FR-007**: Header values MUST stay in memory. They MUST NOT appear in the output file, on standard output or standard
  error, in an exit message or in any other file. The recorder MUST NOT read headers. Tests MUST search all outputs for
  a synthetic header value.
- **FR-008**: Target URLs and headers MUST follow the rules of feature 005: an absolute http or https URL without
  credentials, query or fragment, and headers that belong to the target before them.
- **FR-009**: The command MUST open no listening socket and MUST connect only to the target it was given. It MUST send
  no telemetry and no other request.
- **FR-010**: The command MUST end a run that does not finish within a time limit the agent can change, keep what it
  received, and mark the exchange as stopped.
- **FR-011**: The exit code MUST tell apart: ran with no findings, ran with findings, could not complete the run
  (unreachable, non-2xx, stopped), and wrong arguments. A docs table MUST list the codes.
- **FR-012**: Messages MUST go to standard error, so that a file written to standard output stays valid JSON.
- **FR-013**: The docs site MUST have a page for coding agents that covers: running the command and reading its output,
  reading an exported session, building and opening a launch link of feature 016 (by linking to its description), how to
  pass a token without it entering the agent's context, and the warning that a session file can hold sensitive data that
  an agent will send to its model provider.
- **FR-014**: The new code MUST stay out of the page bundle, as the command of feature 005 does.
- **FR-015**: Scope of an MCP server: [NEEDS CLARIFICATION: Is an MCP server in scope at all? Recommended: no. The
  command plus the docs page give a coding agent every use in research.md without a new dependency. Alternative: add
  `agui-inspector mcp` over stdio with one tool that wraps FR-001, built on the same code, with a pinned MCP SDK.]
- **FR-016**: Release: [NEEDS CLARIFICATION: Which release carries this? Recommended: 0.3.0, before the conformance
  suite (#83), which reuses the headless run. Alternative: after 0.3.0.]
- **FR-017**: Reading the session that is open in the developer's page, without an export, is [NEEDS CLARIFICATION:
  out of scope? Recommended: yes, out of scope. A session lives in the browser only (constitution principle IV:
  "Captured sessions MUST NOT be stored server-side"). Sending it from the page to a local process needs a constitution
  amendment and a new channel from the page, and one click on Export session already gives the agent the same data.]

### Key Entities

- **Headless run**: one invocation of the command. It has one target, optional headers held in memory, a run input or a
  message, an optional client profile, a time limit and an output path. It produces one session file and one exit code.
- **Session file**: the version-0 file that Export session writes. It holds exchanges, runs, frames and findings, and
  no headers. Both the page and the command write it, and the page imports it.
- **Finding**: a rule hit on a frame or a run, with a rule id from the rule catalogue (feature 007).
- **Launch link**: defined by feature 016. This feature only points to it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every reference agent scenario, the session file from the command and an export of the same run from
  the page hold the same frames in the same order and the same findings by rule id.
- **SC-002**: A coding agent that only has a shell and the docs page can run an input against the reference agent, read
  its findings, and name the failing rule, without opening a browser.
- **SC-003**: A synthetic header value passed to the command is found in none of: the output file, standard output,
  standard error, any other file the command writes.
- **SC-004**: The command adds no runtime dependency and nothing to the page bundle.
- **SC-005**: A run against the reference agent takes no more than one second longer from the command than the same
  scenario takes to stream, measured on the CI machine.

## Assumptions

- The agents in view are coding agents that run in the developer's terminal or repository and can run commands. A chat
  client without a shell is not in view; research.md names it as the reason to revisit an MCP server.
- One run per invocation, plus the follow-up runs that automatic replies start. A multi-turn conversation built over
  several invocations is out of scope.
- Presets, variables, preparation requests and plugins are out of scope for the first version. An agent that needs a
  preparation step can make that request itself and put the result into the run input. The page keeps all of them.
- Feature 016 defines the launch link. This feature depends on it for User Story 3 and does not repeat its format. As of
  2026-11-11 its branch has no commits, so the docs page is written once 016 merges.
- The conformance suite (issue #83) and replay (issue #84) remain separate features. The suite may reuse the headless
  run.
- The developer passes a token to the command through an environment variable that the shell expands, so the agent
  writes the variable's name and never sees its value. No new option is needed for that.
