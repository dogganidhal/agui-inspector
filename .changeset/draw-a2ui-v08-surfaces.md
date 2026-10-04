---
"agui-inspector": minor
"agui-inspector-python": minor
---

Draw A2UI v0.8 surfaces with the v0.8 renderer, beside v0.9. The inspector finds the version of each operation itself, so one activity can hold both. A new optional `catalogAliases` field in `config.json` maps a former A2UI catalog id to a bundled catalog, and `mount_inspector` takes it as `catalog_aliases`. An unknown id still shows "Catalog not found" with the entry as received. Two refusal messages for operations that are neither v0.8 nor v0.9 now read differently.
