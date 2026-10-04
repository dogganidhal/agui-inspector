// What a state change did: the paths that were added, removed or changed between two states. Framework-free.
//
// It compares values, not operations, so a move shows as a removal and an addition and a replace with an equal
// value shows as nothing. Object members compare by key, so their order does not matter. Arrays compare by
// position, as JSON Patch indexes them, so removing an early item shows the later items as changed. Paths are JSON
// Pointers (RFC 6901), the format the operations use.
import type { JsonValue } from '../../contracts.ts';

export type Difference =
  | { readonly kind: 'added'; readonly path: string; readonly after: JsonValue }
  | { readonly kind: 'removed'; readonly path: string; readonly before: JsonValue }
  | { readonly kind: 'changed'; readonly path: string; readonly before: JsonValue; readonly after: JsonValue };

// Past this depth a subtree is not walked. It compares as one value, with a stack of its own, so no depth can overflow the call stack.
const MAX_DEPTH = 100;

const isRecord = (value: JsonValue): value is { [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value);
const pointer = (path: string, token: string | number): string => `${path}/${String(token).replaceAll('~', '~0').replaceAll('/', '~1')}`;

/** Whether two values are equal, ignoring object key order, without recursion. Depth costs memory, never call stack. */
function same(before: JsonValue, after: JsonValue): boolean {
  const pairs: Array<[JsonValue, JsonValue]> = [[before, after]];
  for (let pair = pairs.pop(); pair !== undefined; pair = pairs.pop()) {
    const [a, b] = pair;
    if (a === b) continue;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      a.forEach((item, i) => pairs.push([item, b[i] as JsonValue]));
    } else if (isRecord(a) && isRecord(b)) {
      const keys = Object.keys(a);
      if (keys.length !== Object.keys(b).length || keys.some((key) => !Object.hasOwn(b, key))) return false;
      for (const key of keys) pairs.push([a[key] as JsonValue, b[key] as JsonValue]);
    } else return false;
  }
  return true;
}

function walk(before: JsonValue, after: JsonValue, path: string, depth: number, out: Difference[]): void {
  if (before === after) return;
  if (depth < MAX_DEPTH && Array.isArray(before) && Array.isArray(after)) {
    for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
      if (i >= after.length) out.push({ kind: 'removed', path: pointer(path, i), before: before[i] as JsonValue });
      else if (i >= before.length) out.push({ kind: 'added', path: pointer(path, i), after: after[i] as JsonValue });
      else walk(before[i] as JsonValue, after[i] as JsonValue, pointer(path, i), depth + 1, out);
    }
  } else if (depth < MAX_DEPTH && isRecord(before) && isRecord(after)) {
    for (const key of Object.keys(before)) {
      if (!Object.hasOwn(after, key)) out.push({ kind: 'removed', path: pointer(path, key), before: before[key] as JsonValue });
      else walk(before[key] as JsonValue, after[key] as JsonValue, pointer(path, key), depth + 1, out);
    }
    for (const key of Object.keys(after)) if (!Object.hasOwn(before, key)) out.push({ kind: 'added', path: pointer(path, key), after: after[key] as JsonValue });
  } else if (!same(before, after)) {
    out.push({ kind: 'changed', path, before, after });
  }
}

/** The net differences from `before` to `after`, in document order. Empty when the two states are equal. */
export function diffStates(before: JsonValue, after: JsonValue): Difference[] {
  const out: Difference[] = [];
  walk(before, after, '', 0, out);
  return out;
}
