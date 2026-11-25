---
"agui-inspector": patch
"agui-inspector-python": patch
---

An A2UI tap whose action context binds an entry to a path the data model lacks is sent again. Before, the entry resolved to `undefined` and the runtime refused the whole tap with "An A2UI action needs a context that is a JSON object". Now the context is written as `JSON.stringify` writes it: such an entry of an object is left out at any depth, such an item of a list becomes `null`, and `null` stays `null`. The surface shows a warning that names the action, its component and each entry left out. This applies to 1.0, v0.9 and v0.8 surfaces and to headless sessions, where the warning is in the surface's `issues` with the source `action`.
