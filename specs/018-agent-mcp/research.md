# Research: Agent access to the inspector

**Feature**: [spec.md](spec.md) | **Date**: 2026-11-11

The maintainer asked whether agui-inspector needs an MCP server so that coding agents can act on it for the developer.
This file answers the question before any plan: what an agent can already do, what each candidate MCP tool would add,
and the smallest thing worth building.

## 1. What an agent can do today

A coding agent works in the developer's repository and terminal. It can run commands, read and write files, and make
HTTP requests with `curl`. It cannot see the developer's browser tab.

| Need | Today | Gap |
| --- | --- | --- |
| Open the page for the developer | `npx agui-inspector --target <url>` (feature 005), then `open http://127.0.0.1:4747/` | The page opens empty. Feature 016 adds the prefilled launch link. |
| Send a run and see the raw stream | `curl -N -X POST <target> -d @input.json` | Bytes only. No frame split, no schema check, no sequence or capability findings. |
| Send a raw or invalid request | `curl` | None. `curl` sends exactly what it is given. |
| Read what the developer recorded | Developer presses Export session, gives the agent the path, agent reads the JSON | One click by the developer. The format is documented in `recordings.mdx`, but no page says where an agent should look. |
| Get rule findings for a run | Only in the page | **Missing.** The checks run in `src/core` (frame reader, `core/rules`, `@ag-ui/client` verification), and nothing outside the page calls them. |

Checked in the code on this branch:

- `src/core` has no browser globals: a search for `window` and `localStorage` under `packages/inspector/src/core`
  finds nothing. The recorder needs `fetch`, streams, `TextDecoder` and a clock, which Node 24 has. The runtime
  (`core/runtime/index.ts`, `createRuntime`) takes its store, policy, settings, `fetch`, UUID source and clock as
  options. Running it in Node looks possible. The plan must confirm it with a test before relying on it.
- The session file (`core/session-files`) already holds exchanges, runs, frames and findings, and by construction no
  headers: export copies an explicit list of fields, and no record has a header field.
- The command (`src/cli/args.ts`) keeps a first positional argument free for later commands ("replay, the conformance
  suite"), so a new command name fits without breaking the current options.

## 2. Candidate MCP tools, one by one

For each tool: what it would do, what the agent does without it, and the value an MCP tool adds over that.

| Candidate tool | Without MCP | What MCP adds | Value |
| --- | --- | --- | --- |
| `open_launch_link` (build a 016 link and open it) | Agent reads the 016 docs, builds the URL, runs `open <url>` | A typed schema for the link fields. The link format is already a public contract, so the schema duplicates it. | Low |
| `run_scenario` (run against a target, return frames and findings, no browser) | Nothing gives the findings | The findings. But a command gives the same thing to an agent with a shell, and it is also the engine the conformance suite (#83) needs. | High for the capability, none for MCP as the carrier |
| `read_session` (the session the developer just recorded) | Export session, then read the file | Reading the live session with no export. That needs the page to send its session to a local process, which principle IV forbids ("Captured sessions MUST NOT be stored server-side") without an amendment, and a new channel from the page. It saves one click. | Low, high cost |
| `send_raw_request` | `curl` | Nothing, unless it also records and checks. Then it is `run_scenario` with an unchanged input. | None |

What MCP would add in general:

- **Discovery.** The agent sees typed tools without reading docs. A docs page and `--help` do the same job for a coding
  agent, which reads both well.
- **Agents without a shell.** A chat client with MCP support and no terminal could use the inspector. This is the one
  case where MCP gives a capability a command cannot. It is not the audience the maintainer described (coding agents
  acting for the developer), and those agents all run commands.
- **Credential handling.** Not better. An MCP server configured with a header in its launch arguments puts the token in
  a config file the agent can read. A command run as `--header "Authorization: Bearer $TOKEN"` has the shell expand the
  variable, so the agent writes only the variable name. Neither is airtight, and the second needs no new code.

What MCP would cost:

- A dependency (the official SDK) with its own transitive tree, an exact pin and a row in `dependencies.mdx`, or a
  hand-written JSON-RPC loop over stdio (newline-delimited JSON-RPC 2.0, about 150 lines) that the repository would own.
- A second interface to keep in step with the command: tool schemas, error shapes, docs and tests for both.
- A long-running process holding headers in memory for the agent's whole session, where a command holds them for one run.

## 3. Recommendation

Do not build an MCP server now. Build the one missing capability as a command, and document the rest for agents.

1. **A headless run in the command** (spec User Story 1). One invocation: one target, optional headers, a run input or a
   message, an optional client profile, a time limit. It writes a version-0 session file and exits with a code that says
   whether findings were found. It reuses `src/core` (recorder, frame reader, rules, runtime, session files) and the
   argument rules of `src/cli/args.ts`. It opens no socket. It ships in `lib/cli`, never in the page bundle. No new
   dependency.
2. **A docs page for coding agents** (spec User Stories 2 and 3): run the command and read its output, read an exported
   session, build and open a 016 launch link by linking to 016's description, pass a token through an environment
   variable, and the warning that a session file can hold target data that the agent sends to its model provider.

The command name is left to the plan. `run` is the obvious one. It must not take `test` or `replay`, which #83 and #84
reserve.

This answers every candidate use. Three of them need no code: open a launch link, read an export, send a raw request.
The fourth, findings without a browser, needs one command, and #83 needs that engine anyway.

### When to revisit MCP

Any of these would change the answer:

- The maintainer wants agents without a shell (chat clients) to use the inspector.
- Agents need to read the live session in the developer's page, and the maintainer accepts a constitution amendment for
  a page-to-process channel.
- MCP gains a capability a command cannot match for this use, such as the agent being notified as frames arrive in the
  developer's page.

If it is revisited, the shape is set by the constraints already in place: `agui-inspector mcp` as a command of the same
binary, stdio only (no listener, so loopback holds trivially), compiled into `lib/cli` and never into the page bundle,
with one tool that wraps the headless run and returns the session file. Headers come from the command line of the MCP
server's own launch, live in memory, and are never part of a tool's input or output. Tests search every tool result and
every stdio message for a synthetic header value. The SDK, if used, gets an exact pin, a lockfile entry and a row in
`dependencies.mdx` naming the hand-written JSON-RPC loop as the alternative that falls short (or the reverse).

## 4. Constitution check (for the recommended scope)

| Principle | Check |
| --- | --- |
| I. The wire comes first | The command records with the same recorder and frame reader as the page and writes the session file as export does. An invalid run input is sent unchanged with a finding. Nothing is repaired. |
| II. The protocol, not a framework | Runs go through `@ag-ui/client` as in the page. No chat framework. |
| III. Generic core | No server-specific branch. Presets and plugins stay out of the first version; nothing about them changes. |
| IV. Local-only and credential privacy | No listener, no telemetry, requests only to the named target. Headers in memory, never in output, messages or files; the recorder still reads no header; the session file has no header field. Principle IV's line "CLI mode MUST reach targets through its local proxy" is about the page in CLI mode. The headless run has no page: the process itself is the client, like the relay is. The plan should state this reading, and the maintainer should confirm it. |
| V. Small and auditable | No new dependency. New code is a command and its tests. No MCP layer. |
| VI. Every event type has a view | The views are unchanged. The output imports into the page, where every event type has its view. |
| Architecture | Compiled to `lib/cli`, outside the page bundle, as feature 005. Scope follows `ROADMAP.md` once the maintainer adds it. |

## 5. Roadmap fit

0.2.0 is closed. 0.3.0 holds the conformance suite (#83), the Python reference agent (#82), replay (#84) and rule docs
(#85). The headless run fits 0.3.0 and should land before #83, which plays inputs against a target and reports rule
findings: the suite becomes a list of inputs and expected findings on top of this command. If 0.3.0 should stay as it
is, the feature goes to the release after it. Either way `ROADMAP.md` gets a row and an issue.

## 6. Spec 016

The launch link (feature 016) is being specified in another session, on branch
`worktree/remembered-setup-and-launch-links-fcf81b`. On 2026-11-11 that branch has no commits and no `specs/016-*`
directory, so this research could not read its link format. Spec 018 depends on it by number only and repeats none of
it. The agent docs section on launch links is written after 016 merges, and links to 016's description.

## 7. Open questions for the maintainer

1. **MCP or not** (spec FR-015). Recommended: no MCP; build the headless run and the docs page. Alternatives: add an
   `agui-inspector mcp` stdio command with one tool over the same engine; or build nothing and write only the docs page.
2. **Release** (FR-016). Recommended: 0.3.0, before #83. Alternative: after 0.3.0.
3. **Live session** (FR-017). Recommended: out of scope; Export session is the way. Alternative: in scope, which needs a
   constitution amendment to principle IV first.

The plan (`speckit-plan`) starts only after these are answered.
