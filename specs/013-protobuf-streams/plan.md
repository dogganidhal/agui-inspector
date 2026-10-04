# Implementation Plan: Protobuf streams

**Branch**: `gh-80-protobuf-and-resume` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-protobuf-streams/spec.md` (issue #80, narrowed; resumption is #95)

## Summary

The inspector learns to ask a server for the AG-UI protobuf encoding, to record its binary frames as received and to
show each one decoded. The encoding is a client profile setting with a per-agent default in the preset. It becomes a
third `ResponseKind`, which the guarded transport turns into the `Accept` header. The recorder stays blind to
headers: it records an exchange as protobuf because it was asked for protobuf. A second frame reader splits the
length-prefixed stream, decodes each frame with `@ag-ui/proto` and hands the decoded event to the same judging step
the server-sent-events reader uses, so the conversation, state, interrupt, tool and A2UI views work with no change.
`RawFrame` gains an optional `bytes` (base64), `Exchange` gains `encoding`, and the session file keeps both, with
import checks that the bytes and the decoded event agree. The protocol client reads the original response; only SSE
runs get the line-ending copy. The reference agent answers in protobuf when the request's `Accept` says so, and has
damaged-stream fixtures. [research.md](./research.md) has the reasoning for each decision.

## Technical Context

**Language/Version**: Strict TypeScript (`noUncheckedIndexedAccess`, `erasableSyntaxOnly`), Node 24 or newer, React 19.3
for views. The reference agent is erasable TypeScript that Node runs directly.

**Primary Dependencies**: `@ag-ui/core` 1.0.1, `@ag-ui/client` 1.0.1 (unchanged), and `@ag-ui/proto` 1.0.1 as a new
direct dependency of `packages/inspector`. It is already in `package-lock.json` through the client and already in the
bundle. No other new dependency (`@ag-ui/encoder` is not needed, see research 12).

**Storage**: None added. Browser storage keeps the client profile as before, now with the optional `encoding`.
Sessions are in memory and in the exported version-0 file.

**Testing**: `node --test` through `npm run test:unit` (esbuild-compiled, files under `packages/inspector/tests` and
`tests/`), Playwright for `tests/e2e` against `examples/reference-agent`, and `npm run check:ci` for the whole gate.

**Target Platform**: The one static bundle, in all modes (hosted, embedded in Starlette or FastAPI, npm assets).

**Project Type**: A static web application with a framework-free core, React views and a Python wrapper.

**Performance Goals**: The reader is linear in the bytes it receives. It keeps only the bytes of an unfinished frame
and does not copy the whole stream on each read. Views work from decoded frames, so filtering and expanding cost the
same as for server-sent events. No new benchmark (spec assumption).

**Constraints**: Production bundle at most 2,000,000 bytes minified and 600,000 gzipped (now 1,227,500 and 308,758).
The recorder reads no header. No new network destination or telemetry. Credentials stay in memory. Version-0 formats
with optional fields only.

**Scale/Scope**: One frame per protobuf message, up to the client's 10 MB limit each. A session of thousands of frames
behaves as it does for server-sent events.

## Constitution Check

*Gate: passed before research and again after design.*

| Principle or rule | Assessment |
| --- | --- |
| I. The wire comes first | Pass. Each frame keeps its bytes, arrival order and offset. Damaged, unknown and unreadable bytes are kept with a finding, never dropped or repaired (research 5). The client reads the original response, and the CRLF exception of principle I stays on the SSE branch only (research 4). Raw evidence stays apart from the decoded event: `bytes` is the evidence, `parsed` is derived (research 6). |
| II. The protocol, not a framework | Pass. Decoding is `@ag-ui/proto`, the schema check is `@ag-ui/core`, the client is `@ag-ui/client`. The reader and the recorder stay framework-free; only the views are React. |
| III. Generic core, application presets | Pass. The encoding is a profile setting and a preset field. There is no server-specific route or convention in the core. |
| IV. Local-only and credential privacy | Pass. No new request target, no telemetry. The recorder reads no header (the answer is read in the chosen encoding, not the one a header names). Exports carry no header and keep the sensitive-data warning, which now covers binary frames. Redaction is still not allowed and none is added. The token reaches protobuf requests through the guarded transport only. |
| V. Small and auditable | Pass. One new direct dependency with an exact pin, a lockfile entry and a row (it is already bundled). No `@ag-ui/encoder`. One new reader, one shared judging step, optional fields. No speculative option such as detection or fallback. |
| VI. Every event type has a view | Pass. Protobuf yields the same events, so the same views apply. A fixture test covers each of the 31 types over protobuf. Views, fixtures and docs change together in this feature. Unrecognized and undecodable frames stay available for raw inspection. |
| Architecture and distribution | Pass. One static bundle. The CSP and `connect-src` do not change. Bundle budget checked by `npm run check:bundle`. Python ships the same prebuilt bundle. |
| Release scope | Pass. ROADMAP 0.2.0 item 8, narrowed by the maintainer. `ROADMAP.md` row 8 still names resumption, which the orchestrator updates (research 15). |
| Workflow and quality gates | Pass. Behavior changes get regression tests, end-to-end tests use only the reference agent, export and import round trips are tested, header absence in exports is tested. |
| Formats | Pass. Version 0, optional fields, existing files keep loading. The changeset documents the new fields. |

No violation, so there is nothing under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/013-protobuf-streams/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── binary-frames.md
│   ├── recording-format.md
│   └── settings.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source code (repository root)

```text
packages/inspector/
├── package.json                         # + "@ag-ui/proto": "1.0.1"
├── src/
│   ├── contracts.ts                     # Encoding, ResponseKind + 'protobuf', Exchange.encoding, RawFrame.bytes,
│   │                                    #   FindingKind + 'binary', ClientProfileSettings.encoding, Preset.encoding
│   ├── core/
│   │   ├── frames/
│   │   │   ├── index.ts                 # shared judging step; createProtobufFrameReader; sink chooses the reader
│   │   │   └── bytes.ts                 # NEW: base64 and hex helpers (reader, import, views)
│   │   ├── recorder/index.ts            # streaming test + exchange.encoding (two small edits)
│   │   ├── runtime/
│   │   │   ├── index.ts                 # encodingFor at dispatch and sendRaw; skip the line-ending copy for protobuf;
│   │   │   │                            #   clientFailure maps the client's binary errors
│   │   │   ├── transport.ts             # ACCEPT.protobuf from AGUI_MEDIA_TYPE
│   │   │   └── line-endings.ts          # comment only
│   │   ├── profiles/index.ts            # SETTINGS, parse, envelope, encodingFor
│   │   ├── presets/index.ts             # parsePreset key, PreparedPreset.encoding
│   │   ├── session-files/index.ts       # export fields, import checks, finding kind
│   │   └── store/index.ts               # appendFrame invariant
│   └── views/
│       ├── inspection/frames.tsx        # binary tag, detail (hex, decoded, copy), exchange tag
│       ├── inspection/model.ts          # typeLabel, summarizeFrame, frameMatches, hexDump
│       └── settings/index.tsx           # Encoding row
└── tests/
    ├── frames/protobuf-reader.test.ts   # NEW
    ├── frames/store.test.ts             # invariant
    ├── recorder/recorder.test.ts        # protobuf exchanges
    ├── runtime/runtime.test.ts          # Accept, bytes unchanged, precedence, raw
    ├── config/settings.test.ts          # profile and preset encoding
    ├── inspection/session.test.ts       # round trip, import checks
    ├── inspection/frames.test.ts        # views model
    ├── inspection/host.tsx              # run(path, body, encoding)
    └── foundation/                      # reference agent, upstream pins, contracts

examples/reference-agent/
├── protobuf.ts                          # NEW: frameProtobuf, toProtobuf, acceptsProtobuf (no Node, no React)
├── protobuf-fixtures.ts                 # NEW: recorder scenarios, complete and damaged
├── interactive-scenarios.ts             # honors Accept; records accept and the bytes written
├── server.ts                            # honors Accept on /agent
└── scenarios.ts, pacing.ts              # unchanged (the demo bundle does not import protobuf.ts)

tests/e2e/
├── inspection/support.ts                # /scenario/protobuf/<name> serves protobuf scenarios by announced content type
├── inspection/frames.spec.ts, session.spec.ts   # binary rows, detail, damaged streams, round trip
├── runtime/protobuf.spec.ts             # NEW: the runtime harness, requests, continuations, preset default, raw
└── hosted/protobuf.spec.ts              # NEW: the assembled app, Encoding in two steps, saved profile, export and import

website/content/docs/
├── protobuf.mdx                         # NEW page, in meta.json after "inspection"
├── runs.mdx, configuration.mdx, presets.mdx, recordings.mdx, inspection.mdx, troubleshooting.mdx,
├── internals.mdx, dependencies.mdx, event-views.mdx, index.mdx, status.mdx
README.md                                # one line

.changeset/*.md                          # agui-inspector (minor), agui-inspector-python (minor)
package-lock.json                        # the workspace entry for packages/inspector lists the new dependency
```

**Structure Decision**: The existing layout holds the feature. The reader joins the SSE reader in
`core/frames/index.ts` because both need the judging step and the sink, and a second file would import from the first
while the first imports from it. The byte helpers are the only new source module, because three layers use them. The
reference agent gets two modules beside its other fixtures.

## Work, in dependency order

1. **Rebase first.** `git fetch origin && git rebase origin/main` before any code. Issue #77 rewrites findings in the
   recorder, the frame reader, the store and the session files, and issue #74 edits the profile. Everything below is
   written on top of whatever has merged. Resolve conflicts keeping their features.
2. **Contracts and the dependency.** The types in `contracts.ts`; `@ag-ui/proto` in `packages/inspector/package.json`
   and the lockfile; the row in `dependencies.mdx`. Update `foundation/contracts.test.ts` if it pins the unions.
3. **Bytes helpers and the reader.** `frames/bytes.ts`; the shared judging step; `createProtobufFrameReader`; the sink
   keyed by exchange encoding; the store invariant. If #77 has merged, route the decoded event through its `compat` and
   `capability` checks and give the new findings rule ids (`binary.undecodable-frame`, `binary.unreadable-stream`,
   `binary.client-failed`, new family `binary`), with a fixture for each in its catalogue.
4. **Recorder and transport.** The streaming test, `exchange.encoding`, `ACCEPT.protobuf`.
5. **Settings, runtime.** Profile and preset `encoding`, `encodingFor`, the runtime's use of it, the line-ending copy
   skipped for protobuf, `clientFailure` for the client's three binary errors.
6. **Session files.** Export fields and the import checks of [contracts/recording-format.md](./contracts/recording-format.md).
7. **Views.** Model helpers, the frame row and detail, the exchange tag, the Settings row.
8. **Reference agent.** `protobuf.ts`, the two adapters, `protobuf-fixtures.ts`, the support server.
9. **End-to-end tests.**
10. **Docs, changesets, README.** Written with the code, checked by `npm run check:ci`.

## Tests

Each row names the regression test that must exist (constitution: behavior changes have regression coverage).

| Area | Test |
| --- | --- |
| Reader | All 31 fixtures as protobuf frames give the same type, summary and decoded content as the SSE reader (SC-003). The baseline protobuf run cut at every byte, and in uneven pieces, gives the same frames and bytes (SC-004). Offset is the completing read's. Zero length, unknown event, garbage payload, schema-invalid event, truncated frame, a frame larger than 10 MB with the rest kept (and one of exactly 10,485,760 bytes read as a frame), and no terminal event each give the frame and finding of the contract. A reader whose output throws behaves as the SSE reader does. `push` after `end` throws. |
| Upstream pins | The reference fixtures are read by `parseProtoStream` from `@ag-ui/client` (framing proof). A frame of exactly the limit is accepted and one byte more is refused by the client, matching `MAX_FRAME_BYTES`. The client's three binary error messages match the patterns in `clientFailure`. The strict content-type behavior is pinned. |
| Recorder | A `protobuf` request records an exchange with `encoding: 'protobuf'` and passes chunks as bytes; a non-2xx answer is kept as text; stop and failure end as for SSE; no header is read (the existing check, extended); the response given to the caller is the original. |
| Runtime | Accept is the media type for a run, a continuation, a surface action and a raw submission with protobuf, and `text/event-stream` otherwise; preparation unchanged; bodies identical with and without the setting; profile beats preset beats default; a change applies to the next request and keeps the thread; the client reads a text delta containing `\r\n` unharmed over protobuf (the canonicalizer is skipped); a client decode failure becomes a `binary` finding on the run. |
| Profile and preset | `encoding` parses, exports, imports and persists; absent means the default; an unknown value names the field; a 0.1.0 file imports unchanged. |
| Session files | Round trip keeps every frame's bytes, order, offsets and findings. Each import check of the contract has a failing file. A 0.1.0 file imports. An SSE-only export has none of the new fields. No headers in the export. |
| Views model | Type label, summary, filter and hex dump (4,096-byte limit, counts) for decoded, unknown, undecodable and partial frames. |
| End to end | Full app against the reference agent: Settings sets protobuf, the server saw the `Accept` header, the exchange has the tag and one frame per message with bytes equal to what the server wrote (SC-001, SC-005); a continuation after an interrupt and after tool results works over protobuf; export then import keeps the bytes (SC-002); each damaged stream keeps its bytes with its finding (SC-006); a server that answers SSE to a protobuf request keeps every byte with the unreadable finding; the network allowlist check stays. |
| Reference agent | `/agent` answers by `Accept`; the protobuf body decodes to the same events as the SSE body for the interactive scenarios. |
| Docs | The existing docs tests pass; the new page is in `meta.json`; the dependencies row exists (the policy test). |

## Docs

One new page, `protobuf.mdx` ("Protobuf streams"): choose the encoding in Settings and in a preset; what the inspector
sends; what a server must send back (the exact media type as `content-type`, the four-byte length prefix, `EventEncoder`
from `@ag-ui/encoder` does it); how frames, bytes and findings look; recordings; limits (10 MB per frame, no detection,
resumption is not part of this release, issue #95). Short edits elsewhere: the request headers row and raw
submissions in `runs.mdx`; `encoding` in `configuration.mdx` and `presets.mdx`; the fields and checks in
`recordings.mdx`; the frame detail in `inspection.mdx`; three entries in `troubleshooting.mdx` (a content type with a
parameter, an answer in the other encoding, a 406 or similar status); the reader, the exempted line-ending copy and the
shared judging step in `internals.mdx`; the `@ag-ui/proto` row; a line in `event-views.mdx`, `index.mdx` and
`status.mdx` that SSE is no longer the only encoding; and a line in the README. Short sentences, no em dashes, no
marketing, no bold labels.

## Release

`agui-inspector` (minor) and `agui-inspector-python` (minor, the wheel ships the bundle). The text says: protobuf
streams are recorded and decoded, the encoding is a profile setting with a preset default, session files and profiles
gain optional fields and stay at version 0, nothing to migrate.

## Coordination

- **#77 (spec 007)**: merged as #94 before this feature. The judging step is shared, so a protobuf frame gets the `compat` and
  `capability` rules too, and the three `binary` rules (`binary.undecodable-frame`, `binary.unreadable-stream`,
  `binary.client-failed`) are in the catalogue with a fixture each, in the rules page, and in the catalogue test (42 rules).
- **#74**: the profile list in `SETTINGS`, `parseProfileSettings` and the envelope. A list merge.
- **#86 (docs alignment)**: `index.mdx`, `status.mdx` and the README may change under this feature. Re-read before editing.
- **#95**: resumption. Nothing here prevents it. `connect()` would be an agent method and would record through the
  same recorder and readers.

## Risks

- The 10 MB constant is a copy of an unexported client value. The pin test fails first if the client changes it.
- `clientFailure` matches three client messages. The same technique, and the same pin, as #77's sequence rules.
- The tail extraction touches code that #77 is rewriting. It is done after the rebase and kept to one function.
- A server that sends the media type with a parameter makes the client read SSE. The recording is right and the run
  fails. The docs name it (troubleshooting).
