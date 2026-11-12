# Contract: inspection view props

```ts
interface InspectionViewProps {
  // ...existing members
  /** Empties the capture. Absent: no Clear session control. */
  onClearSession?(): void;
  /** Why the control is unavailable right now. Absent: available. */
  readonly clearBlocked?: string;
  /** What would be lost: called when the control is pressed. Undefined clears at once; counts ask first. */
  pendingExport?(): { readonly exchanges: number; readonly frames: number } | undefined;
}
```

UI:

- Button, accessible name "Clear session", in the header after Import session.
- Disabled with `clearBlocked` as its accessible description when that is set.
- With pending counts: a dialog titled "Clear this session" that names the counts, says clearing cannot be undone and that Export session keeps a copy, with Cancel and Clear session. Escape and Cancel keep everything.
