# Research: Remembered setup and launch links

## 1. What a reload loses today

- **Decision**: Keep the selection (agent id or typed endpoint) and the selected agent's variable values. Leave the rest.
- **Rationale**: Read from the code. `Root` starts `selectedId` at `started.selectedAgentId`, the first agent.
  `runtime.setTarget` keeps a typed endpoint in memory only. `settings.variables` starts at `{}` and `resetVariables`
  empties it on every target change, so the preset defaults fill in. `createRuntime` makes a new thread id. `Composer`
  keeps its text in component state. The authentication popover keeps the header name in component state. Pane, tab and
  frames-list filters are component state. Already kept: the profile (`agui-inspector.profile`) and the theme choice
  (`agui-inspector.theme`).
- **Alternatives considered**: Keeping the thread id (rejected: without the conversation it sends turns the screen does
  not show). Keeping the draft (rejected: not setup, may be sensitive). Keeping the header name (rejected: it belongs to
  the token, and the request says headers never go in storage).

## 2. Fragment or query string

- **Decision**: The fragment, as `URLSearchParams` form.
- **Rationale**: Browsers never send the fragment, so the message and context stay out of the host's logs, a proxy's
  logs and the command's listener. A helper's redirect from `/inspector` to `/inspector/` keeps the fragment (browsers
  carry it across a redirect whose `Location` has none), while a query string depends on each helper copying it.
  `URLSearchParams` is what every URL library writes by default, so a link builder needs no custom encoder. A
  base64 JSON blob was the other option: one schema, but a developer cannot read what the link does before opening it.
- **Alternatives considered**: Query string (reaches the server, depends on helpers). Base64 JSON (unreadable).

## 3. Prefill or send

- **Decision**: Prefill only. No key sends.
- **Rationale**: In embedded mode the page sends runs and preparation requests with the host's cookies
  (`credentials: 'same-origin'`). If a link could send, any page that links to the inspector could start an
  authenticated run on the host with a message it chose: a cross-site request in all but name. Pressing send is the
  developer's consent, and the notice tells them to check the values first. It also matches the request: "only presses
  send".
- **Alternatives considered**: An `autosend` key (rejected for the reason above). Auto-send only in hosted mode
  (rejected: two behaviors for one key, and hosted pages can still reach a local server with its own cookies).

## 4. What an untrusted link can do

- **Point the page at another endpoint**: only one the page could already reach by a typed endpoint. Embedded: its own
  origin. Hosted: the fixed list, or the visitor boundary if the deployer opted in. `resolveTarget` and the content
  security policy decide, and the link changes neither. The token is cleared on reload and on target change, and is never
  in a link, so it cannot follow. A plugin header provider already receives the URL of each request and the plugins docs
  tell it to check the destination; that is unchanged.
- **Prefill a harmful message, context or forwarded properties**: possible, and visible. Nothing is sent until the
  developer presses send. The notice names every key the link set, and the values are on screen in the composer and
  in Settings.
- **Persist its values**: the link's selection and profile values are saved (spec Clarifications). The developer can
  change them back, and the docs say how to export a profile first. A link cannot change the theme, plugins,
  configuration file or policy.
- **Run code**: no. Values are text or `JSON.parse` output, rendered as React text. The content security policy forbids
  inline scripts and `eval`, and this feature does not touch it.
- **Hang the page**: capped by length (research 5) and parsed once.

## 5. Size limit

- **Decision**: 65,536 characters for the whole fragment.
- **Rationale**: Large enough for a long message and several context entries. Chromium accepts URLs up to 2 MB and Firefox
  far more, so the limit is ours, not the browser's. A limit keeps a pasted mistake (a whole log) from filling storage
  through the profile.
- **Alternatives considered**: No limit (storage quota errors show up later and far from the cause). 8 KiB (too small for
  real context).

## 6. Precedence and saving

- **Decision**: link > saved setup and saved profile > configuration defaults. Link values are saved; the message is not.
  The fragment is removed with `history.replaceState`, which adds no history entry and fires no `hashchange`.
- **Rationale**: One rule a link builder can predict. Saving makes a reload agree with what the developer saw. Removing
  the fragment keeps a reload from applying the link again and keeps the message out of the address bar.

## 7. A second link in the same tab

- **Decision**: On `hashchange` with a nonempty fragment, `location.reload()`.
- **Rationale**: Changing only the fragment does not reload a page, so a pasted second link would do nothing. Reloading
  runs the one start path, with every check, instead of a second "apply while running" path. The cost is the same as
  any reload: the token and the conversation are cleared.

## 8. Where the code goes

- **Decision**: `src/core/setup` (framework-free), wired in `startPage` and `mountApp`.
- **Rationale**: `startPage` already orders the start (policy, configuration, profile, plugins). The setup must apply
  after the configuration (to know the agents) and before plugins load and the first render. `mountApp` is the one entry
  that every mode and the demo use, so reading `location` there covers all of them, and `startPage` stays testable
  without a browser.

## 9. Warnings

- **Decision**: Link problems are warnings of kind "Link"; saved-setup problems are "Configuration" warnings. Neither
  repeats a value. The notice is a neutral finding of kind "Link".
- **Rationale**: Same place and form as theme, brand and plugin warnings. Not repeating values keeps a credential that
  slipped into a bad key off the screen.
