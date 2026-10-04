# Implementation Plan: Protocol rule catalogue

**Branch**: `gh-77-protocol-rule-catalogue` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/007-protocol-rule-catalogue/spec.md`, issue #77.

## Summary

Give every finding a stable rule id from one catalogue of 39 rules, add the rules that the issue asks for (frames that
contradict declared capabilities, and the older event shapes the protocol client still accepts), and list the rules in
the docs.

The change is a thin layer on code that exists. The frame reader, the recorder and the runtime already create every
finding. Each of them now names a rule from a new framework-free module, `core/rules`. The module holds the catalogue,
the table that maps the protocol client's sequence errors to rule ids, the upgrade of a frame copy that mirrors the
client's compatibility step, and the capability checks. The reader runs the compat and capability checks on each JSON
object frame. The runtime hands it the declared capabilities of the selected agent, which the app already loads. The
session file gains an optional `rule`. The views show the id. A fixtures file keyed by rule id feeds the tests, the
docs check and the next minor's conformance suite.

Nothing here touches the recorded bytes, the frames or the protocol client's stream. No dependency is added.

## Technical Context

**Language/Version**: Existing strict TypeScript 7.0.2 with `noUncheckedIndexedAccess` and `erasableSyntaxOnly`, React
19, Node >=24. No Python change beyond the changeset: the wheel ships the bundle.

**Primary Dependencies**: Existing exact pins only: `@ag-ui/core` 1.0.1 (`EventSchemas`, `PROTOCOL_VERSION`,
`AgentCapabilities`), `@ag-ui/client` 1.0.1 (`HttpAgent`, `AGUIError`). No new dependency, no new request.

**Storage**: None. Findings live in the in-memory session store and in the version 0 session file, where the optional
`rule` field is new.

**Testing**: `node --test` through the repository runner, Playwright Chromium for the browser checks, the docs site's
own tests. The fixtures live in `examples/reference-agent`.

**Target Platform**: The one static bundle in all modes. The rules run in the page, in the frame reader.

**Project Type**: Static browser app with framework-free core and React views.

**Performance Goals**: The existing 5,000-frame acceptance and responsiveness criteria pass unchanged. The compat step
copies a frame only when an upgrade applies. A frame with no upgrade costs one pass over its top-level keys, plus a
scan of `input` or `messages` for `RUN_STARTED` and `MESSAGES_SNAPSHOT` only.

**Constraints**: Rule checks never stop, repair, drop, reorder or delay capture (FR-018). Bundle stays within 2,000,000
bytes minified and 600,000 bytes gzipped. Docs follow the repository writing rules.

**Scale/Scope**: 39 rules, 1 new core module of 3 files, edits to 6 existing core files, 3 view files, 1 new docs page
and edits to 3 more, 1 fixtures file, about 8 test files, 2 changesets.

## Constitution Check

*GATE: passes before research and again after design. No amendment is needed. Constitution version 1.2.0.*

| Principle or rule | Assessment |
| --- | --- |
| I. The wire comes first | Pass. Rules read a parsed copy and add findings beside the frames. The recorded bytes, frames, order and offsets do not change, and nothing touches the protocol client's own stream. A rule step that throws leaves the frame in place and adds `capture.rule-check-failed`. A test captures every fixture with the rule checks removed and with them and compares frames byte for byte (SC-004). |
| II. The protocol, not a framework | Pass, with a recorded decision. Schema judgement stays `EventSchemas` from `@ag-ui/core`. Sequence judgement stays the client's: the inspector adds no second sequence check and only maps the client's error text to a rule id. The compat upgrade mirrors the client's `CompatibilityBoundary`. It cannot call it: the boundary's per-event method is private, it is driven through an rxjs `Observable` that the inspector does not depend on, and it prints a console warning for every upgrade. The mirror is pinned by a test that sends each shape through the real `HttpAgent` and requires the same result, so a client bump that changes the boundary fails the test. See research.md, decision 4. The module is framework-free TypeScript with no React. |
| III. Generic core, application presets | Pass. No server-specific route, id or convention. Capabilities come from configuration as today. |
| IV. Local-only operation and credential privacy | Pass. No request, telemetry, storage or header read is added. A capabilities URL is still read only through the guarded transport, when the agent is selected. Messages name event types, field paths and capability paths, never received values or credentials. |
| V. Small and auditable | Pass. No dependency. One module of three files, no registry, no plugin seam, no severity, no withdrawn marker (clarification 5). The rule list is one table that code, tests and docs are all checked against. |
| VI. Every event type has a view | Pass. The 31 baseline types and their views and fixtures are untouched. The five retired `THINKING_*` types are not baseline types: they stay in the frames list with a finding and are not projected. Adding rules updates fixtures and docs together. |
| Shared bundle, packaging | Pass. One bundle. No new asset. Changesets for `agui-inspector` and `agui-inspector-python`. |
| Scope | Pass. Issue #77 is accepted 0.2.0 scope (item 5). The server suite (#83) and the rule pages (#85) are next-minor work and only build on these ids. |
| Quality gates | Pass. Regression tests for every behavior change, fixtures for every rule, one Playwright spec against the scripted reference agent, docs and catalogue checked against each other. |
| Formats | Pass. Format version stays 0. `rule` is optional. 0.1.0 files import unchanged. Files written by this version are not promised to open in 0.1.0, as for `theme` in 0.1.0. |

**Complexity tracking**: no violation to justify.

## Design

### Module `core/rules`

Three files, no React, no DOM.

- `catalogue.ts`: `RULES`, an array of `{ id, family, summary }` for the 39 rules, `as const`, so the ids form a union
  type `CatalogueRuleId`. Code that creates a finding takes a `CatalogueRuleId`, so a typo fails the type check. Also
  `RULE_ID_PATTERN` and `checkRuleId(kind, rule)`, which returns a problem text or `undefined`. The store and the
  session-file importer both call it, so a finding that the store accepts is one that an import accepts. The family of
  an id must equal the finding's kind.
- `sequence.ts`: `sequenceRuleOf(message)`. An ordered table of patterns anchored on the text of the client 1.0.1
  errors, one row per rule of the sequence family, and `sequence.unclassified` for no match. The patterns are in
  [contracts/rule-catalogue.md](contracts/rule-catalogue.md).
- `frame-rules.ts`: `upgradeFrame(parsed)`, `protocolVersionRule(parsed)` and `capabilityRules(upgraded, declared)`.
  `upgradeFrame` returns the same object when nothing applies, so a clean frame costs no copy. When something
  applies, it returns a copy with the client's upgrades and the list of rules that applied, each with the field paths.
  `capabilityRules` reads `type`, and for `RUN_FINISHED` the `outcome.type`, and fires only on an exact `false`.

### Frame reader

`createFrameReader` and `createFrameSink` take an optional `declared` provider in `FrameReaderOptions`:
`() => AgentCapabilities | undefined`. The reader calls it once, when it is created, which is when the exchange's
stream starts (`createFrameSink` creates a reader on the first chunk or the `streaming` update). A later change of the
declaration does not change a running stream. A provider that throws is a rule-step failure: the reader notes it, keeps
reading with no declaration, and reports `capture.rule-check-failed` on the first JSON object frame.

`appendDataFrame` becomes, for a JSON frame:

1. `received = check(parsed)`. This stays the frame's `schemaVerdict`, as in 0.1.0.
2. `upgraded = upgradeFrame(parsed)`. `judged = upgraded.applied.length === 0 ? received : check(upgraded.value)`.
3. Findings, in this order: `json.invalid` for bad JSON. Then, when `judged` is not valid, `schema.unknown-event-type`
   or `schema.invalid-event` built from `judged`. Then one `compat.*` finding per rule that applied, plus the protocol
   version rule. Then the capability rules, read from `upgraded.value`.
4. `terminalSeen` is set when `judged` is valid and the upgraded type is `RUN_FINISHED` or `RUN_ERROR`.
5. The upgrade, the compat findings and the capability rules sit in one `try`. A throw falls back to the received
   verdict for the schema finding, skips the compat and capability findings, and adds one
   `capture.rule-check-failed` finding. The frame is appended before any finding, as now.

The schema check keeps its own `try`, so `schema.check-failed` stays as it is. Because `options.check` can replace the
check in tests, the compat step calls `check` the same way.

**Finding ids.** A frame's first finding keeps the id `<frame id>:finding`. The next ones are `<frame id>:finding-2`,
`<frame id>:finding-3`. Run findings keep `<run record id>:finding-<n>`, exchange findings from the recorder keep
`finding-<n>`. Ids stay opaque to every reader.

### Recorder, runtime, store, session files

- Recorder: `addFinding(kind, message)` becomes `addFinding(rule, message)`. The kind is the family of the rule. It
  yields `transport.failed`, `capture.failed` and `capture.response-not-captured`.
- Runtime: `clientFailure(error)` returns `{ kind, rule, message }`. An `AGUIError` goes through `sequenceRuleOf`. A
  `SyntaxError` is `json.invalid`. A `ZodError` is `schema.invalid-event`. New `Runtime.setDeclaredCapabilities(caps |
  undefined)`, like `setAuth`. The runtime keeps the value in memory, passes `() => declared` to `createFrameSink`, and
  clears it when the target changes. A raw request uses the same sink, so it is judged the same way.
- App (`app/index.tsx`): one effect calls `runtime.setDeclaredCapabilities` when the selected agent or its loaded
  capabilities change, with the result of a small pure function `declaredOf(agent, loaded)` in `core/config`. An inline
  `capabilities` object is passed as it is. A URL is passed once `loadCapabilities` has returned. `LoadedCapabilities` gains `declared: AgentCapabilities`, the object it parsed, beside `groups`. Anything
  else, including a failed load, passes `undefined`.
- Store: `addFinding` rejects a finding whose `rule` fails `checkRuleId`, before changing anything, like its other
  checks.
- Session files: `findingOut` writes `rule` when present. `checkFinding` accepts an optional `rule` and checks it with
  `checkRuleId`. `FINDING_KINDS` gains `compat` and `capability`.

### Views

`views/theme/primitives.tsx`: `Finding` gets an optional `rule` prop, rendered as a `code` element after the label.
`views/inspection/frames.tsx`: the frame detail, the exchange findings and the run findings pass `rule`. The frame row
keeps `<Tag>{issue.kind}</Tag>`. `findingVariant` returns `warn` for `sequence`, `projection`, `compat` and
`capability`. No other view reads findings.

### Fixtures and tests

`examples/reference-agent/rule-fixtures.ts` exports `ruleFixtures`, `satisfies Record<CatalogueRuleId, RuleFixture>`, so
a rule without a fixture fails the type check. A stream fixture is a `RecorderScenario` from the existing fixture
vocabulary, plus the `declared` capabilities it needs and where the finding lands (frame, run or exchange). A fixture for
the inspector's own failures names the seam to break (`schema-check`, `transport`, `capture-sink`, `capture-clone`,
`rule-step`, `client-error`). The test file holds the injection for each seam, and its `switch` is exhaustive.

`packages/inspector/tests/rules/` holds:

- `catalogue.test.ts`: ids match the grammar, are unique, family prefix is a finding kind, fixtures keys equal catalogue
  ids, `rules.mdx` ids equal catalogue ids (FR-022, FR-023).
- `fixtures.test.ts`: plays every fixture through the real recorder and reader, or through the real runtime and
  `HttpAgent` for client rules, and expects a finding with exactly that rule (SC-001). Also asserts that frames are
  exactly the received bytes and the same with and without a declaration provider, that a 5,000-frame stream in which
  every frame has a capability finding stays within the existing workload criteria (SC-004, SC-007), and that the compat
  fixtures are accepted by the real `HttpAgent`.
- `compat.test.ts`: every shape of the compat table goes through the real `HttpAgent`, which must accept it, and
  through `upgradeFrame`, whose output must equal the event the client delivers, up to the ids that the client mints for
  retired events. Also the `protocolVersion` table.
- `capability.test.ts`: each of the four rules with `false`, `true` and omitted, inline and by URL (through the runtime
  and `loadCapabilities`), the failed and slow URL cases, and the shipped reference and demo agents (FR-024).
- `sequence.test.ts`: each pattern row against the message that the real client raises for its fixture, and
  `sequence.unclassified` for a synthetic `AGUIError`.
- Updates to `frames/reader.test.ts`, `recorder/recorder.test.ts`, `runtime/runtime.test.ts`, `frames/store.test.ts`,
  `inspection/session.test.ts` for rule ids, several findings per frame, and import and export.
- `tests/e2e/hosted/rules.spec.ts`: the production page with a configured agent whose declaration the scripted agent
  breaks (inline, and by URL on the page's origin), checking the finding in the frame detail and in an export.

### Docs

New `website/content/docs/rules.mdx`, placed after `inspection` in `meta.json`: the naming scheme, the stability rule,
one table per family with id, short description and what to check. Edits: `inspection.mdx` (kinds of finding gain the
two new kinds, the rule id, a link), `recordings.mdx` (the `rule` field), `internals.mdx` where it describes findings,
`troubleshooting.mdx` where it names a finding. The docs tests that read `runs.mdx`, `event-views.mdx`,
`development.mdx` and `dependencies.mdx` keep passing: no script and no dependency is added.

## Project Structure

### Documentation (this feature)

```text
specs/007-protocol-rule-catalogue/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── rule-catalogue.md
│   └── finding-format.md
├── checklists/requirements.md
└── tasks.md             # from /speckit-tasks
```

### Source Code (repository root)

```text
packages/inspector/
├── src/
│   ├── contracts.ts                    # FindingKind, RuleId, Finding.rule
│   ├── core/
│   │   ├── rules/                      # new
│   │   │   ├── catalogue.ts
│   │   │   ├── sequence.ts
│   │   │   └── frame-rules.ts
│   │   ├── frames/index.ts             # rule step, declared option, several findings per frame
│   │   ├── recorder/index.ts           # rule ids on transport and capture findings
│   │   ├── runtime/index.ts            # rule ids on client failures, setDeclaredCapabilities
│   │   ├── store/index.ts              # rule check in addFinding
│   │   ├── session-files/index.ts      # optional rule, new kinds
│   │   └── config/index.ts             # LoadedCapabilities.declared
│   ├── app/index.tsx                   # pushes the declaration to the runtime
│   └── views/
│       ├── theme/primitives.tsx        # Finding gets a rule prop
│       └── inspection/frames.tsx       # rule ids, warn variant for the new kinds
└── tests/rules/                        # new: catalogue, fixtures, compat, capability, sequence
examples/reference-agent/rule-fixtures.ts   # new
tests/e2e/hosted/rules.spec.ts              # new
tests/e2e/hosted/support.ts                 # one more scripted agent path
website/content/docs/                       # rules.mdx (new), meta.json, inspection.mdx, recordings.mdx, internals.mdx
.changeset/                                 # two minor changesets
```

**Structure Decision**: One new core module beside the existing ones, because the rules are used by the reader, the
runtime, the store and the importer, and none of them should own the list. Tests follow the existing `tests/<area>`
grouping. Fixtures follow the existing reference-agent fixtures, which the demo and the next minor's suite reuse.

## Post-design constitution check

Unchanged from the table above. The design adds no dependency, no request and no stored credential, keeps the core
free of React, and keeps the raw frames and the client's stream as they were. The one decision that touches a principle
is the compat mirror (principle II). It is recorded in research.md, decision 4, and pinned by a test against the real
client.
