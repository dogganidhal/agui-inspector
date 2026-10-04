# Contract: the plugin API (version 0)

What a plugin author can rely on. It is the text that `website/content/docs/plugins.mdx` turns into the reference page.
Types are written in TypeScript for precision. A plugin is plain JavaScript, so none of this is needed to write one.

## The module

A plugin is an ES module on the page's own origin. Its default export is a function.

```js
export default function activate(api) {
  if (api.version !== 0) throw new Error(`written for plugin API 0, this page has ${api.version}`);
  api.beforeRun(...);
  api.provideHeaders(...);
  api.renderCustomEvent('my.event', ...);
  api.renderActivity('my-activity', ...);
}
```

- The function is called once, with the API object, after the module has loaded. It may return a promise.
- Everything it registers is kept only if it returns, or its promise resolves, within 10 seconds without an error.
- The registration functions work only while the function runs. Later calls do nothing and give a warning.
- The module is served with a JavaScript content type. It may import other modules from the same origin.
- The module has the page's rights. It is not isolated. It must not rely on running in a sandbox.

## The API object

```ts
interface PluginApi {
  /** 0 in 0.2.0. Rises by one with each change that can break a plugin. */
  readonly version: number;
  beforeRun(hook: BeforeRunHook): void;
  provideHeaders(provider: HeaderProvider): void;
  renderCustomEvent(name: string, render: Render<CustomEventData>): void;
  renderActivity(type: string, render: Render<ActivityData>): void;
}
```

The object is frozen. It has no other member. An argument that is not what the signature says (a name that is not a
nonempty string, a function that is not a function) throws a `TypeError`, which is a failed activation.

## `beforeRun`

```ts
type BeforeRunHook = (run: {
  /** A copy of the input that the preset and the client profile produced. */
  readonly input: RunAgentInput;
  /** The selected agent's id. Absent for an endpoint typed in the page. */
  readonly agentId?: string;
  /** The absolute address the run goes to. */
  readonly url: string;
  /** Ends when the user presses Stop. */
  readonly signal: AbortSignal;
}) => RunAgentInput | undefined | void | Promise<RunAgentInput | undefined | void>;
```

- Called for every run the page sends: a message, a continuation, a surface action, and each automatic continuation.
- Called after the input is composed and before the first preparation request. Not called for a raw submission, and not
  while an imported recording is open.
- Hooks run in registration order. Each receives the result of the one before.
- Returning nothing keeps the input. Mutating `run.input` changes nothing: it is a copy.
- A returned input must pass the protocol's run input check and keep the same `threadId` and `runId`. It is copied before
  it is used.
- Throwing, rejecting or returning something invalid stops that one run. Nothing is sent and no exchange is recorded. The
  message is shown under the composer and as a warning.
- Throw to refuse a run on purpose. Pressing Stop while a hook works stops the run without a warning.
- What is sent is what is recorded: the exchange's request body and the run's `input` are the adjusted input.

## `provideHeaders`

```ts
type HeaderProvider = (request: {
  readonly method: string;
  /** The absolute address, query included. */
  readonly url: string;
  /** The exact body text that will be sent. Absent when the request has no body. */
  readonly body?: string;
  readonly signal: AbortSignal;
}) => Headers_ | undefined | void | Promise<Headers_ | undefined | void>;

type Headers_ = Readonly<Record<string, string>>;
```

- Called before each preparation request, each run request and each raw request, once per request. Not called for the
  configuration or a capabilities URL. Nothing is cached.
- Providers run in registration order. A later provider replaces a header of the same name, compared without case.
- A header the user typed in the token field replaces a provider's header of the same name.
- A name must be an HTTP header token that the transport does not own (not `Accept`, `Content-Type`, `Content-Length`,
  `Cookie`, `Set-Cookie`, `Host`). A value must be a string of tab, space and printable ASCII or Latin-1 characters.
- Throwing, rejecting, returning something that is not a plain object, or returning an invalid header stops that one request
  with a warning that names the header and never its value. For a run the message appears under the composer. For a
  preparation it is the usual "Preparation failed" message, and the run is not sent.
- The header exists for that request only. The inspector does not store, record, export, show or log it.
- A provider that returns a credential should look at `request.url` first. The page cannot tell which origin a credential
  belongs to, and a hosted page can be pointed at any HTTPS server when the deployment opted in.
- A browser sends a custom header only if the target allows it (`Access-Control-Allow-Headers`). The same is true of the
  typed token.

## `renderCustomEvent` and `renderActivity`

```ts
type Render<T> = (data: T, container: HTMLElement) => void | (() => void);

interface CustomEventData {
  readonly name: string;
  readonly value: JsonValue;
}

interface ActivityData {
  readonly messageId: string;
  readonly activityType: string;
  readonly content: JsonValue;
}
```

- `renderCustomEvent` is used for each `CUSTOM` event whose `name` is exactly the one given. `renderActivity` is used for
  each activity whose `activityType` is exactly the one given.
- `container` is an empty `<div>` in the conversation, inside the event's or activity's card. The card keeps its header, a
  reference to the frame, and a switch between the rendered view and the JSON.
- `data` is a copy. Changing it changes nothing the inspector shows or records.
- `render` runs again with the new data when an activity's content changes, and when the event is shown again. The
  inspector calls the cleanup that `render` returned, then empties the container, before each call and when the card goes
  away.
- Draw with the DOM. Text from the target is untrusted: use `textContent`. The page's policy forbids inline script and
  inline `style` attributes, so use `element.style.x = ...`, a class and a stylesheet from the same origin, or the page's
  `--agui-*` properties (`var(--agui-fg)`).
- `a2ui-surface` belongs to the A2UI view. A renderer registered for it is refused with a warning.
- When two plugins register the same name or type, the first wins. The second is refused with a warning.
- Throwing in `render` or in the cleanup shows the card's JSON view and gives one warning. Nothing else is affected.
- The frames list, the state view, the raw view and the exported session are not changed by a renderer.
- An imported recording is drawn with the same renderers.

## Warnings

Every failure is one warning in the area under the top bar, with the kind "Plugin":

```text
/plugins/example.js: beforeRun threw: <message, at most 200 characters>
```

The same text never shows twice. At most 20 warnings are kept. The message is the plugin's own, shown as text.

| Failure | Warning begins |
| --- | --- |
| Module did not load | `<address>: could not be loaded` |
| Module too slow | `<address>: did not load within 10 seconds` |
| Not a function | `<address>: the default export is not a function` |
| Activation threw or rejected | `<address>: activation failed: <message>` |
| Activation too slow | `<address>: activation did not finish within 10 seconds` |
| Registration after activation | `<address>: <function> was called after activation and was ignored` |
| Renderer already taken | `<address>: <function>(<name>) is already registered by <address>; ignored` |
| Reserved type | `<address>: renderActivity(a2ui-surface) is drawn by the A2UI view; ignored` |
| Hook failed | `<address>: beforeRun threw: <message>` |
| Hook result invalid | `<address>: beforeRun returned an invalid input: <reason>` |
| Provider failed | `<address>: provideHeaders threw: <message>` |
| Provider result invalid | `<address>: provideHeaders returned an invalid header "<name>": <reason>` |
| Renderer threw | `<address>: renderActivity(<type>) threw: <message>` |

## Versioning

`api.version` is an integer, 0 in 0.2.0. A change that can break an existing plugin raises it by one and ships with
migration steps in the changelog of `agui-inspector` and `agui-inspector-python`. A change that cannot break one, such as a
new member of the API object or a new optional field in what a function receives, keeps the number. A plugin that supports
only some versions checks `api.version` first and throws.
