// Which A2UI version an entry of `a2ui_operations` is (FR-001). The version is read from the entry itself:
// a v0.9 operation declares `"version": "v0.9"`, and a v0.8 message declares nothing and holds one of its
// four message names. Everything else is refused with its position, and the entry is never altered.
// Framework-free; the session applies what this module sorts.
import type { JsonValue } from '../../contracts';
import type { A2uiVersion } from './catalogs';
import type { SurfaceIssue } from './index';

/** One entry of the list, sorted by version. `operation` is the entry as received. */
export interface Entry {
  /** Position in the whole list, counting from 0. */
  readonly index: number;
  readonly version: A2uiVersion;
  readonly operation: JsonValue;
}

/** The message names of each version. `deleteSurface` is in both, so the `version` key decides. */
const KINDS: { readonly [version in A2uiVersion]: readonly string[] } = {
  'v0.8': ['beginRendering', 'surfaceUpdate', 'dataModelUpdate', 'deleteSurface'],
  'v0.9': ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'],
};

const isObject = (value: unknown): value is { readonly [key: string]: unknown } => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A declared version as text, cut short so a hostile one cannot flood the page. */
function declared(version: unknown): string {
  const text = typeof version === 'string' ? version : JSON.stringify(version);
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

/** Why an entry is neither v0.8 nor v0.9, or the version it is. */
function versionOf(operation: JsonValue): A2uiVersion | string {
  if (!isObject(operation)) return 'This operation is not an object.';
  const { version } = operation;
  if (version === 'v0.9') return 'v0.9';
  if (version !== undefined) return `This operation declares version ${declared(version)}. A2UI v0.9 operations declare "v0.9", and v0.8 messages have no version.`;
  if (KINDS['v0.8'].some((kind) => kind in operation)) return 'v0.8';
  return 'This operation has no version and no v0.8 message name. A2UI v0.9 operations declare "version": "v0.9".';
}

/**
 * Sorts a list by version. `offset` is the position of its first entry in the whole list, for a tail that
 * is applied after the entries before it. It checks nothing else: the v0.9 processor and the v0.8 schema
 * say what is wrong inside an entry.
 */
export function classify(operations: readonly JsonValue[], offset = 0): { readonly entries: readonly Entry[]; readonly refused: readonly SurfaceIssue[] } {
  const entries: Entry[] = [];
  const refused: SurfaceIssue[] = [];
  operations.forEach((operation, at) => {
    const index = offset + at;
    const found = versionOf(operation);
    if (found === 'v0.8' || found === 'v0.9') entries.push({ index, version: found, operation });
    else refused.push({ source: 'operation', message: found, index, operation });
  });
  return { entries, refused };
}

/** `<version>:<surface id>` for the surface an entry names, or undefined when its shape names none. */
export function surfaceKey({ version, operation }: Entry): string | undefined {
  if (!isObject(operation)) return undefined;
  for (const kind of KINDS[version]) {
    const payload = operation[kind];
    if (isObject(payload) && typeof payload['surfaceId'] === 'string') return `${version}:${payload['surfaceId']}`;
  }
  return undefined;
}
