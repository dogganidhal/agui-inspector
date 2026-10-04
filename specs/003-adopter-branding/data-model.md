# Data Model: Adopter branding

## BrandConfig

The validated brand. It is a plain object that the reader builds and the view reads. Every field is optional. A brand
with no valid field is not kept: `ParsedConfig.brand` is then absent.

| Field | Type | Rule |
| --- | --- | --- |
| `name` | string | A string with at least one character that is not whitespace. Shown as the heading text. Without it, a valid `logo` shows alone and the heading "agui-inspector" is visually hidden. |
| `logo` | string | A resolved logo source (below). Shown instead of the default mark. |
| `logoDark` | string | A resolved logo source. Shown instead of `logo` in the dark theme. Kept only when `logo` is kept. |

`ConfigFile` gains `readonly brand?: BrandConfig`. `ParsedConfig` inherits it. `Started` carries it to the page.

### In the file

The file holds the same names, as written by the adopter. The format stays at version 0.

```json
{
  "version": 0,
  "agents": [{ "id": "support", "url": "/agents/support/stream" }],
  "brand": { "name": "Acme Agent Console", "logo": "/static/acme.svg", "logoDark": "/static/acme-dark.svg" }
}
```

## Logo source

The one thing a logo can be. The reader resolves the written value against the page's location and accepts the result
when:

| Resolved URL | Result |
| --- | --- |
| `data:` with a media type that starts with `image/` | Accepted |
| `http:` or `https:` with the page's own origin and no user name or password | Accepted |
| `http:` or `https:` with another origin | Rejected |
| Any other protocol, including `javascript:`, `file:`, `blob:` and `data:` with another media type | Rejected |
| A user name or a password in the URL | Rejected |
| Not a string, empty, or not parseable | Rejected |

The accepted value is the resolved `href`. A relative reference is read against the page, never against another
configuration file. A `data:` logo has no size limit.

## Brand warnings

A warning is a string in `ParsedConfig.warnings`, rendered in the "Configuration" strip. The text follows the theme
wording. `<field>` is `brand`, `brand.name`, `brand.logo` or `brand.logoDark`.

| Cause | Message |
| --- | --- |
| `brand` is not an object | `brand must be an object with optional "name", "logo" and "logoDark"; it was ignored` |
| An unknown field | `brand: "<field>" is not a brand field (use "name", "logo" or "logoDark"); it was ignored` |
| `name` is not a string, or is empty or whitespace | `brand.name must be a nonempty string; it was ignored` |
| A logo is not a nonempty string | `brand.logo must be a nonempty string; it was ignored` |
| A logo is not a URL | `brand.logo is not a valid URL; it was ignored` |
| A logo has credentials | `brand.logo must not contain credentials (user:password@); it was ignored` |
| A logo is not on the page's origin and not a `data:` image | `brand.logo must be a path on this origin or a data:image URI; it was ignored` |
| `logoDark` without a valid `logo` | `brand.logoDark needs a valid brand.logo; it was ignored` |
| A valid logo fails to load (added by the page) | `brand.logo could not be loaded; the default mark is shown` |

`brand.logoDark` takes the place of `brand.logo` in the logo rows. A message never contains the rejected value. Only an
unknown field name is quoted, through the existing `shown` helper.

## Load state

Transient, kept by `App`, never stored.

| State | Meaning |
| --- | --- |
| `failed.logo` | The image for the light theme fired an error. The light wrapper shows the default mark. |
| `failed.logoDark` | The image for the dark theme fired an error. The dark wrapper shows the default mark. |

Without a `logoDark`, one image serves both themes, and its failure sets `failed.logo` and shows the default mark in
both.

## Python record

```text
Brand(name: str | None = None, logo: str | None = None, logo_dark: str | None = None)   # frozen
```

Written into `config.json` as `{"name", "logo", "logoDark"}` without the unset fields. No `Brand`, no `brand` key.
