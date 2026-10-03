---
"agui-inspector-python": patch
---

On a FastAPI app, `mount_inspector` now registers API routes, so the app's own `FastAPI(dependencies=[...])` guards run for the page, `config.json`, the assets and the slash redirect. The redirect keeps the ASGI `root_path`, so an inspector under `outer.mount("/api", app)` redirects to `/api/agui-inspector/`.
