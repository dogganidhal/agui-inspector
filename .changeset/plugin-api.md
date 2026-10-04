---
"agui-inspector": minor
"agui-inspector-python": minor
---

A plugin API lets a deployment load its own code into the inspector. An optional `plugins` entry in `config.json`, the `plugins` argument of `mount_inspector`, the `plugins` option of the Express, Hono and Next.js helpers, and the new `--plugin <file>` option of the command list JavaScript modules from the page's own origin. A plugin default-exports a function that receives an object with a version number and four functions. `beforeRun` adjusts or refuses the input of each run. `provideHeaders` returns headers that change on every request, kept in memory and never recorded or exported. `renderCustomEvent` and `renderActivity` draw a custom event or an activity type in a card, with the JSON view beside it. A plugin that fails shows a "Plugin" warning and never stops the page. The content security policy does not change. The plugin API starts at version 0. A change that can break a plugin raises the number and comes with migration steps in this changelog. A `config.json` with `plugins` is refused by an inspector older than 0.2.0, which does not know the field. Without `plugins` the page and `config.json` are as before.
