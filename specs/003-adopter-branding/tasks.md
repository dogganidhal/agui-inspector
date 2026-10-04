# Tasks: Adopter branding

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md),
[contract](contracts/brand.md), [validation guide](quickstart.md).

**Format**: `T###` is one checklist task. `[P]` means the task touches different files from the other open tasks and
can run in parallel. `[USn]` maps a task to a user story in the spec. Tests come before the code they cover, and each
test must fail first. Tests are required by the constitution and by FR-016.

**Rules for every task**: no new dependency, no new `npm run` script, no change to the content security policy, to
`hosting-config.json` or to the default mark's four copies. Docs use short plain sentences, no em dashes and no bold
labels. Run `npm run typecheck` after each source task and `npm run test:unit -- <path>` for the tests it names.

## Phase 1: Setup

No project setup is needed: the change adds no dependency, tool or package.

- [x] T001 Record a green baseline before any edit: `npm run typecheck` and `npm run test:unit` from the repository root (`package.json` scripts). Stop and report if either fails on a clean checkout.

## Phase 2: Foundational (blocks every story)

The reader and the startup hand-off. Every story needs a validated brand in the page.

- [x] T002 [P] Add `BrandConfig` (`name?`, `logo?`, `logoDark?`, all optional strings) and `ConfigFile.brand?: BrandConfig` to `packages/inspector/src/contracts.ts`. No React import. A short doc comment says logos are resolved URLs after validation.
- [x] T003 [P] Write the failing reader tests in `packages/inspector/tests/config/brand.test.ts`, using `parseConfig(text, page)` with a page of origin `https://inspector.example` and base `https://inspector.example/tools/inspector/`. Cover: (a) no `brand`: `parsed.brand` is `undefined` and `warnings` is `[]`; (b) valid shapes: name only, logo only, both, with `logoDark`, and `brand: {}` with no warning; (c) logo forms that resolve and are accepted: `logo.svg` (becomes `https://inspector.example/tools/inspector/logo.svg`), `/static/logo.svg`, `https://inspector.example/a.png?v=3#x` and `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>` and `data:image/png;base64,AAAA`; (d) each rejected value of FR-008 gives exactly one warning with the text from `data-model.md`, drops only that field and keeps the valid ones and the agents: `brand` as `null`, a string, `7`, a list; an unknown field `title`; `name` as `7`, `''`, `'   '`; `logo` as `7`, `''`, `https://other.example/l.png`, `//other.example/l.png`, `/\\other.example/l.png`, `/\t/other.example/l.png`, `jav\tascript:alert(1)`, `javascript:alert(1)`, `blob:https://inspector.example/x`, `file:///x.png`, `data:text/html,<p>`, `https://user:pw@inspector.example/l.png`, `http://[` (not parseable); `logoDark` with no `logo`, with a rejected `logo`, and itself rejected while `logo` is kept; (e) no warning contains the rejected value; the unknown field name is quoted and shortened to 48 characters; (f) the theme warnings come first and the brand warnings follow (unknown fields, then `name`, `logo`, `logoDark`); (g) with no `page` argument a path and a `data:image` are accepted and `https://other.example/l.png` is rejected; (h) a top-level unknown key is still an error and `brand` is an allowed key.
- [x] T004 Add `PageLocation` (`origin`, `baseUrl`) and `logoSource(value, page)` to `packages/inspector/src/core/config/validation.ts`. It returns `Result<string>`: not a nonempty string is `must be a nonempty string`; `new URL(value, page.baseUrl)` that throws is `is not a valid URL`; protocol `data:` with a path that starts with `image/` (case-insensitive) is accepted; any other protocol than `http:` or `https:` is rejected; a user name or password is `must not contain credentials (user:password@)`; an origin other than `page.origin` is `must be a path on this origin or a data:image URI`; the accepted value is `url.href`. Judge the parsed URL only, with no regular expression over the raw text. The failure strings are the problem phrases in `data-model.md`, without the field name. A `data:` URI that is not an image, a protocol other than `http:` and `https:` and another origin all return the same origin message.
- [x] T005 Add `parseBrand(value, page, warnings)` to `packages/inspector/src/core/config/index.ts`: not an object is `brand must be an object with optional "name", "logo" and "logoDark"; it was ignored`; unknown fields are `brand: "<field>" is not a brand field (use "name", "logo" or "logoDark"); it was ignored` through the existing `shown` helper; `name` must be a string with a non-whitespace character; `logo` and `logoDark` use `logoSource`; `logoDark` is kept only when `logo` is kept, else `brand.logoDark needs a valid brand.logo; it was ignored`; every warning ends with `; it was ignored` and never holds the rejected value. Return `undefined` when no field is valid. Add `'brand'` to the allowed top-level keys (`ParsedConfig` already inherits `brand?` from `ConfigFile`), a `page?: PageLocation` parameter to `parseConfig` (default: a placeholder origin, as `hasUserinfo` does) and to `loadConfig`, and call `parseBrand` after `parseTheme` so its warnings come second. T003 passes.
- [x] T006 Hand the page to the reader in `packages/inspector/src/app/startup.ts`: pass `{ origin: env.origin, baseUrl: env.baseUrl }` to `loadConfig`, destructure `brand` from the result, and return it as `Started.brand` (omitted when absent, like `theme`). Extend `packages/inspector/tests/hosted/startup.test.ts` with a `brandFile` helper like `themeFile`: in a hosted page and an embedded page the brand reaches `Started`, only `hosting-config.json` and `config.json` are requested, the policy text is the same as without a brand, a logo on `https://elsewhere.example` produces one warning and no request, and a relative logo resolves against `env.baseUrl` also when `hosting-config.json` names a configuration file on an allowed other origin (clarification 4). Also assert FR-012: with a brand set, the storage stand-in receives no write, and the serialized session of the new store holds none of the brand's text.

**Checkpoint**: `npm run test:unit -- packages/inspector/tests/config packages/inspector/tests/hosted` passes. The page has a validated brand and nothing shows it yet.

## Phase 3: User Story 1 - Name and logo in an embedded inspector (P1) MVP

**Goal**: A host that calls `mount_inspector(..., brand=Brand(...))` sees its name and logo in the top bar. With no brand, nothing changes.

**Independent test**: Mount with and without a brand and read the top bar and `config.json`.

- [x] T007 [P] [US1] Write failing markup tests in `packages/inspector/tests/hosted/app.test.tsx` with `renderToStaticMarkup`: with no `brand` the top bar is the 0.1.0 markup (an `agui-app-mark` span with `aria-hidden="true"` and the mark icon, then `<h1>agui-inspector</h1>`); a `name` replaces only the heading text and `<b>Acme</b>` comes out escaped as text; a `logo` renders `<span class="agui-app-logo" aria-hidden="true"><img … alt="">` with the logo as `src`, no `agui-app-mark` span and the heading still `agui-inspector`; a name and a logo together; there is exactly one `<h1>`; the page has no `href` or `src` other than the logo that the brand added.
- [x] T008 [US1] Create `packages/inspector/src/app/brand.tsx` exporting `Brand({ brand })`: the existing `agui-app-brand` span, the default `agui-app-mark` span with `<Icon name="mark" size={16} />` unless a valid `logo` is given, else `<span className="agui-app-logo" aria-hidden="true"><img className="agui-app-logo-img" src={logo} alt="" /></span>`, and `<h1>{brand?.name ?? 'agui-inspector'}</h1>`. In `packages/inspector/src/app/index.tsx` add `brand?: BrandConfig` to `AppExtras`, use `<Brand brand={brand} />` in place of the current brand span (lines 121 to 126), and pass `started.brand` from `Root` into the props. T007 passes.
- [x] T009 [US1] Style it in `packages/inspector/src/app/app.css`: `.agui-app-logo` as an inline flex box; `.agui-app-logo-img` as `display: block`, `height: calc(var(--u) * 7)`, `width: auto`, `max-width: min(calc(var(--u) * 40), 30vw)`, `object-fit: contain`; `.agui-app-brand` gets `min-width: 0`; `.agui-app-brand h1` gets `overflow: hidden`, `text-overflow: ellipsis` and `max-width: min(calc(var(--u) * 60), 40vw)`, so a phone keeps the brand and the theme switch on one row. No literal colors, no `url()`.
- [x] T010 [P] [US1] Write failing Python tests in `packages/python/tests/test_embedding.py` (a `BrandTest` class next to the theme tests): for Starlette and FastAPI, `Brand(name="Acme", logo="/static/acme.svg", logo_dark="/static/acme-dark.svg")` appears in `config.json` as `{"name": "Acme", "logo": "/static/acme.svg", "logoDark": "/static/acme-dark.svg"}` after `theme`; unset fields are left out and `Brand()` gives `"brand": {}`; no brand means no `brand` key and the served text is exactly `json.dumps({"version": 0, "agents": [...]})`, the 0.1.0 bytes (SC-002); a custom `path` works; values are delivered unchanged so the page alone judges them (`logo="https://other.example/x.png"` is served as written); a disabled helper with a brand mounts nothing; the response headers and the route list are the same with and without a brand; `Brand` is in `agui_inspector.__all__` and is frozen.
- [x] T011 [US1] Add `Brand` (frozen dataclass: `name`, `logo`, `logo_dark`, all `str | None = None`) to `packages/python/src/agui_inspector/__init__.py`, export it in `__all__`, add `brand: Brand | None = None` to `mount_inspector`, write `{"name", "logo", "logoDark"}` without the `None` values into the config dict after `theme`, and extend the docstring: values are written as given, the page checks them and warns, the helper serves no logo. T010 passes.
- [x] T012 [US1] Add the Python-mode end-to-end test in `tests/e2e/branding/brand.spec.ts` (new file, same support imports as `tests/e2e/theme/config.spec.ts`) and the theme spec's Python host, moved with `startPython`, `startStatic` and `freePort` into `tests/e2e/hosted/serving.ts` so both specs share it. The host takes `brand` and `assets` options and has a `/static/<name>` route that serves an SVG logo from its own origin. `tests/e2e/hosted/support.ts` lets a `files` entry answer 302. Check: the heading shows the name, the logo `img` is visible with a natural width greater than 0, `.agui-app-mark` is absent, every request goes to the host's origin, `config.json` holds the brand, and a second host with no brand shows the default mark and text.
- [x] T013 [US1] Add the layout end-to-end test to `tests/e2e/branding/brand.spec.ts`, against the Python host or an `openSite` page with a data-URI logo: a 300-character name and a 2000 by 20 SVG logo do not change the height of `.agui-app-bar` at 1280 px compared with a page with no brand; the heading is cut with an ellipsis (`scrollWidth` greater than `clientWidth`) and the logo's rendered width is at most `calc(var(--u) * 40)`; at 390 px the bar wraps as it does today, the brand stays in its first row and the page has no horizontal scroll.

**Checkpoint**: `npm run test:unit -- packages/inspector/tests/hosted`, the Python tests and `npm run test:e2e -- tests/e2e/branding --workers=2` pass for US1.

## Phase 4: User Story 2 - Every serving mode (P1)

**Goal**: The same brand gives the same top bar in hosted, embedded, host-served static and npm-assets serving.

**Independent test**: Serve the production build four ways with one `brand` entry and compare.

- [x] T014 [US2] Extend `tests/e2e/branding/brand.spec.ts` with `openSite` cases for `hosted` and `embedded` (the `hostedConfig` and `embeddedConfig` shapes from the theme spec, with `brand`), a generic static server (the theme spec's `startStatic` pattern, with the logo file served) and a hosted page whose `hosting-config.json` names another configuration file. For each: the top bar shows the name and logo and no default mark; logos written as a relative path, an absolute path, a full URL on the page's own origin and a `data:` URI all show; the `data:` logo causes no request for it; the two policy `<meta>` texts are equal to the ones on a page with no brand; the only JSON requests are `hosting-config.json` and `config.json`; `violations()` is empty; the agent still runs.

**Checkpoint**: `npm run test:e2e -- tests/e2e/branding --workers=2` passes for US1 and US2.

## Phase 5: User Story 3 - Light and dark logos (P1)

**Goal**: A dark logo shows in the dark theme, by system preference and by the switch. One logo shows in both.

**Independent test**: A brand with two logos under both system preferences and both switch directions.

- [x] T015 [P] [US3] Add failing markup tests in `packages/inspector/tests/hosted/app.test.tsx`: with `logo` and `logoDark` the top bar holds `<span data-for="light">` and `<span data-for="dark">`, each with one `img alt=""`, the light one with `logo` and the dark one with `logoDark`; with only `logo` there is one image and no `data-for` wrapper.
- [x] T016 [US3] Render the two wrappers in `packages/inspector/src/app/brand.tsx` when `logoDark` is set, and add the visibility rules to `packages/inspector/src/app/app.css` with the same selectors that `packages/inspector/src/views/theme/tokens.css` uses for dark: `[data-for="dark"]` hidden by default; under `@media (prefers-color-scheme: dark)` with `:root:not([data-theme="light"])` the light wrapper is hidden and the dark one shown; under `:root[data-theme="dark"]` the same. Use `display: none`, so both images still load. T015 passes.
- [x] T017 [US3] Extend `tests/e2e/branding/brand.spec.ts`: with two logos, `page.emulateMedia` light then dark then light shows the matching `img` (check `isVisible` and `currentSrc`), the theme switch forces dark and light whatever the system says, and a sequence of switch and preference changes never leaves the wrong logo visible (SC-006); both images were requested at start; with one logo the same image shows in both themes; a dark logo with no logo shows the default mark in both themes and one warning.

**Checkpoint**: US1 to US3 pass in unit and end-to-end tests.

## Phase 6: User Story 4 - Mistakes are visible and never fatal (P2)

**Goal**: A bad value or a missing file gives a warning, a sane top bar and no request to another origin.

**Independent test**: Load each bad value and read the warnings, the top bar, the agents and the network log.

- [x] T018 [US4] Add the rejected-value end-to-end tests in `tests/e2e/branding/brand.spec.ts` for hosted and Python modes: for each logo from T003 section (d) that can be sent in JSON and each name and shape problem, there is exactly one `.agui-finding--warn` in the "Configuration warnings" region, the field that was rejected is dropped and the others apply, `site.foreign.seen` is `[]`, no request goes to `other.example`, `expectAllowlisted` holds, the policy texts are unchanged, no `role="alert"` appears and the agent still runs. A theme problem and a brand problem in one file both show, theme first. No warning text contains the rejected value.
- [x] T019 [US4] Add the load-failure end-to-end tests in the same file: a valid logo path that answers 404, a path that answers 200 with a body that is not an image, and a same-origin path that redirects to the foreign origin (served by a small local server in the spec, as `startStatic` is). Each shows the default mark in the top bar, no broken-image icon (`img` absent or `naturalWidth` of what is visible is the mark), and one warning `brand.logo could not be loaded; the default mark is shown`. With a working `logo` and a missing `logoDark`: the warning shows at once under the light theme, the light theme shows the logo and the dark theme shows the default mark and not the logo. The foreign origin sees no request.
- [x] T020 [US4] Implement the fallback in `packages/inspector/src/app/brand.tsx`: an `onError` on each image records `failed.logo` or `failed.logoDark`; a failed image is replaced by the default `agui-app-mark` span, inside its own `data-for` wrapper or, for a single logo, inside the `agui-app-logo` span; without a `logoDark` a failure shows the default mark in both themes; `Brand` takes `failed` and `onFailed` props and holds no state. In `packages/inspector/src/app/index.tsx` keep the failed fields in `App` state, passed down as `failed`, and append `brand.logo could not be loaded; the default mark is shown` (and the `brand.logoDark` form) to the `warnings` it renders, after the configuration warnings. T019 passes.

**Checkpoint**: all four stories pass in `npm run test:e2e -- tests/e2e/branding --workers=2`.

## Phase 7: Polish and cross-cutting

- [x] T021 [P] Document the field in `website/content/docs/configuration.mdx`: a `brand` row in the file table, a "Brand" section after "Theme" with the three fields, the logo rules (own origin or `data:` image, read against the page, no size limit), the rejected-value table with the warning texts, the load-failure behavior and an example; the `config.json` row of the top table; and a line under Migrations: 0.2.0 adds the optional `brand` field, a file without it reads as before and needs no migration, and before 0.2.0 `brand` was an unknown field and an error.
- [x] T022 [P] Document it in `website/content/docs/theming.mdx`: a short "Name and logo" section that says the theme recolors the default mark through `--agui-accent` and a custom logo is shown as it is, with a link to the configuration page.
- [x] T023 [P] Document the argument in `website/content/docs/embedding.mdx`: a `brand` row in Arguments, a "Branding the embedded page" section (what `Brand` holds, `logo_dark` becomes `logoDark`, the helper does not check values and serves no logo, how to serve the logo from the host's own route or build a `data:` URI in a few lines), and the `config.json` route row now built from `agents`, `theme` and `brand`. A host that serves the assets itself puts the same `brand` field in its own `config.json`.
- [x] T024 [P] Add a pointer in `website/content/docs/hosted.mdx` to the configuration rules, a row in `website/content/docs/troubleshooting.mdx` for a logo that does not show (rejected value, wrong path, file not an image), and the new test files in the test tables of `website/content/docs/internals.mdx`. Run `npm run test:unit` afterwards: several tests read the docs.
- [x] T025 [P] Add one changeset, `.changeset/show-adopter-logo-and-name.md`, with `"agui-inspector": minor` and `"agui-inspector-python": minor` and a plain-language body: a `brand` entry in `config.json` and a `Brand` argument of `mount_inspector` put the adopter's name and logo in the top bar.
- [x] T026 Run the full gate: `npm run build`, `npm run check:bundle`, `npm run test:e2e -- tests/e2e/theme tests/e2e/branding --workers=2` and then `npm run check:ci`. `check:bundle` must pass on the existing budgets, and no existing theme test may need an edit.
- [x] T027 Close out: run `/speckit-converge` if the code and the spec disagree; run `/ponytail:ponytail-review` on the diff and fix what it finds; run the humanizer skill on the new docs text and on the pull request body; rebase on `origin/main`, push with `--force-with-lease`, update the pull request body and mark it ready.

## Dependencies and order

- Phase 1, then Phase 2. T002 and T003 run in parallel. T004 needs T002. T005 needs T002, T003 and T004. T006 needs T005.
- Phase 2 blocks every story.
- US1 (T007 to T013) is the MVP. T007 before T008. T008 and T009 are one view change. T010 before T011. The Python tasks (T010, T011) and the view tasks (T007 to T009) are independent. T012 needs T008, T009 and T011. T013 needs T008 and T009 and edits the spec file that T012 creates, so it follows T012.
- US2 (T014) needs US1's view and needs nothing from the Python helper. It edits `tests/e2e/branding/brand.spec.ts`, so it follows T013.
- US3 (T015 to T017) needs T008. T016 edits the same files as T008 and T009, so it runs after them.
- US4 (T018 to T020) needs T008. T018 and T019 edit `tests/e2e/branding/brand.spec.ts` after T017, one at a time. T020 edits `brand.tsx` and `index.tsx` after T016.
- Docs T021 to T024 can start after Phase 2 and are written against the final behavior. T025 is independent. T026 and T027 come last.

## Parallel examples

- After T006: T007 with T010 (view tests and Python tests), then T008 to T009 with T011.
- Every task that edits `tests/e2e/branding/brand.spec.ts` (T012, T013, T014, T017, T018, T019) runs alone on that file. The unit test T015 and the docs and changeset tasks T021 to T025 run in parallel with them.

## Implementation strategy

1. Phases 1 and 2, then US1: the smallest slice that shows an adopter's name and logo, in Python and in the page.
2. US2 proves the other modes with tests only, since the page is shared.
3. US3 adds the dark logo. US4 adds the load fallback and the full rejected-value coverage.
4. Docs, changeset, full gate and review last. Stop at any checkpoint: each leaves the page working and the tests green.
