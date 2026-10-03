# agui-inspector roadmap

Feature specifications define requirements and acceptance criteria. The
[constitution](.specify/memory/constitution.md) governs engineering decisions across releases.
The [original product brief](docs/reference/product-brief.md) is frozen for source traceability
and planning input.

## 0.1.0 MVP

Status: implemented on main (W1/W2, PRs #3-#18). Release verification pending: SC-009 on the
physical runner, a manual smoke run in all MVP distribution modes, and the first publish (the Python release
workflow is in place and waits for the maintainer's tag; npm is not set up).
Three approved W3 follow-ups remain in [tasks](specs/001-inspector-mvp/tasks.md#wave-w3-release-decision-follow-ups).
The public-demo companion is planned in [feature 002](specs/002-public-demo/spec.md); its
implementation waits for all three W3 slices to merge and does not authorize package publication.

The [MVP specification](specs/001-inspector-mvp/spec.md) defines the accepted scope;
its [requirements checklist](specs/001-inspector-mvp/checklists/requirements.md) records the review.

- Embedded support for Starlette and FastAPI, a hosted page, and npm static assets for other servers.
- HTTP/SSE recording with raw frames, timing, schema and sequence findings, and terminal-event checks.
- Views for all 31 baseline event types, the conversation, and current state.
- Manual interrupt and tool replies, plus A2UI v0.9 surfaces and action round trips.
- Agent configuration, presets, and client profiles with browser persistence and JSON import/export.
- Raw JSON submissions, including schema-invalid inputs, and session export/import for inspection.
- Views styled through documented theme properties, so adopters can restyle the inspector without
  rebuilding it, delivered as optional light/dark maps in `config.json` (also accepted by Python).
  Unknown/private names or unsafe values produce visible nonfatal warnings; CSP is unchanged.
  The [UI design](specs/001-inspector-mvp/design/design.md) defines the properties.

Release criteria remain in the feature spec. The workload target is 5,000 retained frames, with at
least 95% of filter changes and frame expansions finishing visibly within 200 ms during capture.
The implementation plan fixes the benchmark profile. The M4 Pro headless result is informational;
headed physical M2 certification remains with the maintainer. The complete client
bundle is limited to 2 MB minified and 600 KB gzipped.

### Approved release decisions (2026-10-02)

- G-01 closed: MIT, `Copyright (c) 2026 Nidhal Dogga`; both distributions ship bundled-dependency
  third-party notices, including Apache-2.0 license texts and any NOTICE for `@a2ui/react`,
  `@a2ui/web_core` and `@a2ui/markdown-it`. D01 implements packaging/metadata and the exact
  DOMPurify 3.4.16 override/lock, Python 3.10/3.14 CI and benchmark-doc cleanup.
- G-02 closed: `agui-inspector` on npm and PyPI, both unregistered on this date.
  `@ag-ui/inspector` remains conditional on upstream adoption; G-03 remains open.
- G-07 closed by constitution 1.0.3 PATCH: inspector-held credentials remain memory-only and are
  never written by it; the recorder reads no headers. Target evidence, including credential
  echoes, remains unchanged, with the sensitive-data export warning. No redaction anywhere.
- G-08 closed without an extra integration PR: checkpoint 13 pass, 1 fail (F-01 embedded config
  path, fixed by #18), 2 pending (SC-008 credential part, D03; SC-009 physical M2, maintainer).
- G-09 closed: `config.json` theme light/dark public-property maps in every MVP mode; D02 delivers
  validation/application, Python support and root-scoped derived tokens to avoid host collisions.
- D03 adds the single middleware 0.0.11 default catalog id alias to the renderer's basic catalog,
  beside the catalog factory, plus the credential-echo end-to-end regression. General aliases
  remain 1.0.0 scope. `renderA2ui` is display-only and persists/exports; tool injection changes input.

Each W3 slice is one PR depending only on main after the decision-recording PR, with disjoint
ownership. Manifests remain private: no publishing, tags or releases are authorized. FR-040 remains.

### Python release workflow (2026-10-03)

Changesets drive the Python release. `.github/workflows/release-python.yml` keeps a `chore: version packages` pull request
up to date on `main`; merging it tags the version, runs the strict gate and publishes to PyPI through trusted
publishing, with no stored token. Nothing has run it: the maintainer still registers the trusted publisher, the `pypi`
environment and the repository setting that lets the version pull request open, and the manifests stay private (the
Python classifier included) until the first release PR. The npm release (provenance, a workflow of its own) is not set
up. See [distribution](docs/distribution.md).

### Public demo companion (2026-10-02)

Status: live at <https://dogganidhal.github.io/agui-inspector/> since 2026-10-02. The
[specification](specs/002-public-demo/spec.md), [implementation plan](specs/002-public-demo/plan.md) and
[three slices](specs/002-public-demo/tasks.md) (T001 to T017) are implemented and merged; the Pages workflow
deployed the demo from `main`.
The demo accompanies 0.1.0 without adding npm/PyPI publishing, tags, the release workflow,
JS server helpers or CLI to this feature.

- GitHub Pages serves the existing hosted app under `/agui-inspector/`. Demo-only same-origin
  service-worker endpoints reuse deterministic reference scenarios and return real HTTP/SSE
  through the ordinary transport/recorder/frame reader; no model or external example service.
- Example agents/presets/quick messages cover plain, interrupt, tools, slow, state, broken,
  A2UI surfaces/actions and all 31 baseline event types. First-page readiness, unavailable
  browser fallback and Pages sub-path routing are explicit acceptance requirements.
- Constitution 1.1.0 MINOR permits explicit default-off hosted startup opt-in for visitor-selected
  HTTPS and browser-supported HTTP loopback targets without inspector endpoint approval prompts.
  The page discloses the boundary; defaults, embedded auth, no telemetry/automatic third-party
  traffic, no hosted cookies, local scripts/no eval and memory-only credentials stay unchanged.
  Use `http://localhost:<port>` locally; Chromium IPv4 must be re-proven, other browsers checked
  manually, and IPv6 support is not claimed without exact CSP proof. No all-HTTP CSP fallback.
- Demo worker/bootstrap/config stay outside ordinary static/npm/Python artifacts; both complete
  asset sets retain the 2 MB/600 KB budgets and inherited 5,000-frame acceptance.
- P01 **visitor-policy** and P02 **shared-demo-endpoints** have disjoint paths and depend on
  main after W3 D01/D02/D03; P03 **demo-pages-delivery** depends on both, with at most one unmerged
  direct parent. It supplies integrated browser/package checks, docs/embedding link and the
  SHA-pinned least-privilege main-only Pages workflow.

Open gates are [G-D01 through G-D05](specs/002-public-demo/plan.md#open-gates): W3 merges, exact
numeric-loopback CSP evidence, native worker byte/Stop proof, separate maintainer Pages
authorization, and integrated budgets/package-isolation/CI evidence. Physical M2 certification
and MVP release/publishing decisions remain separate; planning does not enable Pages or deploy.

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
| A2UI compatibility | v0.8, v0.9, and v1.0 support plus general catalog aliases (one middleware-default/basic alias is already MVP scope) | Support in the A2UI project's renderer |
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

- G-03 upstream placement: whether `ag-ui-protocol/ag-ui` would accept `apps/inspector`, and when.
- G-04 capability discovery: conditional on a protocol-defined mechanism. The MVP uses inline
  declarations or a configured capabilities URL.
- G-05 WebSocket and push: conditional on AG-UI specifying their behavior. Capability names alone do not
  establish a transport contract.
- G-06 in-app element: decide how element isolation works with A2UI styles injected into the document.
  Shadow-root integration remains unresolved.
