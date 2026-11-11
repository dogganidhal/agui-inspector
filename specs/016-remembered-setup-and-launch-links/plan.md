# Implementation Plan: Remembered setup and launch links

**Branch**: `worktree/remembered-setup-and-launch-links-fcf81b` | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

**Input**: `specs/016-remembered-setup-and-launch-links/spec.md` and the maintainer's request.

**Status**: Approved by the maintainer on 2026-11-11.

## Summary

What a reload loses today (from the code, `app/index.tsx` and `app/startup.ts`): the selected agent (`selectedId`
starts at the first agent), a typed endpoint (`runtime.setTarget` is memory only), the preset variable values
(`settings.variables` starts at `{}`), the thread id and conversation (`createRuntime` makes a new thread), the composer
draft (`Composer` state), the header name in the authentication popover, and view choices (pane, tab, filters). The
client profile and the light or dark choice are already kept. This feature keeps the first three. The token and header
name stay memory only by the constitution. Thread, conversation, draft and view choices stay out (spec Clarifications).

A new framework-free module, `src/core/setup`, does three things:

1. `loadSetup` and `saveSetup` read and write a version-0 envelope under `agui-inspector.setup`, in the same storage
   and with the same never-throw rule as `theme-choice.ts`.
2. `parseLaunchLink` turns a fragment into launch values and warnings. It reuses `parseProfileSettings` for `context` and
   `forwardedProps`, so a link is held to exactly the checks of Settings and profile import.
3. `resolveSetup` merges link, saved setup and configuration into one selection, one set of variable values and the
   warnings, with the precedence of FR-014. Endpoints are checked with `resolveTarget` and the startup policy.

`startPage` gets the fragment as a new `launch` field of `StartupEnvironment`. After the configuration and the saved
profile are read, and before plugins load, it calls the module, applies the result to `settings` and the runtime (select
the agent or set the endpoint), saves what changed, and returns the message, the keys the link set, and the link warnings.
`mountApp` reads `location.hash`, passes it, removes it with `history.replaceState`, and reloads the page on a later
`hashchange` that carries a fragment. `Root` saves the setup whenever the developer selects an agent, applies an
endpoint or edits a variable. The composer takes the link message as its starting text. A "Link" notice and "Link"
warnings join the existing warnings area.

No request is added, the content security policy and the request policy are unchanged, and no dependency is added.

## Changes during implementation

- FR-010 says a warning never repeats a value. FR-011 says a refused link endpoint gets the reason a typed one gets, and
  that reason names the endpoint's origin. The spec now states this one exception. A user name or password is refused
  before the origin is named, so a credential in an endpoint never reaches a warning.
- `tests/e2e/theme/config.spec.ts` applied the same typed endpoint before and after a reload. The page now remembers it,
  so the second round's Use endpoint button stayed disabled. The test applies a different endpoint in each round.
- The end-to-end spec sits in `tests/e2e/hosted/launch.spec.ts`, next to the other hosted and embedded specs and their
  scripted agents, instead of a new `tests/e2e/launch` folder.

## Technical Context

**Language/Version**: Existing strict TypeScript and React; Node >=24. No Python change beyond the wheel shipping the
rebuilt bundle.

**Primary Dependencies**: None added. `URLSearchParams`, `history.replaceState`, `hashchange` and `localStorage` are
platform features. `ContextSchema` from `@ag-ui/core` is already used through `parseProfileSettings`.

**Storage**: Browser storage, one new key `agui-inspector.setup` holding `{ "version": 0, "setup": { ... } }`. See
[data-model.md](data-model.md).

**Testing**: `node --test` through the repository runner for `core/setup` (parse, resolve, storage) and for `startPage`
(extends `tests/hosted/startup.test.ts`). The composer's starting text in `tests/hosted/app.test.tsx`. Playwright
Chromium against the reference agent for reload, a full link, a bad link, a hostile endpoint, a pasted second link and
the synthetic credential search.

**Target Platform**: The one static bundle in every mode: hosted, Python embedded, Express, Hono and Next.js helpers, the
command and the public demo. Every mode loads the page through `mountApp`, so one change covers them all.

**Project Type**: Browser developer tool with Node and Python serving helpers.

**Performance Goals**: Reading a link and the saved setup adds no request and no visible delay to the start.

**Constraints**: Fragment capped at 65,536 characters (research 5). Credentials never stored or carried. A link never
sends. Bundle within 2,000,000 B minified and 600,000 B gzip.

**Scale/Scope**: One storage key, seven link keys, one docs page.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle or rule | Assessment |
| --- | --- |
| I. The wire comes first | Pass. Nothing touches the recorder, frames or the client's stream. A link fills inputs; the run it leads to is sent and recorded the usual way. |
| II. The protocol, not a framework | Pass. Context is checked with `@ag-ui/core`'s schema through the existing profile parser. No framework added. |
| III. Generic core, application presets | Pass. A link names an agent id and preset variables from the deployment's own configuration. No server-specific route or convention enters core. |
| IV. Local-only operation and credential privacy | Pass. No new request: the link is read from the page's own address, and the endpoint goes through the same `resolveTarget` and policy as a typed one, so it cannot widen `connect-src` or the transport allowlist. Credential keys are refused and their values never stored or echoed (FR-012). Storage holds no token or header (FR-005). The token is still cleared on reload. No auto-send, so a link cannot start an embedded run with the host's cookies (research 3). |
| V. Small and auditable | Pass. No dependency. One core module, small edits to startup, the app and the composer. |
| VI. Every event type has a view | Not affected. |
| Same-origin scripts, no `eval` | Pass. Values are parsed as text or with `JSON.parse` and shown as React text. The source test for `eval` and `new Function` covers the new module. |
| One static bundle; CSP | Pass. One change in `mountApp` serves every mode. The policy text is unchanged; a test compares it. |
| Regression tests, docs, changeset | Planned: unit, startup and end-to-end tests, a docs page, and a changeset for both packages. |

Re-checked after Phase 1 design: still passes. The design added no request, key or stored field beyond the above.

## Project Structure

### Documentation (this feature)

```text
specs/016-remembered-setup-and-launch-links/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── launch-link.md
│   └── remembered-setup.md
├── checklists/requirements.md
└── tasks.md             # next step, /speckit-tasks
```

### Source Code (repository root)

```text
packages/inspector/src/
├── core/setup/
│   ├── index.ts         # new: SETUP_STORAGE_KEY, loadSetup, saveSetup, resolveSetup
│   └── link.ts          # new: parseLaunchLink, LINK_KEYS, MAX_LINK_LENGTH
├── core/profiles/index.ts   # unchanged API; parseProfileSettings reused
├── app/startup.ts       # launch in StartupEnvironment; apply setup; Started.launch
├── app/index.tsx        # read and strip the fragment, hashchange reload, save on change, notice and warnings
└── views/connection/index.tsx  # Composer starting text

packages/inspector/tests/
├── setup/link.test.ts       # new
├── setup/setup.test.ts      # new
├── hosted/startup.test.ts   # extended
└── hosted/app.test.tsx      # extended

tests/e2e/hosted/launch.spec.ts   # new, against the scripted agents of tests/e2e/hosted

website/content/docs/
├── launch-links.mdx     # new: remembered setup and the link format
├── meta.json            # page added
└── runs.mdx, configuration.mdx  # one line each, linking the new page

.changeset/<name>.md     # agui-inspector and agui-inspector-python, minor
```

**Structure Decision**: One core module next to `profiles`, because both own browser storage and the setup reuses the
profile parser. Link parsing is its own file because it is the public contract spec 018 builds against.

## Implementation slices

1. Core: `core/setup` with its unit tests (parse every key, every refusal, precedence, storage that throws).
2. Startup: `launch` in the environment, applying and saving, `Started.launch`; startup tests including "no extra
   request" and "policy text unchanged".
3. App: fragment read and strip, `hashchange`, saving on change, composer starting text, notice and warnings.
4. End-to-end tests and the synthetic credential search.
5. Docs page, links from related pages, changeset, `ROADMAP.md` line, `npm run check:ci`.

## Complexity Tracking

No constitution violation to justify.
