# Branding

The mark is an agent (the solid dot) joined to a UI (the outlined square). The line between them is the connection the inspector watches.

| File | Use |
| --- | --- |
| `mark.svg` | The glyph alone, drawn in `currentColor` on a 24 px grid. Inline it, or use it as an `<img>` on a light page. |
| `icon.svg` | The glyph in white on a rounded black square. It is the favicon, the README logo and the source for any social or app image. |

- The repo's own assets stay black and white. Don't add a color, gradient or outline to the mark.
- The inspector's top bar draws the mark in `--agui-accent`, so an adopter's theme recolors it there. See [theming](../docs/theming.md).
- Keep the 2 px round stroke. The mark stays legible down to 16 px.
- The favicon is `icon.svg` inlined as a data URI in `packages/inspector/src/app/index.html` and `demo/index.html`. A test fails if either copy, the two SVGs or the in-app icon stop matching.
