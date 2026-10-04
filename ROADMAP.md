# agui-inspector roadmap

Feature specifications define requirements and acceptance criteria. The
[constitution](.specify/memory/constitution.md) governs engineering decisions across releases.
The [original product brief](docs/reference/product-brief.md) is frozen for source traceability
and planning input.

## Current status

As of 2026-10-04. This is the one summary of where the release stands.

Released:

- 0.1.0, on [PyPI](https://pypi.org/project/agui-inspector/) since 2026-10-03 (`pip install "agui-inspector[embedded]"`)
  and on [npm](https://www.npmjs.com/package/agui-inspector) since 2026-10-04, with provenance. It has embedded
  Starlette and FastAPI support, the hosted page, npm static assets for other servers, the recorder, views for all 31
  baseline event types, manual interrupt and tool replies, A2UI v0.9 surfaces, configuration, presets and client
  profiles, raw submissions, and session export and import. The [MVP specification](specs/001-inspector-mvp/spec.md)
  defines its scope.
- The public demo at <https://dogganidhal.github.io/agui-inspector/>, deployed from `main` by `pages.yml`. See
  [public demo](https://dogganidhal.github.io/agui-inspector/docs/demo/).
- The docs site at <https://dogganidhal.github.io/agui-inspector/docs/>, deployed with the demo.

Releases go through `release.yml`: a changeset per change, the `chore: version packages` pull request, then the
maintainer's approval of the `pypi` and `npm` deployments. See
[distribution](https://dogganidhal.github.io/agui-inspector/docs/releases/). Nothing in this repository authorizes
publishing, tagging or releasing. Each remains the maintainer's decision.

Next is [0.2.0](#020). There is no 1.0.0 target for now. [Decisions](#decisions) explains why.

## 0.2.0

0.2.0 ships when every item below has merged. Each item has an issue and starts as a feature spec through Spec Kit.
None of them waits for another, so the order is a priority: branding first, then the best impact for the effort.

| # | Capability | Scope | Impact | Effort | Issue |
| --- | --- | --- | --- | --- | --- |
| 1 | Branding | The adopter's logo and product name in the top bar, set in `config.json` and through `mount_inspector` | High | Small | [#73](https://github.com/dogganidhal/agui-inspector/issues/73) |
| 2 | Client automation | Interrupts resolved or cancelled automatically, and scripted client tool results, set in the client profile | Medium | Small | [#74](https://github.com/dogganidhal/agui-inspector/issues/74) |
| 3 | CLI and proxy | `npx agui-inspector --target <url>`: local bundle serving, loopback-only listener, explicit target allowlist, unchanged target bytes | High | Medium | [#75](https://github.com/dogganidhal/agui-inspector/issues/75) |
| 4 | JS server helpers | Express, Hono and Next.js helpers with the same contract as `mount_inspector` | High | Medium | [#76](https://github.com/dogganidhal/agui-inspector/issues/76) |
| 5 | Protocol diagnostics | A rule catalogue with ids, protocol version handling, and findings for frames that contradict declared capabilities | High | Medium | [#77](https://github.com/dogganidhal/agui-inspector/issues/77) |
| 6 | A2UI v0.8 and catalog aliases | v0.8 surfaces through the v0.8 renderer of `@a2ui/react`, and catalog aliases in the config | Medium | Medium | [#78](https://github.com/dogganidhal/agui-inspector/issues/78) |
| 7 | Inspection views | Subagent lanes and a timeline, state history with diffs, a waterfall of runs, and Markdown on demand | High | Large | [#79](https://github.com/dogganidhal/agui-inspector/issues/79) |
| 8 | Transport and resumption | The protobuf encoding and resumable runs through `connectAgent` | Low | Medium | [#80](https://github.com/dogganidhal/agui-inspector/issues/80) |
| 9 | Plugins | Hooks before a run and on its input, header providers, and renderers for custom events and activities | Medium | Large | [#81](https://github.com/dogganidhal/agui-inspector/issues/81) |

Branding has three constraints. The logo comes from the page's own origin or a `data:` URI, so the content security
policy and the no-third-party-request rule stay as they are. A bad value shows a configuration warning and never stops
startup. Without a brand, the default mark and name stay.

[#86](https://github.com/dogganidhal/agui-inspector/issues/86) brings the docs in line with this roadmap. Several pages
still mention 1.0.0 plans.

## Next minor

These build on 0.2.0 and ship in the release after it.

| Capability | Scope | Needs | Issue |
| --- | --- | --- | --- |
| Conformance suite | `agui-inspector test --target <url>` with JSON and JUnit reports, and a violating test for every catalogue rule | #75, #77, #82 | [#83](https://github.com/dogganidhal/agui-inspector/issues/83) |
| Python reference agent | The scripted, model-free scenarios of the TypeScript reference agent, in Python | | [#82](https://github.com/dogganidhal/agui-inspector/issues/82) |
| Replay | `agui-inspector replay <session file>` serves a recorded session as an AG-UI endpoint, for client tests | #75 | [#84](https://github.com/dogganidhal/agui-inspector/issues/84) |
| Rule docs and examples | A page per rule, and examples for the major AG-UI server frameworks | #77 | [#85](https://github.com/dogganidhal/agui-inspector/issues/85) |

## Decisions

Taken on 2026-10-04, when this roadmap was revised.

- The next release is 0.2.0. There is no 1.0.0 target. The 1.0.0 acceptance criteria in the constitution apply to a
  1.0.0 release only, and none is planned.
- A release needs `npm run check:ci` to pass and the maintainer's approval of the deployment. There are no other
  release gates and no manual release checks. agui-inspector is a developer tool, and the checks should match that.
- 0.2.0 is the nine capabilities above. It ships when all of them have merged. Work that depends on them goes into the
  next minor.
- Branding is new in this plan and comes first. The other eight follow impact over effort.
- Only features that AG-UI and A2UI have already released are planned. WebSocket and push transports, protocol
  capability discovery, and A2UI v1.0 rendering wait until upstream ships them.
- The in-app inspector is not planned. It is too soon to tell how a custom element should isolate the styles that A2UI
  injects into the document. This closes G-06 for now.
- The inspector does not move upstream for now, and the package keeps the name `agui-inspector`. This closes G-03.
- Formats stay at version 0. New fields are optional, as `theme` was in 0.1.0, so existing files keep working. A change
  that breaks an existing file comes with migration steps in the changelog.

## Open decisions

None.

Earlier plans, including the 1.0.0 target and the 0.1.0 decision log, are in the
[previous version of this file](https://github.com/dogganidhal/agui-inspector/blob/e400f85bafca94da65f1a4f0f348e2957bb708d0/ROADMAP.md).
