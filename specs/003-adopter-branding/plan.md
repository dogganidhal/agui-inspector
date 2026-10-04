# Implementation Plan: Adopter branding

**Branch**: `gh-73-adopter-branding` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: `specs/003-adopter-branding/spec.md`, issue #73, the 0.2.0 roadmap (item 1, issue #86).

**Status**: Planning only. Implementation starts after the maintainer approves the spec and this plan.

## Summary

`config.json` gets an optional `brand` object: `name`, `logo` and `logoDark`. The configuration reader validates it and
turns each bad field into a "Configuration" warning, as it does for `theme`. A logo is accepted only when it resolves
to the page's own origin or is a `data:` image. The reader is told where the page is, so it checks the resolved URL,
not the text. The top bar renders the name as the heading and the logo as a decorative image. A logo with no name
shows alone: the heading stays, as "agui-inspector", visually hidden (follow-up, clarified 2026-10-04). A dark logo is a second
image that the stylesheet shows in the dark theme, with the same selectors that choose the dark tokens. A logo that
fails to load falls back to the default mark and adds a warning. `mount_inspector` takes a `Brand` record and writes
it into the `config.json` it serves.

The content security policy, the request policy, `hosting-config.json` and the default mark are not touched. No
dependency is added.

## Technical Context

**Language/Version**: Existing strict TypeScript 7.0.2 and React 19.3.0; Node >=24; Python >=3.10.

**Primary Dependencies**: None added. The platform's `URL` parser does the origin check. An `<img>` element shows the logo.

**Storage**: None. The brand is read from `config.json` on every load. It is not stored, exported or recorded.

**Testing**: `node --test` through the repository runner for the reader, startup and markup. Playwright Chromium for the
four serving modes. `unittest` for the Python helper.

**Target Platform**: The one static bundle in all modes: hosted, Python embedded, host-served static files and the npm
assets.

**Project Type**: Static browser app plus a small Python helper. No backend.

**Performance Goals**: None beyond the existing budgets. The brand adds one or two same-origin image requests, or none
for `data:` logos.

**Constraints**: The production bundle stays within 2,000,000 B minified and 600,000 B gzip. The policy text stays
`img-src 'self' data:`. The configuration format stays at version 0.

**Scale/Scope**: One small pull request: reader, startup hand-off, one top-bar component, one stylesheet block, one
Python argument, docs, tests, two changesets.

## Constitution Check

Constitution 1.2.0. Pre-research and post-design assessments agree.

| Rule | Assessment and evidence |
| --- | --- |
| I: wire first | Not touched. Frames, recorder and the protocol client's stream are outside this change. |
| II: protocol, not a framework | No protocol behavior changes. The reader stays framework-free TypeScript in `src/core/config`. React is used only in the view. `contracts.ts` gets one interface and no React import. |
| III: generic core, presets | The brand is deployment configuration. No server-specific route or branch enters the core. |
| IV: local-only, credential privacy | The logo is the page's own origin or `data:`. A rejected logo creates no `<img>`, so no request leaves. The policy `img-src 'self' data:` is unchanged and still blocks a same-origin redirect to another origin. The brand holds no credentials and a URL with credentials is rejected. No telemetry. Exports, profiles and storage do not carry the brand. |
| V: small and auditable | No dependency. One reader function, one component, one CSS block, one Python dataclass. No abstraction beyond them. |
| VI: every event type has a view | Not touched. |
| Shared bundle and packaging | One bundle for all modes. The wheel and the npm package carry the same change. The Python helper needs no Node toolchain. |
| CSP | `script-src 'self'`, no `eval` and `connect-src` are unchanged. A test compares the policy text with and without a brand. |
| Quality gates | Regression tests for every changed behavior. End-to-end tests use only `examples/reference-agent` and test servers. `npm run check:ci` gates the change. Bundle budgets are unchanged. |
| Release | Minor changesets for `agui-inspector` and `agui-inspector-python`. Nothing is published or tagged here. |
| Scope | Issue #73 and the accepted 0.2.0 roadmap, item 1. `ROADMAP.md` on main still describes the 1.0.0 target. The 0.2.0 text arrives through #86 and is the source for scope. The format stays at version 0 with an optional field, as the roadmap decisions require. |

No violation. No complexity to track.

## Design decisions

The reasons and the rejected alternatives are in [research.md](research.md). In short:

1. The reader gets the page's origin and location, and judges the resolved URL. No regular expression tries to
   guess what a URL parser would do.
2. A rejected field is dropped alone, with one warning that names the field and never the value.
3. The dark logo is a second `<img>` that CSS shows. It follows the manual switch and the system preference with the
   same selectors as the tokens, and it loads at start.
4. A failed logo is a view concern: the component falls back to the default mark and the app adds one warning.
5. Python gets a `Brand` dataclass that mirrors `Agent`, and writes only what is set.

## Project Structure

### Documentation (this feature)

```text
specs/003-adopter-branding/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── brand.md          # config.json field, warnings, Python argument, top-bar markup
├── checklists/
│   └── requirements.md
└── tasks.md              # /speckit-tasks
```

### Source code (repository root)

```text
packages/inspector/src/
├── contracts.ts                      # BrandConfig; ConfigFile.brand
├── core/config/
│   ├── validation.ts                 # PageLocation; logoSource()
│   └── index.ts                      # parseBrand(); parseConfig(text, page?); loadConfig(url, fetch, page)
└── app/
    ├── startup.ts                    # hands the page's origin and location to loadConfig; Started.brand
    ├── brand.tsx                     # new: the top bar's mark and name; stateless, takes the failed logos as a prop
    ├── index.tsx                     # uses <Brand>; keeps the failed logos and merges their warnings
    └── app.css                       # logo size, theme-matched visibility, name ellipsis, hidden heading

packages/python/
├── src/agui_inspector/__init__.py    # Brand; mount_inspector(brand=...)
└── tests/test_embedding.py           # brand in config.json

packages/inspector/tests/
├── config/brand.test.ts              # the reader: default, valid, every rejected value
├── hosted/startup.test.ts            # the page's origin reaches the reader; no extra request; same policy
└── hosted/app.test.tsx               # markup: default, name, logo, dark logo

tests/e2e/branding/brand.spec.ts      # hosted, embedded, Python, static; light and dark; rejected values; network
tests/e2e/hosted/serving.ts           # the Python and generic static serving helpers, moved out of the theme spec and shared
tests/e2e/hosted/support.ts           # `files` entries may answer 302 (a same-origin logo that redirects)

website/content/docs/
├── configuration.mdx                 # field, rules, warnings, compatibility note
├── theming.mdx                       # brand next to recoloring
├── embedding.mdx                     # the argument, serving the logo
├── hosted.mdx                        # pointer to the rules
└── troubleshooting.mdx               # a logo that does not show

.changeset/                           # agui-inspector (minor), agui-inspector-python (minor)
```

**Structure Decision**: One new source file (`app/brand.tsx`) keeps `app/index.tsx` from growing. Everything else
extends an existing module. The reader keeps its place in `core/config` so the rules stay framework-free and unit
testable without a browser.

## Test plan

| Layer | What it proves | Spec |
| --- | --- | --- |
| Reader unit | No brand: no `brand`, no warning. Valid: name only, logo only, both, with a dark logo. Every rejected value in FR-008, each as one warning, others kept. A page-aware origin check: same-origin path, absolute same-origin URL, other origin, scheme-relative, backslash, tab and newline tricks, `blob:`, `javascript:`, `data:text/html`, credentials. Warnings never contain the rejected value. | FR-001 to FR-008 |
| Startup unit | The page's origin and location reach the reader. A brand adds no request. The policy text is the same with and without it. | FR-006, FR-007, FR-011 |
| Markup unit | Default markup is the 0.1.0 markup. A name replaces the heading text and is escaped. A logo has an empty `alt`. A logo with no name hides the heading text visually and keeps it in the markup. A dark logo renders two images, one for each theme. | FR-002 to FR-005, FR-013 |
| Python unit | `Brand` is written as given, `logo_dark` as `logoDark`, unset fields left out, no brand means no key. Same for Starlette and FastAPI and a custom path. Disabled helper mounts nothing. Routes and headers unchanged. | FR-010 |
| End to end | Same top bar in hosted, embedded, Python and generic static modes, in light and dark, by system preference and by the switch. Each rejected value: one warning, no request to another origin, agents still run, policy unchanged. A missing logo falls back with a warning, and a missing dark logo warns at once. Long name and wide logo keep the bar on one row. | SC-001 to SC-006 |
| Gates | `npm run check:ci`: typecheck, unit, build, bundle budget, end to end, Python. | FR-017 |

End-to-end tests serve a logo from the test page's own origin, with the existing `files` option of the test site. They
need no model and no outside service.

## Docs and release

- The configuration page gets the `brand` row, a Brand section with the rules and the rejected-value table, and the
  compatibility line under Migrations.
- The theming page says what the theme does not do: it recolors the default mark, and a custom logo is not recolored.
- The embedding page documents `Brand`, how to serve the logo from the host, and the `config.json` route text.
- The hosted page points to the rules. The troubleshooting page has a row for a logo that does not show.
- No new `npm run` script, so `development.mdx` is unchanged. No new dependency, so `dependencies.mdx` is unchanged.
- Two changesets: `agui-inspector` minor and `agui-inspector-python` minor.

## Open questions for the maintainer

None. Nothing here changes 0.2.0 scope, needs a constitution amendment or adds a dependency.
