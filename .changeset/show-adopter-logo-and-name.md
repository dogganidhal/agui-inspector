---
"agui-inspector": minor
"agui-inspector-python": minor
---

An optional `brand` entry in `config.json` puts your product's name and logo in the top bar, with a second logo for the dark theme. A logo must come from the page's own origin or be a `data:` image, and a bad value gives a "Configuration" warning without stopping startup. `mount_inspector` takes a matching `Brand` argument. Without a brand the page looks as before.
