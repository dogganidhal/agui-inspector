# Contract: operations of an `a2ui-surface` activity

**Spec**: FR-001 to FR-010 | **Data model**: [data-model.md](../data-model.md)

## Which version an entry is

| Entry | Version | Where a problem is reported |
| --- | --- | --- |
| Object with `"version": "v0.9"` | v0.9 | The v0.9 processor, as in 0.1.0 |
| Object with no `version` and at least one of `beginRendering`, `surfaceUpdate`, `dataModelUpdate`, `deleteSurface` | v0.8 | The v0.8 schema and the catalog check, then the renderer |
| Anything else | none | `classify` |

Refusals by `classify`, each at the entry's position, with the entry under "As received". Exact text:

| Entry | Message |
| --- | --- |
| Not an object | `This operation is not an object.` (unchanged) |
| Object, no `version`, no v0.8 name | `This operation has no version and no v0.8 message name. A2UI v0.9 operations declare "version": "v0.9".` |
| `version` present and not `"v0.9"` | `This operation declares version <value>. A2UI v0.9 operations declare "v0.9", and v0.8 messages have no version.` |

The two messages that said "Only A2UI v0.9 is supported" are gone.

A v0.8 refusal reads `<path>: <message>` for the first three problems of the strict v0.8 schema, joined by `; `. A
message with two kinds reads `A2UI Protocol message must have exactly one of: surfaceUpdate, dataModelUpdate,
beginRendering, deleteSurface.`
A v0.8 catalog refusal reads `Catalog not found: <id>`. A message the v0.8 processor throws on reads as the processor
words it (`Circular dependency for component "x".`, `Invalid data; expected Text`).

## Surfaces

- A surface is identified by version and id. A v0.8 and a v0.9 surface that share an id are two surfaces.
- Surfaces are drawn in the order the list first names them, whatever their version.
- A v0.8 surface is drawn once a `beginRendering` has named its root and the tree builds. Before that nothing is
  drawn and nothing is reported.
- v0.8 `deleteSurface` (no `version`) removes the v0.8 surface. v0.9 `deleteSurface` removes the v0.9 one.
- Each surface block carries `data-surface="<id>"` and a new `data-version="v0.8"` or `"v0.9"`.

## Application

Unchanged list: nothing. List that grew at the end: only the new entries, typed values kept. Any other change: both
versions rebuild, typed values are lost. Entries are cloned before a renderer sees them, so the JSON view, the frames,
the export and the projection show what was received.

## Action

| Field | v0.8 source | v0.9 source |
| --- | --- | --- |
| `name` | `action.name` | `action.event.name` |
| `surfaceId` | the surface | the surface |
| `sourceComponentId` | the component | the component |
| `context` | `action.context` list, resolved at the click, `Map` values as objects, copied | `action.event.context`, resolved, copied |
| `timestamp` | set by the renderer | set by the renderer |

The envelope goes through `runtime.sendA2uiAction`, which puts it in `forwardedProps.a2uiAction.userAction`. It is never
a tool reply.

## Guards

Same as v0.9. `Image`, `Video` and `AudioPlayer` draw `Blocked <Kind>: <address>` and load nothing. `Text` is plain
text: link and image syntax stay as typed. No icon font, no catalog, no stylesheet and no font is fetched. v0.8 has no
`openUrl`. The page's content security policy is unchanged.

## Unknown component type

`Unknown component type: <type>. The catalog has no such component, so nothing is drawn for it.` with the definition as
received under "As received", in place of the component. The rest of the surface draws.
