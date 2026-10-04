# Quickstart: validating A2UI v0.8 surfaces and catalog aliases

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Run from the repository root. Node 24 or newer, uv for the Python tests, Playwright's Chromium for the browser
checks (`npx playwright install chromium`).

## Setup

```sh
npm ci --ignore-scripts
```

## 1. The v0.8 story, by hand (US1, US2, US4)

```sh
npm run build
node examples/reference-agent/server.ts   # prints the address it serves on
```

Open the hosted page, pick the A2UI agent and send `Review an expense report (v0.8)`.

Expected: two surfaces, `expense` and `status`. Fill the amount, choose a category, tick the checkbox and press
"Submit expense". A new run starts, its request body holds `forwardedProps.a2uiAction.userAction` with the five fields
and the values you entered, and the status line changes. Switch the card to JSON: the operations are what the agent
sent, with no `version` key.

The public demo has the same story under the A2UI showcase agent (browser-local example).

## 2. An alias, by hand (US3)

Serve a `config.json` with one alias, for example one that maps `https://catalog.invalid/custom.json` to
`https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`, then send `Probe the sandbox`.

Expected: the surface whose entry named that id is drawn. Remove the alias and reload: that entry reports
`Catalog not found: https://catalog.invalid/custom.json` with the entry under "As received". Add a bad alias
(`"catalogAliases": { "": "x" }`): the page starts, with a configuration warning.

## 3. Automated checks

```sh
npm run typecheck
npm run test:unit -- packages/inspector/tests/a2ui packages/inspector/tests/config tests/demo
npm run test:e2e -- tests/e2e/a2ui tests/e2e/config tests/e2e/public-demo --workers=2
uv sync --project packages/python --locked --extra embedded --group test
uv run --project packages/python python -m unittest discover -s packages/python/tests
npm run build && npm run check:bundle
npm run check:ci
```

| Scenario | Proves |
| --- | --- |
| `packages/inspector/tests/a2ui/versions.test.ts` | Version of each entry, refusals and their text, order, per-version surface ids |
| `packages/inspector/tests/a2ui/catalogs.test.ts` | The id table, alias rules and warnings, built-in alias as a row, ids against the packages |
| `packages/inspector/tests/a2ui/surfaces.test.ts` (extended) | Diff (unchanged, appended, rebuilt) for v0.8, refusal report-back, mixed lists, nothing rewritten |
| `tests/e2e/a2ui/v08.spec.ts` | Drawing, action round trip, typed text, keyboard, guards, theme, zero requests and console errors |
| `tests/e2e/config/settings.spec.ts` (extended) | Alias warnings, and a configured alias drawing a surface through the whole app |
| `tests/e2e/public-demo/a2ui-showcase.spec.ts` (extended) | The v0.8 story in the demo |
| `packages/python/tests/test_embedding.py` (extended) | `catalog_aliases` reaches `config.json` |
| `npm run check:bundle`, `check:bundle:renderer` | Both limits, with the v0.8 renderer in |

## Done when

`npm run check:ci` passes, the story round-trips by hand, and the A2UI and configuration pages describe what you saw.
