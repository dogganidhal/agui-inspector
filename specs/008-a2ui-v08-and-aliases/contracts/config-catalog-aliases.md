# Contract: `catalogAliases` in config.json

**Spec**: FR-011 to FR-018 | **Data model**: [data-model.md](../data-model.md)

## Field

```json
{
  "version": 0,
  "agents": [{ "id": "support", "url": "/agents/support/stream" }],
  "catalogAliases": {
    "https://catalogs.invalid/old/standard_v0_8.json": "https://a2ui.org/specification/v0_8/standard_catalog_definition.json",
    "https://catalogs.invalid/old/basic_v0_9.json": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
  }
}
```

- Optional, top level, once for all agents. `version` stays 0. A file without the field reads as it did in 0.1.0.
- Key: the id an agent sends. Value: the id of a catalog that the inspector bundles.
- Bundled catalogs, the only valid values:
  - `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json` (A2UI v0.9 basic catalog)
  - `https://a2ui.org/specification/v0_8/standard_catalog_definition.json` (A2UI v0.8 standard catalog)
- Built in, and not configurable: `https://a2ui.org/specification/v0_9/basic_catalog.json`, the default id of
  `@ag-ui/a2ui-middleware` 0.0.11, which stands for the v0.9 basic catalog.
- An alias serves the surfaces of the version its value belongs to. Matching is exact.
- The inspector never fetches a catalog and never rewrites a received message.

## Warnings

A bad entry never stops startup and never removes a good one. Each warning shows in the page's configuration
warnings with the kind "Configuration". Names are quoted and cut at 48 characters.

| Input | Warning (exact text) |
| --- | --- |
| `"catalogAliases": 3` | `catalogAliases must be an object from a catalog id to a bundled catalog id; it was ignored` |
| key `""` | `catalogAliases: "" is not a catalog id; it was ignored` |
| key is a bundled or built-in id | `catalogAliases: "<key>" is already a built-in catalog id; it was ignored` |
| value is not a string | `catalogAliases: "<key>" must map to a catalog id (a string); it was ignored` |
| value is not a bundled id | `catalogAliases: "<key>" maps to "<value>", which is not a catalog this inspector bundles; it was ignored` |

## Embedded helper

```python
mount_inspector(app, agents=[...], enabled=True, catalog_aliases={"<former id>": "<bundled id>"})
```

`catalog_aliases` is `dict[str, str] | None`. A dict goes into `config.json` as `catalogAliases`, unchanged, and the
page validates it. `None` leaves the field out. The helper does not validate it, as it does not validate `theme`.

## Page behavior

| Agent sends | Config | Result |
| --- | --- | --- |
| v0.9 `createSurface`, `catalogId` = a bundled or built-in id | any | Drawn |
| v0.9 `createSurface`, `catalogId` = a configured alias of the v0.9 catalog | has the alias | Drawn |
| v0.8 `beginRendering` with no `catalogId` | any | Drawn with the v0.8 standard catalog |
| v0.8 `beginRendering`, `catalogId` = the v0.8 standard id or an alias of it | has the alias | Drawn |
| any `catalogId` not above, including one that differs by a slash or a scheme, or that aliases the other version | any | `Catalog not found: <id>`, the entry as received, no surface |
