---
"agui-inspector": minor
"agui-inspector-python": minor
---

A2UI 1.0 surfaces draw and can be tapped. An `a2ui_operations` entry with `"version": "1.0"` is applied by `@a2ui/web_core` and drawn by `@a2ui/react` with the official 1.0 basic catalog (`https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`), with the same guards as v0.9: media load nothing and `openUrl` opens nothing. `catalogAliases` in `config.json`, and `catalog_aliases` in `mount_inspector`, can now map an agent's own 1.0 catalog id to that catalog. A component type a catalog lacks shows an error in its place with its definition and properties, and the entry stays as sent. A 1.0 button sends the same `forwardedProps.a2uiAction.userAction` envelope as v0.9, with its `@path` context resolved and copied at the click.

Every run now carries `forwardedProps.a2uiRendererCapabilities`, with the catalog ids the inspector draws for v0.9 and 1.0, configured aliases included. The new optional profile setting `sendA2uiCapabilities` (a switch in Settings, on by default) turns it off, and a forwarded property of the same name from a preset or the profile replaces it. A profile file that sets `sendA2uiCapabilities` does not load in 0.3.0 or earlier. Headless sessions take a `catalogAliases` option and list 1.0 surfaces in `surfaces()`.

`@a2ui/react` and `@a2ui/web_core` move from 0.12.0 to 0.16.1. The renderer's own v0.9 components (`Text`, `Column`, `List`, `Card`, `CheckBox`, `Slider`, `DateTimeInput`) are now custom elements from `@a2ui/web_core`. A date and time input is now a date input and a time input, and the value it writes has seconds. The root DOMPurify override is gone, because `@a2ui/markdown-it` 0.2.4 asks for a fixed version. Refusal messages for an unknown version now name 1.0.
