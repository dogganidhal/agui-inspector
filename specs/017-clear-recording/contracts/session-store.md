# Contract: `SessionStore.clear()`

```ts
interface SessionStore {
  // ...existing members
  /** Removes every exchange, frame, finding, run and derived entry. Subscribers are told once, like an append. */
  clear(): void;
}
```

- After `clear()`, `snapshot()` returns a new object with the same `id` and empty `exchanges`, `runs`, `frames`, `findings` and `derived`.
- Subscribers are notified through the same batched schedule as appends.
- Appends after `clear()` are checked exactly as on a new store; an id used before the clear is accepted again.
- `clear()` never throws and makes no request. Refusing a clear while a capture is in progress is the caller's job; the store does not know about transport.
