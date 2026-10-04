# Research: Adopter branding

Each entry gives the decision, the reason and what was rejected. The spec's clarifications are not repeated here.

## R1. Where the same-origin check runs

**Decision**: `parseConfig(text, page?)` takes the page's origin and location. For each logo it resolves the value
against the location with `new URL` and judges the result. `loadConfig` passes the page it is given. `startPage` hands
over `env.origin` and `env.baseUrl`, which are the values the guarded transport already uses.

**Reason**: The browser's URL parser decides what an `<img src>` will reach, so the check uses the same parser. Tabs and
newlines inside a value, backslashes, scheme-relative references and uppercase schemes all behave as the parser says,
with no list of tricks to keep up to date. The same code accepts a path, a full URL on the page's own origin and a
`data:` image, and refuses the rest.

**Rules on the parsed URL**:

1. `data:` with a media type that starts with `image/` is accepted.
2. Any other protocol than `http:` or `https:` is rejected. That covers `javascript:`, `file:` and `blob:`.
3. A URL with a user name or a password is rejected.
4. A URL whose origin differs from the page's origin is rejected. A scheme-relative reference becomes a URL on another
   origin and fails here.
5. The accepted value is `url.href`, so the page and the test see one resolved string.

Without a `page` argument the reader uses a placeholder origin of the same kind as `hasUserinfo` already uses, so a
path or a `data:` image is accepted and a URL on any real origin is rejected. This keeps the 46 existing callers in the tests unchanged. Production always
passes the real page.

**Rejected**:

- A regular expression for "no scheme, no host". It misses tab and newline stripping and needs care for backslashes.
- Syntax checks in the reader and the origin check in `startup.ts`. It splits one rule across two files and two
  warning paths.
- Accepting paths only. It makes `https://host/logo.svg` an error on the host's own origin, which the issue allows.

## R2. Warnings

**Decision**: Reuse the `warnings` array that `theme` fills. Messages follow the theme wording: the field, the problem,
"it was ignored". They never echo the rejected value. An unknown field name is echoed through the existing `shown`
helper, which quotes and shortens it, as theme does for unknown property names.

**Reason**: One place under the top bar already renders these warnings on every tab. No new surface, no new test seam.

**Rejected**: A fatal error for a bad brand. The issue says startup continues.

## R3. Light and dark logos

**Decision**: With a `logoDark`, render two `<img>` elements in two wrappers, `data-for="light"` and `data-for="dark"`.
The stylesheet hides one with the same selectors that choose the dark tokens: `@media (prefers-color-scheme: dark)`
guarded by `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`. Without a `logoDark`, render one image.

**Reason**: CSS follows the system preference and the manual switch with no script and no state. Both images load at
start (clarification 2), so a bad dark logo warns at once and a switch never shows a blank. `display: none` does not
stop an `<img>` from loading.

**Rejected**:

- `<picture>` with `prefers-color-scheme`. It cannot see the manual switch, which sets `data-theme` on the root.
- A script that swaps `src` on each change. It needs an observer like `applyTheme` has, and loads the second image late.
- A CSS `background-image` from a custom property. It needs `url()` in a theme value, which the theme rules forbid on
  purpose.
- Inlining the SVG. It would put adopter markup in the page's document.

## R4. A logo that fails to load

**Decision**: `onError` on each `<img>` marks that logo as failed. A failed light logo shows the default mark in the
light wrapper. A failed dark logo shows the default mark in the dark wrapper. The component reports each failed field
once, and the app adds `brand.logo could not be loaded; the default mark is shown` (or `brand.logoDark`) to the
warning list it renders.

**Reason**: A broken image icon in the top bar looks like a bug in the inspector. The warning tells the adopter why the
default mark is back. It also covers a same-origin redirect that the policy blocks.

**Rejected**: A silent fallback. It hides the mistake. Nothing is requested again after a failure.

## R5. The top bar markup

**Decision**: A new `app/brand.tsx` exports `Brand`. It renders the existing `agui-app-brand` span, the mark or logo
and the `<h1>`. With no brand it renders exactly the markup the page has today, so the 0.1.0 tests and the four-copy
mark test keep passing. The logo has no frame: the accent-colored square belongs to the default mark.

**Reason**: The component is small and has one job. `index.tsx` already holds the layout, the footer and the root.

**Accessibility**: The `<h1>` carries the name. Images use `alt=""`. The wrapper is `aria-hidden`, as the default mark
is. Nothing takes focus.

**Size**: The logo is as tall as the default mark's square and at most about six times that wide. The name is cut with an
ellipsis at a fixed width, so neither can break the bar's row.

## R6. The Python argument

**Decision**: `@dataclass(frozen=True) class Brand` with `name`, `logo` and `logo_dark`, all `None` by default,
exported in `__all__`. `mount_inspector(..., brand: Brand | None = None)`. The helper writes
`{"name": ..., "logo": ..., "logoDark": ...}` without the `None` values, and no `brand` key without a brand. It
checks nothing else.

**Reason**: It mirrors `Agent` and reads like the rest of the helper. A misspelled field fails at the call site. The
helper keeps its rule that the page, not the helper, judges configuration values.

**Rejected**:

- A plain dictionary like `theme`. `logoDark` is not a Python name, and a typo would pass silently.
- Reading a logo file and inlining it as a `data:` URI. It is not in the issue. An adopter who wants it can build the
  URI in two lines, and the docs can show them.
- Serving the logo from the helper. It would add a route, which FR-010 forbids.

## R7. Scope and the page title

**Decision**: Only the top bar changes. The `<title>`, the favicon, the footer and the startup-failure page keep the
agui-inspector name.

**Reason**: The issue limits the brand to the top bar. The failure page appears before the configuration is read, so it
cannot know a brand. The favicon is a `data:` link in `index.html` and part of the four-copy rule.

## R8. Existing tests that touch the area

The four-copy mark test (`tests/foundation/brand.test.ts`) and the theme end-to-end test read the default mark and
the heading text. With no brand the markup is unchanged, so they pass as they are. The end-to-end heading locator
`getByRole('heading', { name: 'agui-inspector', level: 1 })` stays valid for a page with no brand.
