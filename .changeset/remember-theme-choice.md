---
"agui-inspector": patch
"agui-inspector-python": patch
---

The light or dark theme you pick with the top-bar switch now survives a reload. The page keeps the word `light` or `dark` in browser storage under `agui-inspector.theme` and applies it before the first paint. Without a stored choice it follows the system preference, as before. A stored value that is neither is ignored, and storage that fails never breaks the page.
