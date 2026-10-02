# agui-inspector roadmap

Feature specifications define requirements and acceptance criteria. The
[constitution](.specify/memory/constitution.md) governs engineering decisions across releases.
The [original product brief](docs/reference/product-brief.md) is frozen for source traceability
and planning input.

## 0.1.0 MVP

Status: specified. Planning, implementation, and release verification have not started.

The [MVP specification](specs/001-inspector-mvp/spec.md) defines the accepted scope;
its [requirements checklist](specs/001-inspector-mvp/checklists/requirements.md) records the review.

- Embedded support for Starlette and FastAPI, a hosted page, and npm static assets for other servers.
- HTTP/SSE recording with raw frames, timing, schema and sequence findings, and terminal-event checks.
- Views for all 31 baseline event types, the conversation, and current state.
- Manual interrupt and tool replies, plus A2UI v0.9 surfaces and action round trips.
- Agent configuration, presets, and client profiles with browser persistence and JSON import/export.
- Raw JSON submissions, including schema-invalid inputs, and session export/import for inspection.
- Views styled through documented theme properties, so adopters can restyle the inspector without
  rebuilding it. The [UI design](specs/001-inspector-mvp/design/design.md) defines the properties.

Release criteria remain in the feature spec. The workload target is 5,000 retained frames, with at
least 95% of filter changes and frame expansions finishing visibly within 200 ms during capture.
The implementation plan must fix the benchmark profile before implementation. The complete client
bundle is limited to 2 MB minified and 600 KB gzipped.

Next step: `/speckit-plan` for `specs/001-inspector-mvp`.

## 1.0.0 stable target

Status: roadmap only. Individual feature specifications, implementation plans, and tasks have not
been created.

This release inherits the MVP. Browser-persisted profiles and JSON profile exchange are already in
0.1.0 scope; freezing those formats as version 1 remains a 1.0.0 commitment.

Promote one capability at a time into Spec Kit when its dependencies are understood and the work
is selected for implementation. No delivery order or dates are assigned below.

| Capability | Planned scope | Dependencies |
| --- | --- | --- |
| CLI and proxy | Local bundle serving, explicit target allowlist, loopback-only listener, unchanged target bytes | MVP bundle and configuration |
| JS server helpers | Express, Hono, and Next.js route-handler integrations | Static distribution and embedding contract |
| In-app inspector | Observe a host `AbstractAgent` without requests of its own | Element and A2UI style-isolation decisions |
| Transport and resumption | Binary/protobuf transport, reconnection, and resumable runs | MVP recording contracts and protocol/client support |
| Protocol diagnostics | Rule catalogue, protocol/version handling, and capability-consistency findings | Protocol rules and declared capabilities |
| Client automation | Automatic interrupt resolution/cancellation and scripted tool replies | Manual reply flows and client profiles |
| Conformance | Server test suite, JSON/JUnit reports, and Python/TypeScript reference agents | Rule catalogue and capability-aware scenarios |
| Replay | Serve recorded sessions as AG-UI endpoints for client tests | Session format and recorded timing |
| Inspection views | Subagent lanes and timelines, state history/diffs, waterfalls, and optional conversation Markdown | Recorded events and run relationships |
| Plugins | Before-run/input hooks, header providers, and custom event/activity renderers | Preset limits and a versioned extension contract |
| A2UI compatibility | v0.8, v0.9, and v1.0 support plus catalog aliases | Support in the A2UI project's renderer |
| Documentation | A page per rule and examples for major server frameworks | Rule catalogue and supported integrations |

### Release criteria

- Config, session, profile, and plugin API formats are published as version 1 with JSON Schemas.
  After 1.0.0, format changes are additive; incompatible changes wait for 2.0.0.
- All four distribution modes run the reference agent's full scenarios.
- The server suite runs in CI against Python and TypeScript reference agents, with a violating test
  for every catalogue rule.
- Every supported event type has a dedicated view and fixture test.
- Sessions support 50,000 frames, with the A2UI renderer loaded on demand.
- A WCAG 2.2 AA accessibility audit passes, including keyboard navigation.

## Open decisions

- License: MIT remains the original candidate. Confirm the choice and dependency obligations before
  publishing.
- Package names: confirm npm and PyPI availability for `agui-inspector` before publishing.
  `@ag-ui/inspector` remains conditional on upstream adoption.
- Upstream placement: whether `ag-ui-protocol/ag-ui` would accept `apps/inspector`, and when.
- Capability discovery: conditional on a protocol-defined mechanism. The MVP uses inline
  declarations or a configured capabilities URL.
- WebSocket and push: conditional on AG-UI specifying their behavior. Capability names alone do not
  establish a transport contract.
- In-app element: decide how element isolation works with A2UI styles injected into the document.
  Shadow-root integration remains unresolved.
- Theme delivery: decide how hosts supply `--agui-*` overrides: a file next to `config.json`, a
  configuration field, or host-page CSS. 0.1.0 fixes the properties only.
