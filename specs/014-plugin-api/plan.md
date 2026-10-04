# Implementation Plan: Plugin API

**Branch**: `gh-81-plugin-api` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: `specs/014-plugin-api/spec.md`, issue #81, the 0.2.0 roadmap (item 9, issue #86).

**Status**: Planning only. Implementation starts after the maintainer approves the spec and this plan.

## Summary

`config.json` gets an optional `plugins` list of module addresses on the page's own origin. The configuration reader
validates it, drops each bad entry with a "Configuration" warning, and hands the resolved addresses to startup. Startup
creates a plugin host before the runtime, loads the modules with `import()` once the configuration is read, and renders
only after every plugin has loaded or failed.

A plugin module default-exports a function that receives a frozen object: `version`, `beforeRun`, `provideHeaders`,
`renderCustomEvent` and `renderActivity`. The host collects what the function registers and keeps it only if the function
ends without error.

The runtime asks the host at three points it already has. Before the preparations of a run, `beforeRun` may replace the
composed input, which goes out and is recorded as sent. Before each preparation, run and raw request, `provideHeaders`
returns headers that ride in a new optional field of `TransportRequest`. The guarded transport validates them again and
merges them below the typed token. The recorder never sees a `TransportRequest`. The conversation view gets a
`renderCustom` seam next to the existing `renderActivity`. The app tries the A2UI view first and a plugin renderer second.
A small `PluginSlot` component hands each renderer an empty container and a copy of the data, and shows the JSON view when
the renderer throws.

Failures are warnings in the existing warnings area, kind "Plugin". A failure on the send path also stops that one request.
`mount_inspector` and the JavaScript helpers write `plugins` into `config.json` as given. The command of feature 005 gains
`--plugin` once it has merged. An example plugin, a reference-agent scenario, end-to-end tests and a docs page complete it.

The content security policy, the request policy, the recorder, the session format and `hosting-config.json` are not
touched. No dependency is added.

## Technical Context

**Language/Version**: Existing strict TypeScript 7.0.2 and React 19.3.0; Node >=24; Python >=3.10. The example plugin is
plain JavaScript (an ES module) so a browser can load it without a build.

**Primary Dependencies**: None added. `import()`, `structuredClone`, `AbortSignal` and `URL` are platform features.
`RunAgentInputSchema` from `@ag-ui/core` is already used by `composeRunInput`.

**Storage**: None. Plugins are read from `config.json` on every load. Nothing about them is stored, exported or recorded.

**Testing**: `node --test` through the repository runner for the reader, the host, the runtime and the helpers. Playwright
Chromium for the modes, the example plugin and the failures. `unittest` for the Python helper. There is no DOM emulation in
the repository, and none is added: the mount rules are a plain function with a fake container, and a real container is
checked in Playwright.

**Target Platform**: The one static bundle in all modes: hosted, Python embedded, JavaScript helpers, host-served static
files, the npm assets, and the command when feature 005 has merged.

**Project Type**: Static browser app plus two small helpers. No backend.

**Performance Goals**: None beyond the existing budgets. With no plugin registered, the hook and header paths return
without copying anything, and no slot exists.

**Constraints**: The production bundle stays within 2,000,000 B minified and 600,000 B gzip. The policy text is unchanged.
The configuration format stays at version 0. The API version is 0.

**Scale/Scope**: A large pull request, as the roadmap says: one new core module, three small edits in the runtime, one view
seam, one component, two helper arguments, one example, docs, tests, two changesets.

## Constitution Check

Constitution 1.2.0. Pre-research and post-design assessments agree.

| Rule | Assessment and evidence |
| --- | --- |
| I: wire first | Frames, the recorder and the protocol client's stream are not touched. A hook changes the request, and the recorded request is the one that was sent. Hooks, providers and renderers receive copies, and the hook's result is copied after it is checked, so no plugin can reach a recorded value. A raw submission is never changed. Renderers add a card and never replace the frames list or the JSON. Tests compare frames, exports and the frames list with and without plugins. |
| II: protocol, not a framework | Run input is checked with `RunAgentInputSchema`, as `composeRunInput` does. `a2ui-surface` stays with the A2UI renderer packages, and a plugin cannot claim it. The host, the reader and the runtime changes are framework-free TypeScript. `contracts.ts` gains types and no React import. React appears in `PluginSlot` and the existing conversation view only. |
| III: generic core, presets | This feature is the "specified plugin scope". The core gains no server-specific route or branch. A plugin supplies what presets cannot. |
| IV: local-only, credential privacy | Scripts load from the page's own origin and nowhere else: the address is checked in the reader and again before `import()`. `script-src 'self'` and the whole policy text are unchanged, and a test compares them. No `eval`, no `new Function`, no inline script. A cross-origin redirect is blocked by the policy. No telemetry. Provider values live in memory for one request, are never given to the recorder, the store, the session export, the profile, storage, logs or views, and messages about them name the header and never the value. The typed token still wins over a provider and is still read in one place. Hosted requests still carry no cookies. |
| V: small and auditable | No dependency. One host module, one component, one function that checks a header value. Four registration functions and nothing speculative: no options, no second hook, no observers. |
| VI: every event type has a view | Not touched. A renderer adds a view for a custom name or an activity type. The frames-list view of every type stays. |
| Shared bundle and packaging | One bundle for all modes. The wheel and the npm package carry the same change. The Python helper needs no Node toolchain. |
| CSP | `script-src 'self'`, no `eval`, and `connect-src` are unchanged. A test compares the policy text with and without plugins. A policy violation test covers the cross-origin redirect. |
| Quality gates | Regression tests for every changed behavior. End-to-end tests use `examples/reference-agent` and test servers only. The network allowlist and header absence are checked, as the constitution requires. `npm run check:ci` gates the change. |
| Release | Minor changesets for `agui-inspector` and `agui-inspector-python`. Nothing is published or tagged here. |
| Scope | Issue #81 and the accepted 0.2.0 roadmap, item 9. The format stays at version 0 with an optional field, as the roadmap decisions require. The 1.0.0 line about plugin API formats applies to a 1.0.0 release, which is not planned. |

No violation. No complexity to track.

## Design decisions

The reasons and the rejected alternatives are in [research.md](research.md). In short:

1. `plugins` lives in `config.json`, like `brand`. The helpers need one new key, and `hosting-config.json` stays the
   request policy (research 1).
2. Plugins load with `import()` after the configuration and before the first render, so no run can precede a hook
   (research 2).
3. A plugin is one function that receives a frozen versioned object. Registrations commit only on success (research 3, 8).
4. One run hook, before the preparations, with a checked and copied result (research 4).
5. Header providers are resolved before the recorder is called, never inside `send`, so a failed one records nothing. The
   headers ride in `TransportRequest`, which the recorder never receives (research 5).
6. Renderers draw into a container and are keyed by the JSON text of their data (research 6).
7. A failure is a warning; on the send path it also stops that one request (research 7).

## Project Structure

### Documentation (this feature)

```text
specs/014-plugin-api/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── plugin-api.md        # the module, the API object, each function, the warnings, the version
│   └── configuration.md     # config.json field, helper arguments, the command option, load order
├── checklists/
│   └── requirements.md
├── analysis.md              # /speckit-analyze
└── tasks.md                 # /speckit-tasks
```

### Source code (repository root)

```text
packages/inspector/src/
├── contracts.ts                      # PluginApi and its argument types; PLUGIN_API_VERSION; ConfigFile.plugins; TransportRequest.headers
├── core/config/
│   ├── validation.ts                 # pluginSource(): the address check, reused at load time
│   └── index.ts                      # parsePlugins(); ParsedConfig.plugins
├── core/plugins/
│   ├── index.ts                      # new: createPluginHost(): load, activation sets, registry, beforeRun, headers, warnings, count
│   └── mount.ts                      # new: mountRender(): call render, keep the cleanup, empty the container; fake-container testable
├── core/profiles/index.ts            # checkRunInput() split out of composeRunInput
├── core/runtime/
│   ├── index.ts                      # RuntimeOptions.plugins; beforeRun before the preparations; header resolution for run and raw
│   ├── prepare.ts                    # PreparationContext.headers, called before each preparation is recorded
│   └── transport.ts                  # TransportRequest.headers; headerValueProblem(); merge below the typed token
├── app/
│   ├── startup.ts                    # host before the runtime; load after the configuration; Started.plugins; env.importModule
│   ├── plugin-slot.tsx               # new: one container per rendered entry; JSON view and a warning on failure
│   └── index.tsx                     # renderers after the A2UI view; plugin warnings; footer count
├── views/conversation/index.tsx      # renderCustom seam and the CustomBlock card
├── views/conversation/conversation.css   # the custom card (reuses the activity card's classes where it can)
└── server/core.ts                    # InspectorOptions.plugins, written into config.json after brand

packages/python/src/agui_inspector/__init__.py   # plugins argument
examples/plugin/plugin.js             # the example plugin: all three extension points
examples/reference-agent/scenarios.ts # one scenario that emits a custom event and a custom activity

packages/inspector/src/cli/           # only after feature 005 has merged: --plugin, /plugins/<n>.js (args.ts, server.ts, run.ts)

packages/inspector/tests/
├── config/plugins.test.ts            # the reader: no field, valid, every rejected value, duplicates, no value in a warning
├── plugins/host.test.ts              # load, atomic activation, timeouts, order, registry rules, warnings (no repeat, cap), counts
├── plugins/mount.test.ts             # mountRender with a fake container: call, cleanup order, throw
├── runtime/plugins.test.ts           # hook (adjust, refuse, invalid, ids), providers (all three kinds, not config), fail-closed, Stop, no leak
├── runtime/transport.test.ts         # extended: provider headers, token replaces, bad name and value, no value in the message
├── hosted/startup.test.ts            # extended: plugins load after the policy; none declared means no import and the same policy
├── server/core.test.ts               # extended: plugins in config.json, bytes unchanged without them
└── foundation/policy.test.ts         # existing: no eval or new Function under src

packages/python/tests/test_embedding.py   # plugins in config.json; absent means identical bytes

tests/e2e/plugins/
├── plugins.spec.ts                   # the example plugin in hosted and embedded mode: header, input, both renderers, export
├── failures.spec.ts                  # broken plugins, hook and provider failures, Stop, redirect and policy violation
└── modes.spec.ts                     # generic static, Python, Express, Hono, Next.js stand-in
tests/e2e/hosted/support.ts           # Seen gains headers; the agent origin serves the new scenario
tests/e2e/hosted/serving.ts           # the Python host takes plugins and serves a module from its own route

website/content/docs/
├── plugins.mdx                       # new: the API page
├── meta.json                         # plugins under "Set it up"
├── configuration.mdx                 # the field, the rules, the warnings, the compatibility note
├── embedding.mdx                     # the helper arguments, serving the module
├── hosted.mdx                        # pointer to the rules
├── event-views.mdx                   # renderers and the custom card
├── recordings.mdx                    # a provider's headers are not in a session file
├── troubleshooting.mdx               # plugin warnings
├── internals.mdx                     # the new modules and tests
└── index.mdx                         # one line in the page list

AGENTS.md                             # a row for examples/plugin
.changeset/                           # agui-inspector (minor), agui-inspector-python (minor)
```

**Structure Decision**: One new core module for the host, split from a tiny `mount.ts` so the DOM-facing rule is unit
testable without a DOM. One new app file for the component. Everything else extends the module that already owns the
behavior: the reader for the field, the runtime for hooks and headers, the transport for headers, the conversation view
for the seam. The host is not part of the runtime: the runtime takes a two-method interface, which keeps `core/runtime`
free of renderer and warning code.

## Order of work inside a run

```text
dispatchRun
  resolve preset -> composeRunInput
  plugins.beforeRun            (new: may replace the input; a failure refuses the run here, nothing sent)
  runPreparations
    for each preparation: plugins.headers -> recorder.record -> transport.send({ headers })   (new first step)
  plugins.headers for the run  (new: before owed replies are cleared)
  replies = NO_REPLIES
  execute -> recorder.record -> transport.send({ headers })
sendRaw
  plugins.headers -> recorder.record -> transport.send({ headers })
```

A failure at any new step calls `refuse(message)` or returns the preparation failure, so the existing path shows it and
sends nothing after it.

## Test plan

| Layer | What it proves | Spec |
| --- | --- | --- |
| Reader unit | No field: no `plugins`, no warning. `[]`. Valid relative, absolute-path and same-origin full URL, with a query. Each rejected value in FR-002 gives one warning and the other entries stay. A value that is not a list. A repeated address. Resolved against the page, not the configuration file. A warning never holds the value. | FR-001 to FR-003 |
| Host unit | Modules requested together and activated in order. A function that returns, a promise, a throw, a rejection, a timeout (short, injected), a missing default export, a failed import. All-or-nothing registration. Registration after activation. A bad argument. First claim wins for a name and a type, and `a2ui-surface` is refused. Warnings do not repeat and stop at 20. The count. The address is checked again before `import()`. | FR-004 to FR-006, FR-015, FR-017, FR-018 |
| Mount unit | A fake container: `render` is called with a copy, the cleanup runs before the next call and on unmount, the container is emptied each time, a throw in either is reported once and the caller gets a failure signal. | FR-014 |
| Runtime unit | Hook: adjusts `forwardedProps`, the body and the run's `input` match, frames are untouched. No return keeps the input. Order of two hooks. A throw, a rejection, an invalid input, a changed `threadId` or `runId`: nothing sent, no exchange, a message and a warning. Stop during a hook: no warning. A hook mutating its copy changes nothing. A hook keeping the returned object and changing it later changes nothing. Automatic continuations call the hook. Raw: no hook. Providers: called for each preparation, the run and the raw request with the right method, address and body, not for configuration or capabilities. A failure sends nothing and records nothing. Owed replies survive a provider failure. The typed token replaces a provider header. The value is in the fake `fetch` and in no store snapshot, serialized session or runtime state. | FR-008 to FR-013, FR-016 |
| Transport unit | Provider headers in `RequestInit.headers`. A reserved name, a bad token, a value with a line break or a character above Latin-1: refused, and the message holds the name and not the value. Case-insensitive replacement. | FR-012, FR-013 |
| Startup unit | Plugins load after the policy and the runtime exist. None declared: no `import`, same policy text. A failing import does not stop the start. The page makes no request to a target before loading ends. | FR-004 |
| Helper units | JavaScript core and the three adapters: `plugins` written after `brand`, bytes unchanged without it. Python: `plugins` written as given, absent when not set, disabled helper touches nothing. | FR-019 |
| Docs test | The plugins page names every function, the version rule and the trust note. The configuration page has the compatibility note. | FR-023 |
| End to end | The example plugin in hosted and embedded mode: footer count, header on the preparation and the run with different values, adjusted body in the recording, both cards, JSON switch, cleanup, export without the value, frames list unchanged, no request to another origin, no policy violation. Failures: each broken plugin one warning, the good one active, a run still goes out. Hook and provider failures stop the run. Redirect to another origin is a load failure and a violation. The five other serving modes show the same page. | FR-020, FR-022, SC-001 to SC-007 |
| Gates | `npm run check:ci`: typecheck, unit, build, bundle budget, end to end, Python. | FR-025 |

The no-plugin baseline is a test too: the same scripted run with and without the example plugin gives the same frames,
raw envelopes, frames-list text and exported session, apart from the request body that a hook changed.

## Docs and release

- A new page, `plugins.mdx`, in "Set it up" after `configuration`: declaring plugins in each mode, the module, the four
  functions with the example, the failure rules, the version, the trust note and the checklist for a plugin author.
- `configuration.mdx` gets the field, the rules and the compatibility line. `embedding.mdx` gets the helper arguments and
  how to serve the module. `hosted.mdx` points to the rules. `event-views.mdx` explains the custom card and that renderers
  never change the frames list. `recordings.mdx` says that a provider's headers are not in a session file. The
  troubleshooting page has a row for each plugin warning.
- The page that documents the command gets `--plugin` when that story ships.
- No new `npm run` script, so `development.mdx` is unchanged. No new dependency, so `dependencies.mdx` is unchanged.
- Two changesets: `agui-inspector` minor and `agui-inspector-python` minor. The changelog entry for the API says that it
  starts at version 0.

## Open questions for the maintainer

1. Does the command of feature 005 get `--plugin` in 0.2.0? It adds a sixth option to a command whose spec lists five and
   says "and no others". The need is real, since the command exists for servers that cannot change. Cutting it removes story
   6 and FR-021 and leaves everything else as is. The plan assumes yes, after #97 merges.
