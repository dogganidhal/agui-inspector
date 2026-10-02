## Summary

<!-- What changes, and why? Keep this to a few sentences. -->

## Context

<!--
Link an issue, feature spec, or relevant ROADMAP.md item. No issue is required.
Identify the target release when relevant, and explain any change to the agreed scope.
-->

## Validation

<!--
List commands or scenarios run and their results. Explain anything not tested and why.
For behavior changes, cover affected event types, error cases, and relevant round trips.
For docs-only changes, describe what you reviewed. For UI changes, attach screenshots or a clip.
Use synthetic or redacted data in logs, session files, and screenshots.
-->

## Impact and review

<!--
Note affected modes (embedded, hosted, CLI, in-app), dependencies, and compatibility or migration
requirements. Write "None" when there is no impact.
Check verified items only. Mark unrelated items N/A; explain any unmet applicable checks.
-->

- [ ] Scope follows the linked feature spec and [roadmap][roadmap]; design follows the
  [constitution][constitution].
- [ ] Raw requests and frames retain content, order, and timing; malformed frames remain inspectable.
- [ ] Changed protocol behavior has event fixtures and relevant reference-agent coverage.
- [ ] Credentials remain memory-only, recordings/exports omit headers, and network access follows
  the [privacy rules][constitution].
- [ ] API and saved-format changes follow versioning rules and document any required migration.
- [ ] Applicable bundle, frame-count, accessibility, and distribution requirements have been checked.

[roadmap]: https://github.com/dogganidhal/agui-inspector/blob/main/ROADMAP.md
[constitution]: https://github.com/dogganidhal/agui-inspector/blob/main/.specify/memory/constitution.md
