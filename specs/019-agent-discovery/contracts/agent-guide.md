# Contract: agent guide and startup output

## The file

- Source: `packages/inspector/public/llms.txt`. Built to `packages/inspector/dist/llms.txt`.
- Served at `<page>/llms.txt` by every mode, as `text/plain; charset=utf-8`, same bytes everywhere.
- Static. No mode rewrites it. It holds no credential, header value or host value.
- Addresses inside it are relative to its own URL, except links to the docs site, which are absolute.
- Shown verbatim on `website/content/docs/agent-guide.mdx`.

## Draft text

The text below is the draft for review. The implementation may fix wording; the sections and facts stay.

```text
# agui-inspector

> A developer tool for AG-UI agents, served next to this file. It records every request and frame of an agent run, checks them against the protocol and drives runs like a client. This file tells a coding agent how to use it.

Addresses here are relative to this file. If this file is `http://127.0.0.1:8000/agui-inspector/llms.txt`, the page is `http://127.0.0.1:8000/agui-inspector/`.

## Where things are

- The page is the directory this file is in. A person opens it in a browser.
- `config.json`, next to this file, lists the agents the page knows. Each has an `id` and a `url`, the agent's AG-UI endpoint. A `url` that starts with `/` is on the same origin as this file.
- When the `agui-inspector` command serves the page, each `url` is a `/proxy/<n>/` path of the command and each agent's `name` is the real endpoint. Point the commands below at the real endpoint.
- This file, the page and `config.json` sit behind the same authentication as the server's other routes.

## Open the page for a person

A launch link opens the page with an agent and a first message filled in. The person presses send. The page never sends by itself.

    <page>#agent=<id>&message=<text>

Build the fragment with `URLSearchParams` in JavaScript or `urllib.parse.urlencode` in Python. A link never carries a credential: the page refuses keys such as `token`, `authorization` and `header.*`. All keys: https://dogganidhal.github.io/agui-inspector/docs/launch-links/

## Drive an agent yourself

Point these commands at an agent endpoint from `config.json`, never at the page. They need Node.js 24 or newer, in Python projects too.

    npx agui-inspector run --target http://127.0.0.1:8000/agents/demo/stream --message "hello" --out session.json

Exit code 0 means the run completed with no findings, 3 completed with findings, 1 could not complete, 2 wrong arguments. A person opens `session.json` in the page with Import session.

For several steps, such as answering an interrupt, returning a tool result or firing an A2UI action, add the MCP server to your MCP client:

    npx agui-inspector mcp --target http://127.0.0.1:8000/agents/demo/stream

## Credentials

The page sends the host's cookies. The commands do not. Pass the host's authentication as a header whose value comes from the environment, for example `--header "Authorization: $AGENT_AUTH"`. Never write a credential into a file, a link or a command you show.

## Docs

- [Point a coding agent at the inspector](https://dogganidhal.github.io/agui-inspector/docs/agent-guide/): this file, and blocks for AGENTS.md and CLAUDE.md
- [Tests and coding agents](https://dogganidhal.github.io/agui-inspector/docs/tests-and-agents/): the testing library, `run` and `mcp`
- [Launch links](https://dogganidhal.github.io/agui-inspector/docs/launch-links/): every key and what the page refuses
- [Rules](https://dogganidhal.github.io/agui-inspector/docs/rules/): what each finding means
- [Command](https://dogganidhal.github.io/agui-inspector/docs/cli/): serving the page locally against a target
- [Embedding](https://dogganidhal.github.io/agui-inspector/docs/embedding/): the Python and JavaScript helpers
```

## The page

`packages/inspector/src/app/index.html` gains, in `<head>`:

```html
<link rel="describedby" type="text/plain" href="llms.txt" />
```

## Startup output

Helpers (Python `mount_inspector`, Express, Hono, Next.js), one warning as today, now:

```text
agui-inspector is enabled and mounted at <mount>; disable it outside development; guide for coding agents at <mount>/llms.txt
```

`<mount>` is what the warning names today. The text up to `development` is unchanged.

Command, standard output, after the target lines:

```text
agui-inspector listening on http://127.0.0.1:4747/
  /proxy/1 -> http://127.0.0.1:8787 (headers: Authorization)
guide for coding agents: http://127.0.0.1:4747/llms.txt
```

`run` and `mcp` listen on nothing and print no guide line.

## Paste-ready blocks

Three variants on `agent-guide.mdx`, each a Markdown section for `AGENTS.md` or `CLAUDE.md`, with `<mount>` and the
agent endpoint as placeholders. Each says where the guide is, where the page is, which command drives the agent, that
credentials come from the environment, and links to the docs page. No block holds a credential value.
