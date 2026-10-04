# Contract: Run waterfall

Module APIs are in [data-model.md](../data-model.md). This file fixes what a test or a docs page may rely on: the
markup of the view and the keyboard map.

## Placement

`InspectionView` shows a segmented control `Inspection view` with three options in this order: `Frames`, `Waterfall`,
`Raw request`. `Frames` stays the default. `InspectionView` takes one more optional prop, `threadId`, in
`InspectionViewExtras`, next to `reveal`. Without it the waterfall shows the thread of the latest conversation
exchange, as `ConversationView` and `StateView` do. `InspectionViewProps` in `contracts.ts` does not change.

## Markup

```text
section[data-view="waterfall"]                      the panel, with a visually plain heading "Waterfall"
  p.agui-wf-empty                                   when the thread has no run
  div[role="tree"][aria-label="Run waterfall"]
    div[role="treeitem"][data-row-id][data-kind][data-run="<exchangeId>"]
        [aria-level][aria-setsize][aria-posinset][aria-selected]
        [aria-expanded]            only when the row has children
        [tabindex="0" | "-1"]
        [data-open="true"]         only on an open row
        [aria-label="<kind>, <label>, ..."]
      span.agui-wf-chev            the disclosure arrow (aria-hidden), a click target for open and close
      span.agui-wf-name            kind word, label and the muted id
      span.agui-wf-track[aria-hidden]
        span.agui-wf-seg[data-part="args" | "wait" | "span"]   one or two bars, left and width in percent
      span.agui-wf-time            duration text, or "…" for an open row, then the tags
    div.agui-wf-axis[aria-hidden]                   after the run row of an expanded run: 0, ticks, end
  section[aria-label="Row details"]                 details of the selected row
    dl                                              kind, id, start, end, duration, frames, kind-specific facts
    button "frame #N"                               first and last frame; each shows that frame in the frames list
    p                                               "Times are when frames arrived. Derived, not received."
```

The row's `aria-label` reads: kind, label, `level N`, `started +s.mmm`, then `ended +s.mmm, D` for an ended row or
`running` or `no end seen` and `seen for D` for an open row, then tag texts, then `closed` or `open` for a row with
children. Example: `tool, get_weather, level 3, started +0.412, ended +1.230, 818 ms, waiting for result`.

Kind words in the row are `run`, `step`, `text`, `reasoning`, `tool`, `subagent`.

## Keyboard map

| Key (on a row) | Effect |
| --- | --- |
| Tab | Enters the tree at the row with `tabindex="0"`; one more Tab leaves it |
| ArrowDown | Focus and select the next visible row |
| ArrowUp | Focus and select the previous visible row |
| ArrowRight | On a closed row with children, open it. On an open row, focus its first child. On a leaf, nothing |
| ArrowLeft | On an open row, close it. Otherwise focus its parent. On a top-level closed run, nothing |
| Home | Focus and select the first visible row |
| End | Focus and select the last visible row |
| Enter | Show the row's first frame in the frames list (the Frames tab opens, the frame is marked `aria-current` and takes focus) |

Other keys, and every key while focus is in another control, do nothing here. The details area's buttons are ordinary
buttons in the Tab order after the tree.

## Pointer

A click on a row selects it and focuses it. A click on the disclosure arrow of a row with children opens or closes it
without selecting. The first-frame and last-frame buttons in the details do what Enter does for the first frame.
