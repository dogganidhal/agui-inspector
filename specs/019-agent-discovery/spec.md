# Feature Specification: Agent discovery

**Feature Branch**: `worktree/agent-discovery-for-embedded-inspectors-e9e87b`

**Created**: 2026-11-12

**Status**: Spec and plan approved by the maintainer on 2026-11-12. Implemented.

**Input**: Feature 018 explains how a coding agent uses the inspector once it knows about it: the testing library,
`agui-inspector run` and `agui-inspector mcp`. A coding agent that works in an adopter's repository does not know that.
In a Python server that calls `mount_inspector`, nothing tells the agent that the inspector is mounted, where it is,
which agents it knows, or that docs exist. The same holds for the Express, Hono and Next.js helpers and for the command.
This feature lets an agent find out, with no prior knowledge, from the project and the running server alone.

## Clarifications

### Session 2026-11-12

- Q: Does the startup output name the guide? → A: Yes, in every mode. The helpers' startup warning keeps its text and
  adds the guide's address at the end. The command's listening output adds a line with the guide's full URL (FR-008).
- Q: Is a Python helper that builds launch links in scope? → A: No. The guide shows how to build a link with the
  standard library of the agent's language and links to the launch link docs. The wheel's API does not change (FR-013).
- Q: Where do the guide's docs copy and the paste-ready blocks live? → A: On a new docs page about pointing a coding
  agent at the inspector. The tests and agents page, the embedding page and the command page link to it (FR-011,
  FR-012).

### Session 2026-11-12, approval

The maintainer approved the spec and the plan on 2026-11-12. Tasks follow.

## User Scenarios & Testing *(mandatory)*

The actors are a developer who embeds or runs the inspector, and the coding agent working in their repository and
terminal. The agent reads files, runs commands and can fetch URLs on the developer's local server. It has never heard of
agui-inspector.

### User Story 1 - The running server tells the agent how to use the inspector (Priority: P1)

The developer runs their server with the inspector enabled and asks their coding agent to check the agent endpoint. The
agent sees the inspector's address in the server's startup output, or in the code that mounts it, or in the page it
fetched. Next to the page it finds a short guide written for agents. The guide says what the inspector is, where the
page is, where the list of configured agents is, how to open the page with an agent and a first message filled in, how
to run one input or start the MCP server against the agent's endpoint, and where the docs are.

**Why this priority**: This is the gap. The agent cannot use what it cannot find, and the running server is the one
place that knows the mount path.

**Independent Test**: Start each mode (Python embedded, Express, Hono, Next.js, the command, the static files) and
fetch the guide next to the page. It answers with the same text in every mode, and the text names the page, the agent
list, launch links, `run`, `mcp` and the docs.

**Acceptance Scenarios**:

1. **Given** a server with the inspector mounted at a path, **When** the agent fetches the guide at that path,
   **Then** it gets the guide as plain text.
2. **Given** the guide, **When** the agent follows its instructions, **Then** it finds the configured agents next to
   the page, builds a launch link to the page, and starts `agui-inspector run` against an agent's endpoint, without
   other knowledge.
3. **Given** a server whose own authentication guards the mount, **When** an unauthenticated client asks for the guide,
   **Then** it is refused exactly as the page is.
4. **Given** a helper that is not enabled, **When** a client asks for the guide, **Then** nothing answers, as for the
   page.
5. **Given** the server starts with the inspector enabled, **When** the agent reads the startup output, **Then** the
   output names the guide's address.

---

### User Story 2 - The project's own agent instructions point to the inspector (Priority: P2)

The developer wants every agent session in their repository to know about the inspector before it reads any code. The
docs give them a short block to paste into their `AGENTS.md` or `CLAUDE.md`, in one variant for a Python server with
the embedded inspector, one for the JavaScript helpers and one for the command. They fill in their mount path and agent
endpoint.

**Why this priority**: It works before the server runs and in every agent tool that reads those files. It needs the
developer to act once.

**Independent Test**: Read the docs page. It has three blocks, each with the guide's address, the page, the commands
and the docs, and none holds a credential or a value to keep secret.

**Acceptance Scenarios**:

1. **Given** the docs page, **When** the developer copies the block for their setup, **Then** it needs at most the mount
   path and the agent endpoint filled in.
2. **Given** a block that mentions authentication, **When** the agent reads it, **Then** it says to take credentials
   from the environment and never names a value.

---

### User Story 3 - The code that mounts the inspector points to the guide (Priority: P3)

The agent reads the server code, sees `mount_inspector` or one of the JavaScript helpers, and looks at its
documentation in the installed package. That documentation says that a guide for agents is served at
`<path>/llms.txt` and links to the docs page.

**Why this priority**: Agents often read a library's docstrings before running anything. It costs one sentence per
helper.

**Independent Test**: The docstring of `mount_inspector`, the documentation of each JavaScript helper and the npm
package README name the guide.

**Acceptance Scenarios**:

1. **Given** the installed Python package, **When** the agent reads `mount_inspector`'s docstring, **Then** it names the
   guide's path and the docs.

---

### Edge Cases

- The inspector is mounted under an outer prefix or behind a proxy that strips one. The guide names the page and the
  agent list relative to its own address, so it holds under any prefix.
- The guide's address ends in a file name, so it never hits the redirect from the bare mount path.
- The host serves its own file with the same name elsewhere. The guide lives only below the mount and does not claim
  the site root.
- The adopter deploys the static files on their own server (hosted mode). The guide ships with them and holds nothing
  specific to embedded mode that would mislead there.
- The public demo serves the guide too. That is harmless: the guide describes the inspector, not a host.
- An agent follows a launch link instruction with a credential. Launch links refuse credential keys (feature 016); the
  guide says so and says where credentials go instead.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every build of the page MUST include a guide for coding agents, served next to the page as `llms.txt`,
  following the llms.txt convention: a title, a one-line summary, short sections, and links to the docs.
- **FR-002**: The Python helper, the Express, Hono and Next.js helpers, the command and the npm static assets MUST serve
  or ship the guide at `<page>/llms.txt` with no setup by the adopter.
- **FR-003**: The guide MUST be the same bytes in every mode. It MUST NOT contain values from the host's configuration,
  and nothing generates it per request.
- **FR-004**: The guide MUST say what the inspector is, that the page is the directory the guide is in, that
  `config.json` next to it lists the configured agents with their endpoints, how to build a launch link (with a link to
  the launch link docs rather than a copy of the format), how to run `agui-inspector run` and `agui-inspector mcp`
  against an agent endpoint and not against the page, how to pass a credential from the environment, and where the docs
  are.
- **FR-005**: The guide and the paste-ready blocks MUST NOT contain a credential, a header value or any value an adopter
  must keep secret. A test MUST check it.
- **FR-006**: The guide MUST be served through the same routes as the page, so the host's authentication, the `enabled`
  gate and the mount path apply to it as they apply to the page. A test MUST check the guarded case in embedded mode.
- **FR-007**: Every mode MUST serve the guide as UTF-8 plain text.
- **FR-008**: The startup output MUST name the guide's address. The helpers' startup warning keeps its current text,
  which still names the mount path, and ends with the guide's path. The command's listening output adds one line with
  the guide's full URL. Neither prints a header or a credential.
- **FR-009**: The page MUST point to the guide in its HTML, with the link relation the llms.txt convention recommends,
  so an agent that fetches the page finds it.
- **FR-010**: The docstring of `mount_inspector`, the documentation of each JavaScript helper and the npm package README
  MUST name the guide's path and the docs. The Python package has no README of its own, so its docstring carries it.
- **FR-011**: A docs page about pointing a coding agent at the inspector MUST hold the guide exactly as served, and a
  test MUST keep the two equal. The tests and agents page, the embedding page and the command page MUST link to it.
- **FR-012**: That page MUST publish a block ready to paste into a project's `AGENTS.md` or `CLAUDE.md`, in three
  variants: Python embedded, JavaScript helpers, and the command.
- **FR-013**: The Python package MUST NOT gain a launch link helper in this feature. The guide shows how to build a link
  with the standard library and links to the launch link docs.

### Key Entities

- **Agent guide**: one static text file for coding agents, shipped with the page and served next to it. It describes
  the inspector, never the host.
- **Paste-ready block**: a short text for a project's agent instruction file, in three variants, with placeholders for
  the mount path and the agent endpoint.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In all six modes, a request for `<page>/llms.txt` returns the guide, byte for byte the same.
- **SC-002**: An agent that knows only the server's address and the startup output reaches the guide in one request.
- **SC-003**: From the guide alone, an agent can name the page, the configured agents and the command to run one input
  against one of them.
- **SC-004**: No served guide and no published block contains a credential or header value, checked on every pull
  request.
- **SC-005**: The guide in the docs and the served guide never differ, checked on every pull request.

## Assumptions

- Agents can fetch URLs on the developer's local server, or the developer pastes the guide. Agents that cannot do
  either rely on the paste-ready block.
- The launch link format of feature 016 (#109) is the one the guide links to. If 016 changes before it merges, the guide
  follows it.
- `agui-inspector run` and `agui-inspector mcp` are the commands of feature 018 (#110). The guide names them as they are
  there.
- The docs site keeps its address, `https://dogganidhal.github.io/agui-inspector/docs/`. The guide links to it with
  full URLs.
- An `llms.txt` for the docs site itself is a separate change and out of scope here.
