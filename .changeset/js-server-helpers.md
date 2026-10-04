---
"agui-inspector": minor
---

The package has helpers that serve the inspector from an Express, Hono or Next.js server, imported from `agui-inspector/express`, `agui-inspector/hono` and `agui-inspector/next`. They take the same `agents`, `enabled`, `path`, `theme` and `brand` arguments as `mount_inspector` and the same contract: nothing is mounted unless `enabled` is `true`, an enabled helper logs a warning that names the path, and every response carries the page's content security policy. They need Node.js 22.12 or newer, install no web framework, and are ES modules with type definitions. `staticAssetsPath` has the same value, now written so that a bundler such as Turbopack can load it.
