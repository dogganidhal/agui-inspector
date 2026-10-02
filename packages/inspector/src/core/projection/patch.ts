// JSON Patch (RFC 6902) for the projection: state deltas and activity patches. Framework-free.
//
// A patch applies to a copy and either succeeds as a whole or reports why it could not, so a bad
// delta never leaves a half-updated document: the caller keeps its last valid value and shows the
// error. Written here because `fast-json-patch`, which the protocol client uses, is a transitive
// dependency of it and not one this package declares; a small applier is cheaper than a new pin.
import type { JsonPatchOperation } from '@ag-ui/core';
import type { JsonValue } from '../../contracts.ts';

export type PatchResult = { readonly ok: true; readonly value: JsonValue } | { readonly ok: false; readonly error: string };

type Container = JsonValue[] | Record<string, JsonValue>;

const isRecord = (value: unknown): value is Record<string, JsonValue> => typeof value === 'object' && value !== null && !Array.isArray(value);

const deepEqual = (a: JsonValue, b: JsonValue): boolean => {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i] as JsonValue));
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key] as JsonValue, b[key] as JsonValue));
  }
  return false;
};

function tokens(pointer: unknown): string[] {
  if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/'))) throw new Error(`invalid pointer ${JSON.stringify(pointer)}`);
  return pointer === '' ? [] : pointer.slice(1).split('/').map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function index(token: string, length: number, allowEnd: boolean): number {
  if (allowEnd && token === '-') return length;
  if (!/^(0|[1-9]\d*)$/.test(token) || Number(token) > (allowEnd ? length : length - 1)) throw new Error(`index ${token} is out of range`);
  return Number(token);
}

// Defined, not assigned: a `__proto__` member is data and must not reach the prototype.
const setMember = (target: Record<string, JsonValue>, key: string, value: JsonValue) =>
  void Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });

/** The container that holds the last token of `path`, and that token. */
function parentOf(root: JsonValue, path: string[]): { parent: Container; key: string } {
  let current: JsonValue = root;
  for (const token of path.slice(0, -1)) {
    if (Array.isArray(current)) current = current[index(token, current.length, false)] as JsonValue;
    else if (isRecord(current) && Object.hasOwn(current, token)) current = current[token] as JsonValue;
    else throw new Error(`no value at ${token}`);
  }
  if (!Array.isArray(current) && !isRecord(current)) throw new Error('the parent is not an object or array');
  return { parent: current, key: path[path.length - 1] as string };
}

function read(root: JsonValue, path: string[]): JsonValue {
  if (path.length === 0) return root;
  const { parent, key } = parentOf(root, path);
  if (Array.isArray(parent)) return parent[index(key, parent.length, false)] as JsonValue;
  if (!Object.hasOwn(parent, key)) throw new Error(`no value at /${path.join('/')}`);
  return parent[key] as JsonValue;
}

function add(root: JsonValue, path: string[], value: JsonValue): JsonValue {
  if (path.length === 0) return value;
  const { parent, key } = parentOf(root, path);
  if (Array.isArray(parent)) parent.splice(index(key, parent.length, true), 0, value);
  else setMember(parent, key, value);
  return root;
}

// In place, so an object keeps the position of the member it replaces.
function replace(root: JsonValue, path: string[], value: JsonValue): JsonValue {
  if (path.length === 0) return value;
  const { parent, key } = parentOf(root, path);
  if (Array.isArray(parent)) parent[index(key, parent.length, false)] = value;
  else if (Object.hasOwn(parent, key)) setMember(parent, key, value);
  else throw new Error(`no value at /${path.join('/')}`);
  return root;
}

function remove(root: JsonValue, path: string[]): JsonValue {
  if (path.length === 0) throw new Error('the root cannot be removed');
  const { parent, key } = parentOf(root, path);
  if (Array.isArray(parent)) parent.splice(index(key, parent.length, false), 1);
  else if (Object.hasOwn(parent, key)) delete parent[key];
  else throw new Error(`no value at /${path.join('/')}`);
  return root;
}

const copyOf = (value: JsonValue): JsonValue => structuredClone(value);

/** Applies `patch` to a copy of `document`. The input is never changed. */
export function applyJsonPatch(document: JsonValue, patch: readonly JsonPatchOperation[]): PatchResult {
  let root = copyOf(document);
  for (const [position, operation] of patch.entries()) {
    try {
      const path = tokens(operation.path);
      switch (operation.op) {
        case 'add':
          root = add(root, path, copyOf(operation.value as JsonValue));
          break;
        case 'replace':
          root = replace(root, path, copyOf(operation.value as JsonValue));
          break;
        case 'remove':
          root = remove(root, path);
          break;
        case 'move': {
          const from = tokens(operation.from);
          if (path.length > from.length && from.every((token, i) => path[i] === token)) throw new Error('cannot move a value into itself');
          const value = read(root, from);
          root = add(remove(root, from), path, value);
          break;
        }
        case 'copy':
          root = add(root, path, copyOf(read(root, tokens(operation.from))));
          break;
        case 'test':
          if (!deepEqual(read(root, path), operation.value as JsonValue)) throw new Error(`value at ${operation.path} does not match`);
          break;
        default:
          throw new Error(`unknown operation ${JSON.stringify((operation as { op?: unknown }).op)}`);
      }
    } catch (error) {
      return { ok: false, error: `operation ${position + 1} (${String((operation as { op?: unknown }).op)}): ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return { ok: true, value: root };
}
