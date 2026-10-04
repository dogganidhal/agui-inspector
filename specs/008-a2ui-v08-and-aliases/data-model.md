# Data model: A2UI v0.8 surfaces and catalog aliases

**Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

Nothing here is stored. These are the shapes the code passes around. All of them are framework-free except where
noted. Types that cross a module boundary go in `packages/inspector/src/contracts.ts`.

## Catalog table (`core/a2ui/catalogs.ts`, new)

| Name | Value |
| --- | --- |
| `BASIC_V09` | `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json` |
| `STANDARD_V08` | `https://a2ui.org/specification/v0_8/standard_catalog_definition.json` |
| `KNOWN` | `{ [BASIC_V09]: 'v0.9', [STANDARD_V08]: 'v0.8' }` |
| `BUILT_IN_ALIASES` | `{ 'https://a2ui.org/specification/v0_9/basic_catalog.json': BASIC_V09 }` |

```ts
export type A2uiVersion = 'v0.8' | 'v0.9';
/** Former id (or built-in alias) to a known catalog id. Own properties only. */
export type CatalogAliases = { readonly [id: string]: string };

/** Every id that stands for the known catalog of `version`: the known id, the built-in aliases and the configured ones. */
export function catalogIds(version: A2uiVersion, configured?: CatalogAliases): readonly string[];
/** True when `id` is one of `catalogIds(version, configured)`. */
export function resolves(version: A2uiVersion, id: string, configured?: CatalogAliases): boolean;
/** The aliases of `value` that the config may keep, and one warning per entry it drops. */
export function checkAliases(value: unknown): { readonly aliases?: CatalogAliases; readonly warnings: readonly string[] };
```

`checkAliases` is the whole of the alias rules (spec FR-013 to FR-016). `core/config` calls it and appends the warnings.
Validation rules, in order, per entry:

1. key empty: `catalogAliases: "" is not a catalog id; it was ignored`.
2. key in `KNOWN` or `BUILT_IN_ALIASES`: `... is already a built-in catalog id; it was ignored`.
3. value not a string: `... must map to a catalog id (a string); it was ignored`.
4. value not in `KNOWN`: `... maps to "<value>", which is not a catalog this inspector bundles (<the two ids>); it was ignored`.

The value of the field not being an object: `catalogAliases must be an object from a catalog id to a bundled catalog id; it was ignored`.
Names are quoted and cut at 48 characters, as theme warnings are.

## Config

`ConfigFile` and `ParsedConfig` gain one optional field. `startPage` returns it beside `theme`, and the app gives it to
the A2UI view.

```ts
interface ConfigFile {
  readonly version?: 0;
  readonly agents: readonly AgentConfig[];
  readonly theme?: ThemeConfig;
  readonly catalogAliases?: CatalogAliases;   // new, optional
}
```

`parseConfig` accepts `catalogAliases` as a top-level key (the `unexpectedKey` list gains it). The field is absent from
the parsed value when no entry survived.

## Operation entries (`core/a2ui/operations.ts`, new)

```ts
export interface Entry {
  readonly index: number;       // position in a2ui_operations
  readonly version: A2uiVersion;
  readonly operation: JsonValue; // as received
}

/** Splits a list by version (R2). Positions are the received ones. */
export function classify(operations: readonly JsonValue[]): { entries: readonly Entry[]; refused: readonly SurfaceIssue[] };
/** The surface id an entry names, if its shape names one. */
export function surfaceKey(entry: Entry): string | undefined; // `${version}:${surfaceId}`
```

`classify` refuses: a non-object, no version and no v0.8 name, and a version other than `v0.9`. It does no other
validation. v0.9 entries still reach the v0.9 processor, which says everything else.

## Session snapshot (`core/a2ui/index.ts`, extended)

The v0.9 fields do not change. New fields are in bold.

```ts
export interface SurfaceSnapshot<T extends ComponentApi> {
  readonly surfaces: readonly SurfaceModel<T>[];    // v0.9
  readonly issues: readonly SurfaceIssue[];
  readonly v08: V08Feed;                            // new
  readonly order: readonly string[];                // new: surfaceKey of every surface, first named first
}

export interface V08Feed {
  /** Grows by one on every rebuild, and on release. The pump clears its surfaces when it changes. */
  readonly epoch: number;
  /** The v0.8 messages that passed validation and the catalog check, in order, with their positions. */
  readonly messages: readonly { readonly index: number; readonly message: JsonValue }[];
}

export interface SurfaceSession<T extends ComponentApi> {
  apply(operations: JsonValue): void;
  snapshot(): SurfaceSnapshot<T>;
  subscribe(listener: () => void): Unsubscribe;
  /** The pump reports a message the v0.8 processor refused. Adds an issue at that position. */
  refused(index: number, operation: JsonValue, error: unknown): void;   // new
}

export interface SurfaceSessionOptions<T extends ComponentApi> {
  /** `aliasIds` is new: `catalogIds('v0.9', aliases)` without the basic id itself. */
  catalog(report: ReportBlocked, aliasIds: readonly string[]): Catalog<T> | readonly Catalog<T>[];
  onAction(action: A2uiAction): void;
  aliases?: CatalogAliases;                         // new: the config's
}
```

`SurfaceIssue` is unchanged. Its `operation` field carries the entry as received, so the existing "As received" block
shows v0.8 entries too.

State transitions of `apply(operations)` (the same for both versions, over the whole list):

| Condition | Effect |
| --- | --- |
| Not a list | Release everything, one issue showing the value |
| Same list as the last call, and a processor or feed exists | Nothing |
| The last list is a prefix of this one | Process only the new tail. Positions continue |
| Anything else | `epoch` + 1, release the v0.9 processor, clear issues and `order`, process the whole list |

For each entry: `classify` refuses, or, for v0.9, the processor takes `structuredClone(operation)` inside try/catch as
today. For v0.8: `A2uiMessageSchema.safeParse`, then the catalog check on `beginRendering`, then the entry joins
`v08.messages` (the pump clones it again when it feeds it, so the received list is never shared).

## View (`views/a2ui/`, React)

| Piece | Role |
| --- | --- |
| `v08.tsx` (new) | `V08Host`: `A2UIProvider` with the inspector's theme and `onAction`; the pump; registers replacement and stand-in components; reserves the renderer's style id; calls its `children(ids)` with the ids of the v0.8 surfaces that have a tree |
| `v08-theme.ts` (new) | The `Types.Theme` object: every component's class map set to `agui-a2ui-*` names |
| `parts.tsx` (new, moved out of `components.tsx`) | `TabsView` and `ModalView`, shared by the v0.9 and v0.8 components |
| `index.tsx` | `Rendered` draws `snapshot.order` as a list: a v0.9 surface from `snapshot.surfaces`, a v0.8 surface through `V08Host`. `Issues` is unchanged. `A2uiView` and `a2uiActivity` take `catalogAliases` |
| `catalog.tsx` | `createBundledCatalogs(report, aliasIds)`: the basic catalog plus one `Catalog` per alias id, instead of the hard-coded middleware id |
| `a2ui.css` | v0.8 rules under `.agui-a2ui-surface[data-version="v0.8"]` |

`A2uiViewProps` (contracts) gains `readonly catalogAliases?: CatalogAliases`.

## Reference agent (`examples/reference-agent/`)

| Export | Meaning |
| --- | --- |
| `STANDARD_V08_CATALOG_ID` | The v0.8 standard id, for the story and tests |
| `v08Surfaces` | The two-surface list of R10, with no `catalogId` on `expense` and the standard id on `status` |
| `v08Continuation(previous, action)` | The list after `submit_expense` (the data model update and the echo line) or after `withdraw_expense` (a `deleteSurface` and a status update) |
| `mixedSurfaces` | One v0.8 and one v0.9 surface, for the mixed-list tests |
| `SHOWCASE.v08` | `Review an expense report (v0.8)` |
| `ACTIONS.submitExpense`, `ACTIONS.withdrawExpense` | `submit_expense`, `withdraw_expense` |

## Embedded helper

`mount_inspector(..., catalog_aliases: dict[str, str] | None = None)`. When given, `config.json` holds
`"catalogAliases": <the dict>` as is, even when the dict is empty. When `None`, the field is absent.
