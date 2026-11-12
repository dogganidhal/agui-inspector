# Research: Agent discovery

## R1. Format and name of the guide

Decision: one Markdown file named `llms.txt`, in `packages/inspector/public/`, served next to the page.

The llms.txt proposal (<https://llmstxt.org/>, read 2026-11-12) puts the file at the site root or at any path within
the site, and the file covers the URLs under its path, so `/agui-inspector/llms.txt` covers the page. The format is
Markdown: an H1 with the name (the only required part), a blockquote summary, free sections without headings, then H2
sections whose items are links with notes. A page points to the file with `rel="describedby"`. The proposal also
suggests `.md` copies of HTML pages; the inspector page is an application with no content to copy, so that part does
not apply.

Alternatives:

- `AGENTS.md` served next to the page. That name means "instructions for agents working in this repository". An agent
  that finds it on a server could take it as instructions for the adopter's repository. Rejected.
- Both `llms.txt` and a `.md` copy. Two names for one text, and nothing in the proposal asks for it. Rejected.
- Generating the guide per request with the real mount path and agents. It would need per-mode code in Python and
  TypeScript, and it would put host values in the text. The relative form gives the same answers: the page is the
  guide's directory and `config.json` sits next to it. Rejected.

## R2. Serving it in every mode

Every mode already serves every file of the built page:

- `scripts/build.mjs` copies `packages/inspector/public/` into `dist/` (that is how `hosting-config.json` ships).
- `scripts/package-python.mjs` stages all of `dist/` into the wheel, with checksums. `mount_inspector` serves any
  packaged file below the mount (`_find`).
- `createInspectorHandler` in `src/server/core.ts` serves any file of `dist/` below the mount, for Express, Hono,
  Next.js and the command.
- The npm package ships `dist/`, and the hosted page is `dist/` deployed by the adopter.
- `scripts/build-demo.mjs` calls `buildApp`, so the public demo serves it too.

So one new file reaches every mode with no new route. Two gaps:

- `core.ts` maps only `.html`, `.js`, `.css` and `.json` to a content type. `.txt` would go out as
  `application/octet-stream`. Add `'.txt': 'text/plain; charset=utf-8'`.
- Python uses `mimetypes.guess_type`, which gives `text/plain`, and Starlette adds `; charset=utf-8` to text types.
  Nothing to change.

Since the guide goes through the existing routes, the `enabled` gate, the mount path, the host's middleware and FastAPI
application dependencies apply as they do to the page (FR-006).

## R3. Discovery channels

An agent must learn the guide's address from something it already reads:

| Channel | Reaches an agent that | Change |
| --- | --- | --- |
| Startup warning of the helpers | runs the server, or reads its logs | Append `; guide for coding agents at <mount>/llms.txt` in `warnMounted` and in the Python helper |
| Listening output of the command | runs `npx agui-inspector` | One more line with the full URL |
| `<link rel="describedby" href="llms.txt">` in `index.html` | fetches the page | One line in `src/app/index.html` |
| Docstring and helper docs, npm README | reads the code that mounts the inspector | A sentence each |
| Paste-ready block | works in a repository whose owner pasted it | Docs page |

The maintainer chose all of them in the clarify session. The warning keeps its current text first, which still names
the mount path as the constitution requires, so a log search for the old text keeps working.

The demo has its own `index.html` (`demo/index.html`) and does not get the link: the demo is not where adopters' agents
look.

## R4. What the guide says about launch links

Feature 016 (#109) owns the format, in `specs/016-remembered-setup-and-launch-links/contracts/launch-link.md` and the
docs page `launch-links.mdx`. The guide gives the shape (`<page>#agent=<id>&message=<text>`), says the person presses
send, says credential keys are refused, and links to the docs page. It does not list every key, so 016 can grow without
the guide drifting.

## R5. Keeping the docs copy equal

The plugin example does the same: `packages/inspector/tests/plugins/docs.test.ts` checks that `plugins.mdx` contains
`examples/plugin/plugin.js` character for character. The new test does the same for `llms.txt` and the new docs page.
The guide uses indented code blocks rather than fences, so the docs page can show it inside one fenced block.

## R6. Nothing secret

The guide is static, so it can hold only what the repository holds. Tests check:

- The source has no credential-like text: no `Bearer ` or `Basic ` followed by a literal, no `Authorization:` followed
  by a value that is not an environment variable reference.
- In each mode the served bytes equal the source bytes, with a synthetic header value given to the command and agents
  configured in the helpers, so no mode adds host values.
- The paste-ready blocks pass the same credential check.
