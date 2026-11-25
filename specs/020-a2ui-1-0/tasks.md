# Tasks: A2UI 1.0 surfaces

**Input**: [spec](spec.md), [plan](plan.md).

**Format**: `T###` is one task. `[USn]` maps it to a user story. Tests come with the code they cover.

## Phase 1: Renderer pins

- [x] T001 Pin `@a2ui/react` and `@a2ui/web_core` to 0.16.1 in `packages/inspector/package.json`, install with
  `--ignore-scripts`, drop the root DOMPurify override. Update `THIRD_PARTY_NOTICES.txt` (three copies), the
  dependencies and releases docs, and `packages/python/tests/test_distribution.py`.
- [x] T002 Move imports to the 0.16 entry points: `A2uiSurface` and `ReactCatalogComponent` from `@a2ui/react`, the
  v0.9 basic catalog from `@a2ui/web_core/v0_9/basic_catalog`, `MessageProcessor` from `@a2ui/web_core`, in `src`,
  tests, `scripts/bundle-budget.mjs` and `tests/benchmarks/interaction.spec.ts`.
- [x] T003 Adjust the v0.9 e2e checks the renderer changed: the date and time pair, the `display: contents` hosts in the
  Row wrap check, and the v0.8 spec, which now allows no policy violation.

## Phase 2: 1.0 surfaces (US1, US3)

- [x] T010 [US1] `core/a2ui/catalogs.ts`: `'1.0'`, `BASIC_V10`, table row. Tests in `catalogs.test.ts`.
- [x] T011 [US1] `core/a2ui/operations.ts`: `"1.0"`, refusal texts. Tests in `versions.test.ts`, `v10.test.ts`, and the
  texts in `tests/demo/a2ui-showcase.test.ts` and `tests/e2e/public-demo/a2ui-showcase.spec.ts`.
- [x] T012 [US1] `core/a2ui/index.ts`: root processor, `AliasIds`, `surfaceVersion`.
- [x] T013 [US1] `views/a2ui/catalog.tsx`: guarded 1.0 catalog and aliases per version; `actions.ts` keeps each catalog's
  `openUrl` schema. Tests in `catalog.test.ts`, `v10.test.ts`.
- [x] T014 [US3] `views/a2ui/components.tsx`: the `agui-a2ui-unknown` stand-in element. Tests in `catalog.test.ts`,
  `v10.test.ts`, `tests/e2e/a2ui/components.spec.ts`, `surfaces.spec.ts`, `v10.spec.ts`.
- [x] T015 [US1] `views/a2ui/index.tsx`: `data-version` per surface.
- [x] T016 [US1] Headless: 1.0 catalogs, `@path`, `catalogAliases` option. Test in `tests/headless/a2ui.test.ts`.

## Phase 3: Renderer capabilities (US2)

- [x] T020 [US2] `contracts.ts` and `core/profiles`: `sendA2uiCapabilities`, `rendererCapabilities`, the merge order.
  Tests in `tests/config/settings.test.ts`.
- [x] T021 [US2] `core/runtime` and `app/startup.ts`: `catalogAliases` in the settings. Test in
  `tests/runtime/runtime.test.ts`; expectations updated in `prepare.test.ts` and `replies.test.ts`, and in the e2e
  specs that compare a whole `forwardedProps`: `config/settings.spec.ts`, `hosted/launch.spec.ts`,
  `plugins/hooks.spec.ts` and `plugins/plugins.spec.ts`.
- [x] T022 [US2] Settings switch in `views/settings/index.tsx`.

## Phase 4: Reference agent and demo

- [x] T030 `examples/reference-agent`: `v10Card`, `v10Continuation`, `declares10`, `V10_CARD_MESSAGE`, made-up ids only.
  Tests in `v10.test.ts`.
- [x] T031 `demo/config.json`: the quick message, the alias and the declared versions. Tests in `tests/demo`.
- [x] T032 `tests/e2e/a2ui/v10.spec.ts`: the card under `style-src 'self'`, the flagged component, the envelope, the
  missing alias and a mixed list.

## Phase 5: Docs and release notes

- [x] T040 `website/content/docs`: a2ui, configuration, embedding, tests-and-agents, demo, status, internals,
  dependencies, releases, development, agent-guide; `packages/inspector/public/llms.txt`; `README.md`; `AGENTS.md`;
  the `mount_inspector` docstring; `ROADMAP.md`.
- [x] T041 Changeset: minor for `agui-inspector` and `agui-inspector-python`.
- [x] T042 `npm run check:ci`.
