# Data model: Plugin API

Nothing here is stored or exported. The only persisted shape that changes is `config.json`, which gains one optional
field. The session, profile and hosting formats are unchanged. The names are the plan's. The types go into
`packages/inspector/src/contracts.ts` unless a row says otherwise.

## Configuration

| Name | Where | Shape | Rule |
| --- | --- | --- | --- |
| `plugins` (input) | `config.json` | list of strings | Optional. Each entry is read against the page's location and must resolve to the page's own origin (FR-002). |
| `ConfigFile.plugins` | `contracts.ts` | `readonly string[]` | After validation: the resolved absolute addresses, in the order written, without duplicates. Absent when none is valid. |
| `ParsedConfig.warnings` | `core/config` | `readonly string[]` | Existing. Gains the messages for a bad `plugins` value. |

Warning texts (the field and the position, never the value):

| Case | Text |
| --- | --- |
| Not a list | `plugins must be a list of module addresses on this page's origin; it was ignored` |
| Bad entry | `plugins[<i>] <reason>; it was ignored` |
| Repeated entry | `plugins[<i>] repeats an earlier entry; it was ignored` |

Reasons come from `pluginSource`: `must be a nonempty string`, `is not a valid URL`, `must be a path on this origin`,
`must not contain credentials (user:password@)`, `must not contain a backslash or a control character`.

## Plugin host (`core/plugins`)

| Member | Type | Meaning |
| --- | --- | --- |
| `load(addresses, importModule, page)` | `Promise<void>` | Requests every module, activates each in order, never rejects. |
| `beforeRun(run, signal)` | `Promise<Result<RunAgentInput>>` | Runs the registered hooks in order. |
| `headers(request, signal)` | `Promise<Result<Readonly<Record<string, string>>>>` | Merges the registered providers' answers. |
| `eventRenderer(name)` | `PluginRenderer \| undefined` | The renderer that claimed this custom event name. |
| `activityRenderer(type)` | `PluginRenderer \| undefined` | The renderer that claimed this activity type. |
| `report(plugin, extension, error)` | `void` | Adds a warning. Used by the host and by `PluginSlot`. |
| `warnings()` and `subscribe(listener)` | `readonly string[]` and `Unsubscribe` | What the page shows. A stable array until it changes. |
| `count()` | `number` | Plugins whose activation finished without error. |

`PluginRenderer` is `{ plugin: string; extension: 'renderCustomEvent' | 'renderActivity'; render: Render<…> }`: what the
registry holds, so `PluginSlot` can report a failure under the right name.

Internal state:

| Name | Shape | Rule |
| --- | --- | --- |
| hooks | list of `{ plugin, run }` | In registration order across plugins, and within a plugin in call order. |
| providers | list of `{ plugin, provide }` | Same. |
| event renderers | `Map<name, PluginRenderer>` | First claim wins. |
| activity renderers | `Map<type, PluginRenderer>` | First claim wins. `a2ui-surface` is never claimable. |
| warnings | `string[]` | No repeats. At most 20. |

### Plugin life cycle

```text
declared --import--> loaded --activate--> active
    |                   |                    |
    +-- warning --------+-- warning ---------+   (nothing it registered is kept when it fails)
```

A plugin that fails to load or to activate is dropped for the page's life. A plugin that is active stays active. Hooks,
providers and renderers that throw later do not change the state. They report and the host carries on.

Each activation has its own pending set (hooks, providers, renderers) and a flag `open`. The set is merged into the host
when the function returns without error, and discarded otherwise. The flag turns false when the activation ends, however it
ends. A registration call on a closed set reports a warning and does nothing.

## Plugin API (the contract, in `contracts.ts`)

```ts
export const PLUGIN_API_VERSION = 0;

export interface PluginApi {
  readonly version: number;
  beforeRun(hook: BeforeRunHook): void;
  provideHeaders(provider: HeaderProvider): void;
  renderCustomEvent(name: string, render: Render<CustomEventData>): void;
  renderActivity(type: string, render: Render<ActivityData>): void;
}
```

The members, the arguments and the rules are in [contracts/plugin-api.md](contracts/plugin-api.md).

## Run seam (`core/runtime`)

| Name | Shape | Meaning |
| --- | --- | --- |
| `RunPlugins` | `{ beforeRun, headers }` | What the runtime needs of the host. A constant `NO_PLUGINS` answers at once. |
| `RuntimeOptions.plugins` | `RunPlugins`, optional | Absent means `NO_PLUGINS`. |
| `TransportRequest.headers` | `Readonly<Record<string, string>>`, optional | Headers for this one request, validated and merged by the transport. The recorder is never given a `TransportRequest`. |
| `PreparationContext.headers` | `(request, signal) => Promise<Result<Readonly<Record<string, string>>>>`, optional | Called before each preparation is recorded. |

## Page seam (`app`)

| Name | Shape | Meaning |
| --- | --- | --- |
| `Started.plugins` | `PluginHost` | Always present. Empty when nothing was declared. |
| `StartupEnvironment.importModule` | `(address: string) => Promise<unknown>`, optional | Tests pass a stub. The page passes `import()`. |
| `AppExtras.pluginWarnings` | `readonly string[]` | Shown in the warnings area with the kind "Plugin". |
| `AppExtras.plugins` | `number` | The count for the footer. |
| `ConversationViewExtras.renderCustom` | `(entry: CustomEntry) => ReactNode`, optional | Twin of `renderActivity`. |

## Entities that do not change

The recorder, the store, `Exchange`, `Run`, `RawFrame`, `Finding`, `DerivedEntry`, the session file, the client profile and
`hosting-config.json` are not changed. A run's recorded input and the exchange's request body are the adjusted input,
because they are what was sent.
