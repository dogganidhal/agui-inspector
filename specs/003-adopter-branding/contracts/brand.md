# Contract: brand

Four surfaces carry the brand: the configuration file, the reader's result, the Python argument and the top-bar markup.
Tests and docs depend on the names below.

## 1. The `brand` field of `config.json`

```json
{ "version": 0, "agents": [], "brand": { "name": "string", "logo": "string", "logoDark": "string" } }
```

- Optional at every level. `brand: {}` is valid and changes nothing.
- Allowed keys of `brand`: `name`, `logo`, `logoDark`. Anything else gives a warning.
- The format version stays 0. An inspector older than 0.2.0 rejects a file that has `brand` as an unknown field.
- It carries no credentials. A logo URL with credentials is rejected.
- `hosting-config.json` has no brand and gains no field.

Logo rules and warning texts are in [data-model.md](../data-model.md).

## 2. The reader

```ts
// packages/inspector/src/contracts.ts
export interface BrandConfig {
  readonly name?: string;
  readonly logo?: string;
  readonly logoDark?: string;
}
// ConfigFile gains: readonly brand?: BrandConfig

// packages/inspector/src/core/config/index.ts
export interface PageLocation { readonly origin: string; readonly baseUrl: string }
parseConfig(text: string, page?: PageLocation): Result<ParsedConfig>
loadConfig(url: string, fetchText: FetchText, page?: PageLocation): Promise<Result<ParsedConfig>>
```

- `ParsedConfig.brand` holds the valid fields, with logos resolved to `href`. It is absent when nothing is valid.
- `ParsedConfig.warnings` holds the brand warnings after the theme warnings, in field order.
- `brand` is an allowed top-level key. `brand` problems never return an error result.

`startPage` passes `{ origin: env.origin, baseUrl: env.baseUrl }` and returns `Started.brand`.

## 3. `mount_inspector`

```python
@dataclass(frozen=True)
class Brand:
    name: str | None = None
    logo: str | None = None
    logo_dark: str | None = None

def mount_inspector(app, *, agents, enabled=False, path="/agui-inspector", theme=None, brand: Brand | None = None) -> None
```

- `config.json` gets `"brand": {"name": ..., "logo": ..., "logoDark": ...}` with only the set fields, after `theme`.
  With `brand=None` the key is absent and the served bytes are those of 0.1.0.
- The helper does not validate the values. The page does.
- Routes, methods, headers and the log line are unchanged. A disabled call returns before it touches anything.
- `Brand` is in `__all__`.

## 4. The top bar

With no brand, the markup is today's:

```html
<span class="agui-app-brand">
  <span class="agui-app-mark" aria-hidden="true">…default mark…</span>
  <h1>agui-inspector</h1>
</span>
```

With a brand:

- `<h1>` holds `brand.name` when valid. The text is escaped React text.
- With a valid `logo` the `agui-app-mark` span is replaced by `<span class="agui-app-logo" aria-hidden="true">`.
  - Without `logoDark`: one `<img class="agui-app-logo-img" src="…" alt="">`.
  - With `logoDark`: two wrappers, `<span data-for="light">` and `<span data-for="dark">`, each with one image.
- A failed image is replaced, in its wrapper, by the default mark's `agui-app-mark` span.
- Images are limited by the stylesheet to the default mark's height and a fixed maximum width, with proportions kept.
- The stylesheet shows `data-for="dark"` only under the dark selectors that `tokens.css` uses, and `data-for="light"`
  otherwise.
- The load-failure warnings use the existing `agui-app-warnings` region and `Finding` with kind "Configuration".

## What does not change

The content security policy text, the request policy, `hosting-config.json`, the default mark in its four copies, the
page title, the favicon and the footer.
