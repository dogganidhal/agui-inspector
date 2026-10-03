---
"agui-inspector-python": patch
---

Importing a recording now refuses a frame labelled `valid` whose event fails the AG-UI schema, and shows an import error instead of a blank inspector. A pane that cannot render a recording shows its own error, and the previous capture comes back on screen and stays exportable.
