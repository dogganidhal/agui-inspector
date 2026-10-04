# Feature Specification: Adopter branding

**Feature Branch**: `gh-73-adopter-branding`

**Created**: 2026-10-04

**Status**: Draft for review

**Input**: Issue [#73](https://github.com/dogganidhal/agui-inspector/issues/73), "Let adopters show their own
logo and product name", item 1 of the 0.2.0 roadmap. An optional brand entry in `config.json` with a product
name, a logo and an optional dark logo, shown in the top bar in every mode. The logo comes from the page's own
origin or a `data:` URI. A bad value gives a nonfatal "Configuration" warning. Without a brand, the page looks as
it does today.

## Clarifications

No one answered these interactively. Each answer is the recommended option, chosen from the issue, the 0.2.0
roadmap, the constitution and the code.

### Session 2026-10-04

- Q: What does the `brand` argument of `mount_inspector` look like in Python? → A: A `Brand` record exported by the
  package, like `Agent`, with `name`, `logo` and `logo_dark`. Unset fields are left out of `config.json`, and
  `logo_dark` is written as `logoDark`. A plain dictionary is not accepted, so a misspelled field fails at the call
  site.
- Q: Does the page load the dark logo while the light theme is on? → A: Yes. Both logos load when the page starts, so
  a bad dark logo shows its warning at once and switching themes never shows a blank.
- Q: When only the dark logo fails to load, what does the dark theme show? → A: The default mark, with a warning that
  names `brand.logoDark`. It does not fall back to `logo`, so the mistake stays visible.
- Q: What does a relative logo reference resolve against when `config.json` is read from another file or origin? →
  A: The page's own location, never the location of the configuration file. Only the page's own origin is allowed
  either way.
- Q: Is there a size limit for a `data:` logo? → A: No. The deployer writes the file, and a data logo is part of
  `config.json`, not of the bundle. The bundle budget is not affected.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Show my product's name and logo in an embedded inspector (Priority: P1)

A team embeds the inspector in its own Python server with `mount_inspector`. It passes a brand: a product name and
a logo that its server already serves. A developer on that team opens the inspector and sees the team's logo and
product name in the top bar, not the agui-inspector mark and name.

**Why this priority**: Embedding is the primary integration. The team's developers should see their own product,
and the issue exists for them.

**Independent Test**: Mount the inspector with a brand, open the page, and read the top bar. Mount it again with no
brand and check that the page is unchanged.

**Acceptance Scenarios**:

1. **Given** a mount with a name and a logo on the host's own origin, **When** the page loads, **Then** the top bar
   shows that logo in place of the default mark and that name in place of the text "agui-inspector".
2. **Given** a mount with no brand, **When** the page loads, **Then** the top bar shows the default mark and the text
   "agui-inspector", and the served `config.json` is the same as before this feature.
3. **Given** a mount with a brand, **When** a developer lists the routes the helper adds, the response headers and the
   page's requests, **Then** nothing new appears: no extra route, no change to the content security policy, and no
   request to another origin.

---

### User Story 2 - Brand a hosted or static deployment (Priority: P1)

A deployer who serves the inspector's static files, hosted or from the npm package, adds a `brand` entry to the
`config.json` that sits beside the page. The same name and logo appear, with no rebuild and no separate stylesheet.

**Why this priority**: One static bundle serves every mode. Branding that works only through the Python helper would
leave hosted and static deployments without it.

**Independent Test**: Serve the production build in each mode with the same `brand` entry in `config.json` and compare
the top bar.

**Acceptance Scenarios**:

1. **Given** a hosted page, an embedded page served by a host's own static server and a page served from the npm
   assets, each with the same brand in its `config.json`, **When** the page loads, **Then** the top bar is the same in
   all three.
2. **Given** a logo written as a path relative to the page, as an absolute path, or as a full URL on the page's own
   origin, **When** the page loads, **Then** the logo shows.
3. **Given** a logo written as a `data:` URI of an image, **When** the page loads, **Then** the logo shows, and no
   request is made for it.
4. **Given** a hosted deployment whose `config.json` is read from another file named in `hosting-config.json`,
   **When** that file has a brand, **Then** the brand shows, and the startup policy that file belongs to is unchanged.

---

### User Story 3 - A logo that suits the light and the dark theme (Priority: P1)

A brand may give a second logo for the dark theme, since one logo rarely reads well on both backgrounds. The page
shows the dark logo when the dark theme is on and the other logo otherwise. A brand with one logo shows it in both.

**Why this priority**: The inspector has a light and a dark theme, with a switch in the top bar. A logo that vanishes
on one of them is a visible defect, and the issue asks for it.

**Independent Test**: Load a brand with two logos, check the top bar under a light and a dark system preference, then
use the theme switch both ways.

**Acceptance Scenarios**:

1. **Given** a brand with a logo and a dark logo, **When** the system prefers light, **Then** the logo shows. **When**
   it prefers dark, **Then** the dark logo shows.
2. **Given** the same brand, **When** the user presses the theme switch, **Then** the logo follows the page's theme at
   once, whatever the system preference says.
3. **Given** a brand with a logo only, **When** either theme is on, **Then** that logo shows.
4. **Given** a brand with a dark logo and no logo, **When** the page loads, **Then** the default mark shows in both
   themes and a warning explains why the dark logo is not used.

---

### User Story 4 - Mistakes are visible and never stop the inspector (Priority: P2)

An adopter makes a mistake in the brand: a logo on another origin, an empty name, a misspelled field. The inspector
still starts, the agents still work, and a "Configuration" warning under the top bar names the field and says that it
was ignored. The inspector never asks another origin for an image.

**Why this priority**: The brand is decoration. It must not cost the adopter a working tool, and it must not open a
route for requests to third parties. It matters less than the happy path, so it comes second.

**Independent Test**: Load a configuration with each bad value in turn and check the warning, the top bar, the agents
and the network log.

**Acceptance Scenarios**:

1. **Given** a logo on another origin, **When** the page loads, **Then** a "Configuration" warning appears, the logo
   is not used, no request goes to that origin, and the other brand fields and the agents still apply.
2. **Given** each rejected value listed in the requirements, **When** the page loads, **Then** exactly that field is
   dropped with one warning and every other valid field in the file still applies.
3. **Given** a valid logo reference whose file is missing or is not an image, **When** the page loads, **Then** the top
   bar shows the default mark and a warning names the field.
4. **Given** a valid dark logo whose file is missing and a working logo, **When** the page loads with the light theme
   on, **Then** the warning shows at once, and the dark theme later shows the default mark.
5. **Given** a warning from the brand and a warning from the theme in the same file, **When** the page loads, **Then**
   both show in the same place, on every tab.

---

### Edge Cases

- An SVG logo that contains a script or a link to another origin shows as a picture only. Nothing in it runs and
  nothing in it is requested.
- A name with markup, such as `<b>Acme</b>`, shows as that text. It is never read as markup.
- A name made of spaces only is an empty name and is rejected.
- A very long name, and a very wide or very tall logo, never push the top bar past its row or grow it. The name is
  shortened with an ellipsis and the logo is scaled to fit, with its proportions kept.
- On a narrow screen the top bar wraps as it does today, and the brand stays in its first row.
- A same-origin logo that redirects to another origin is blocked by the page's policy and handled as a logo that
  failed to load.
- A logo reference with a query string or a fragment, such as `/logo.svg?v=3`, is valid.
- A logo reference that starts a URL scheme without being a URL, such as `logo:1.png`, is read as a scheme and rejected.
- Scheme-relative references (`//host/logo.png`), backslashes and tab or newline characters that a URL parser would
  strip or rewrite cannot be used to reach another origin.
- `brand: {}` is valid and changes nothing. `brand: null`, a string or a list is not an object and is rejected.
- A theme map and a brand together in one file both apply. A brand never changes theme values, and a theme never
  changes brand values.
- A recorded session export and its import do not carry the brand. The brand belongs to the deployment, not to a
  recording.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The configuration MUST accept an optional `brand` object with three optional fields: `name`, `logo`
  and `logoDark`. The configuration format stays at version 0. A file without `brand` MUST read and behave as before,
  and the page without a brand MUST show the default mark and the text "agui-inspector".
- **FR-002**: A valid `name` MUST replace the text "agui-inspector" in the top bar's heading. It MUST be shown as
  plain text and MUST be a string with at least one character that is not whitespace.
- **FR-003**: A valid `logo` MUST replace the default mark in the top bar. It MUST be shown as an image at a fixed
  height, with its proportions kept, and without the accent-colored frame that the default mark has.
- **FR-004**: Each field MUST replace only its own counterpart. A name without a logo keeps the default mark, and a
  logo without a name keeps the text "agui-inspector".
- **FR-005**: A valid `logoDark` MUST show instead of `logo` whenever the dark theme is on. The page MUST follow the
  same light or dark choice as the rest of the page: the explicit choice from the theme switch when there is one,
  and the system preference otherwise. Without `logoDark`, `logo` MUST show in both themes. A `logoDark` with no valid
  `logo` MUST be rejected with a warning that says so.
- **FR-006**: A logo MUST be one of two things: a reference that resolves to the page's own origin, or a `data:` URI
  with an image type. A reference is read against the page's own location, as `config.json` and `hosting-config.json`
  are, and never against the location of a configuration file that was read from somewhere else. A `data:` logo has
  no size limit. Everything else MUST be rejected: a URL on another origin, a scheme-relative reference, any other scheme
  (`http` or `https` on another origin, `blob:`, `file:`, `javascript:`, `data:` with a type that is not an image),
  a URL with credentials, and a value that is not a nonempty string.
- **FR-007**: The content security policy MUST NOT change: images stay limited to the page's own origin and `data:`.
  A rejected logo MUST cause no request, because the check happens before any image is created. The page MUST make
  no third-party request for the brand.
- **FR-008**: A bad brand value MUST give a nonfatal "Configuration" warning in the place and form that rejected theme
  values use today. Startup MUST continue. Each bad field MUST be dropped on its own, and every other valid field, the
  agents, the presets and the theme MUST still apply. A warning MUST name the field and say that it was ignored. It
  MUST NOT repeat the rejected value. The rejected values are:
  - `brand` is not an object;
  - `brand` has a field other than `name`, `logo` and `logoDark`;
  - `name` is not a string, is empty or is only whitespace;
  - `logo` or `logoDark` is not a string, is empty, or breaks FR-006;
  - `logoDark` is set and `logo` is missing or rejected.
- **FR-009**: A valid logo that fails to load MUST NOT leave a broken image in the top bar. The theme that uses it
  MUST show the default mark, and the page MUST show a "Configuration" warning that names the field. Both logos load
  when the page starts, whatever the theme, so the warning does not wait for a theme change. A dark logo that fails
  MUST NOT fall back to `logo`.
- **FR-010**: `mount_inspector` MUST accept an optional `brand` argument, a `Brand` record that the package exports,
  with `name`, `logo` and `logo_dark`. It MUST write the set fields into the `config.json` it serves, as given, with
  `logo_dark` written as `logoDark`, and leave out the unset ones. The helper MUST NOT check the values: the page checks
  them when it loads the file and warns, as it does for `theme`. A mount with no brand MUST serve a `config.json` identical to the one served
  before this feature. The helper MUST add no route, change no header and serve no logo file of its own.
- **FR-011**: The brand MUST work in every mode, with the same result in each: embedded through `mount_inspector`,
  embedded through a host that serves the static files and its own `config.json`, hosted, and the npm static assets.
  Only `config.json`, or the file that `hosting-config.json` names in its place, carries the brand. The brand MUST NOT
  read from, write to or widen `hosting-config.json` or the request policy.
- **FR-012**: The brand MUST hold no credentials, and the name and logo MUST NOT be recorded in a session export, a
  profile or browser storage. The page MUST make no telemetry call about the brand.
- **FR-013**: The name MUST be the text of the page's heading. The logo is decoration next to that heading and MUST
  have an empty text alternative, so a screen reader hears the name once. The brand adds no control that takes focus.
- **FR-014**: The default mark MUST keep its four synced copies and its black and white repository assets, unchanged.
  The brand MUST NOT edit the page title, the favicon, the footer, the failure page shown when startup fails or any
  other part of the page.
- **FR-015**: The configuration, theming and embedding documentation pages MUST describe the fields, the logo rules,
  the warnings, the `mount_inspector` argument and how to serve a logo from the host's own origin. The configuration
  page MUST carry the compatibility note: 0.2.0 adds the optional `brand` field, and before 0.2.0 an unknown field
  was an error. The hosted page MUST point to the same rules.
- **FR-016**: Tests MUST cover the default page, a valid brand (name only, logo only, both, with a dark logo and
  without) and each rejected value in FR-008, for the configuration reader, the page, the Python helper and every
  serving mode. A test MUST show that no request goes to another origin and that the policy is unchanged. A change
  that ships in the wheel or the npm package MUST add a changeset for that package: both here.
- **FR-017**: The production bundle MUST stay within the existing 2,000,000-byte minified and 600,000-byte gzip
  budgets, and the 5,000-frame acceptance and responsiveness criteria MUST be unchanged.

### Key Entities

- **Brand**: The optional deployment-level identity of the inspector: a product name, a logo and a dark logo, each
  optional. It lives in the configuration and has no effect on agents, presets or the theme.
- **Logo source**: Where a logo comes from. Either a reference that resolves to the page's own origin, or a `data:`
  URI of an image. Nothing else is a logo source.
- **Configuration warning**: A message under the top bar that says a part of the configuration was ignored. It
  names the field and never repeats the value. Theme problems and brand problems share it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the same brand set, the top bar shows the adopter's name and logo, and neither the default text nor
  the default mark, in all four serving modes, in the light and in the dark theme.
- **SC-002**: With no brand, the top bar matches the 0.1.0 page, and `mount_inspector` serves the same `config.json`
  bytes as before for the same arguments.
- **SC-003**: For each rejected value in FR-008, the page shows one warning, drops only that field, keeps the agents
  and every other valid field working, and makes zero requests to another origin.
- **SC-004**: With a brand set, the content security policy text and the set of origins the page contacts are the same as
  without one, in every mode.
- **SC-005**: An adopter sets a name and a logo with one `config.json` entry or one `mount_inspector` argument, using
  only the documentation, with no rebuild and no extra stylesheet.
- **SC-006**: After every theme change, by the switch or by the system preference, the logo on screen is the one for
  the theme on screen. No sequence of changes leaves the wrong logo showing.
- **SC-007**: The production bundle stays within the existing size budgets.

## Assumptions

- Scope comes from issue #73 and the accepted 0.2.0 roadmap, item 1. The constitution needs no amendment. Principle IV
  already allows assets from the page's own origin, and `data:` images are already allowed by the existing policy.
- Field names follow the other configuration fields, which are camelCase (`allowedOrigins`, `allowVisitorTargets`).
- A file with `brand` is read by 0.2.0 and later. An earlier inspector rejects it as an unknown field, the way it
  rejected `theme` before 0.1.0. This is documented as a compatibility note, with no migration step.
- Adopters host their own logo file. The inspector does not upload, store, resize or proxy it. In embedded mode the host
  serves it from one of its own routes, and in hosted and static modes it sits beside the page.
- Any `data:` URI with an image type is allowed, including `image/svg+xml`. The page shows every logo through an
  image element, so the browser never runs a script from it.
- Out of scope: the page title, the favicon, the social preview, the footer, per-agent brands, a link on the logo,
  changing colors (the theme does that), translating the name, editing the brand in the page, and serving logo files
  from the Python helper.
