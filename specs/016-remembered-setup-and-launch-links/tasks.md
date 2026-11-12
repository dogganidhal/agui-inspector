# Tasks: Remembered setup and launch links

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md),
[launch link contract](contracts/launch-link.md), [remembered setup contract](contracts/remembered-setup.md),
[validation guide](quickstart.md).

**Format**: `T###` is one checklist task. `[P]` means the task touches different files from the other open tasks and
can run in parallel. `[USn]` maps a task to a user story in the spec. Tests come before the code they cover.

**Rules for every task**: no new dependency, no new `npm run` script, no change to the content security policy, to
`hosting-config.json`, to the recorder or to the session format. Docs use short plain sentences, no em dashes. Run
`npm run typecheck` after each source task.

**Stories**: US1 setup survives a reload (P1). US2 open from a link (P1). US3 bad or hostile link (P1). US4 docs for link
builders (P2).

## Phase 1: Setup

- [x] T001 Record a green baseline: `npm run typecheck` and `npm run test:unit` on the clean checkout.

## Phase 2: Foundational

- [x] T002 Write failing tests in `packages/inspector/tests/setup/setup.test.ts` for the stored setup: `loadSetup` returns `ok(undefined)` when nothing is stored; reads `{ version: 0, setup: { agent, variables } }` and `{ version: 0, setup: { endpoint } }`; refuses a wrong version, an unknown field, `agent` with `endpoint`, `variables` without `agent`, non-JSON text; never throws when `getItem` or `setItem` throws; `saveSetup` writes exactly the envelope and nothing else.
- [x] T003 Create `packages/inspector/src/core/setup/index.ts` with `SETUP_STORAGE_KEY = 'agui-inspector.setup'`, the `SavedSetup` type, `loadSetup(storage)` and `saveSetup(storage, setup)`. Framework-free. T002 passes.

## Phase 3: US2 and US3, the link (P1)

- [x] T004 [P] [US2] [US3] Write failing tests in `packages/inspector/tests/setup/link.test.ts` for `parseLaunchLink(fragment)`: empty input gives nothing; a leading `#` is ignored; each key of the contract is read; `+` and `%20` are spaces; `v=0` and no `v` are accepted, any other `v` ignores the whole link with one warning; a fragment over 65,536 characters ignores the whole link with one warning; unknown, repeated and credential keys (`token`, `auth`, `authorization`, `header`, `headers`, `header.x`, in any case) give one warning each naming the key; `agent` with `endpoint` refuses both; bad `context` and `forwardedProps` JSON, a context entry that fails the protocol schema and the reserved `a2uiAction` give one warning each; no warning contains the value (use a distinctive value); `var.` with an empty or invalid name is refused.
- [x] T005 [US2] [US3] Create `packages/inspector/src/core/setup/link.ts` with `MAX_LINK_LENGTH`, `CREDENTIAL_KEYS` and `parseLaunchLink`. Reuse `parseProfileSettings` from `core/profiles` for `context` and `forwardedProps`. T004 passes.
- [x] T006 [US1] [US2] [US3] Write failing tests in `packages/inspector/tests/setup/setup.test.ts` for `resolveSetup({ agents, policy, saved, link })`: precedence link > saved > first agent; a link agent different from the saved agent drops saved variables; an undeclared variable, any variable with an endpoint, a JSON variable that does not parse and a text variable that is not a string are dropped with a warning; an unknown saved agent and a saved endpoint the policy refuses fall back to the first agent with a Configuration warning; a link endpoint the policy refuses keeps the saved or first selection with a Link warning; a link endpoint with credentials is refused.
- [x] T007 [US1] [US2] [US3] Add `resolveSetup` to `packages/inspector/src/core/setup/index.ts`, checking endpoints with `resolveTarget` from `core/runtime/transport.ts`. T006 passes.

## Phase 4: Startup and page (US1, US2, US3)

- [x] T008 Write failing tests in `packages/inspector/tests/hosted/startup.test.ts`: (a) a saved agent and variables are selected and in `settings.variables`; (b) a saved endpoint is the runtime target; (c) a `launch` fragment selects its agent, sets variables, replaces the profile's context and forwarded properties, saves setup and profile, and returns `launch.message`, `launch.keys` and `launch.warnings`; (d) the message is not stored; (e) the fetch stand-in sees the same requests with and without a link; (f) the policy text is unchanged; (g) a bad link and a bad saved setup never stop the start; (h) no storage: the link still applies.
- [x] T009 Wire `packages/inspector/src/app/startup.ts`: `launch?: string` in `StartupEnvironment`, `Started.launch`, resolve and apply after the saved profile and before plugins load, select the agent or set the endpoint, save. T008 passes.
- [x] T010 [P] Write failing tests in `packages/inspector/tests/hosted/app.test.tsx`: the composer starts with the launch message; the notice names the keys as a "Link" finding; link warnings render as "Link" warnings in the warnings region.
- [x] T011 Wire `packages/inspector/src/app/index.tsx` and `packages/inspector/src/views/connection/index.tsx`: `mountApp` reads `location.hash`, passes it as `launch`, removes it with `history.replaceState`, and reloads on a later nonempty `hashchange`; `Root` saves the setup when an agent is selected, an accepted endpoint is applied, or a variable changes; the composer takes a starting text; the notice and Link warnings show in the warnings region. T010 passes.

## Phase 5: End-to-end (US1, US2, US3)

- [x] T012 Write `tests/e2e/hosted/launch.spec.ts` against the scripted agent: reload keeps agent and variable and drops the token; a full link fills every value, sends nothing, strips the fragment, and the next send carries the values; a reload after a link keeps the setup and empties the composer; a bad link shows one warning per bad key and applies the rest; a credential key's synthetic value appears nowhere on the page, in storage or in an exported session; an embedded page refuses a link endpoint on another origin and makes no request to it; a second link pasted in the same tab applies.

## Phase 6: Docs and release (US4)

- [x] T013 [P] [US4] Write `website/content/docs/launch-links.mdx` (remembered setup, the link format, precedence, warnings, security limits, an example per serving mode) and add it to `website/content/docs/meta.json`. Link it from `runs.mdx` and `configuration.mdx`.
- [x] T014 [P] Add a changeset for `agui-inspector` and `agui-inspector-python` (minor), and a line in `ROADMAP.md`.
- [ ] T015 Run `npm run check:ci` and fix what fails. If the code and the spec disagree, run `speckit-converge`.

## Dependencies

T001 first. T002 and T003 before T006 and T007. T004 and T005 can run with T002 and T003. T008 to T011 need T003, T005
and T007. T012 needs T011. T013 and T014 can run any time after T005. T015 last.
