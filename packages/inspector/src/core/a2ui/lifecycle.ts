// What an `a2ui-surface` activity carries before it has anything to paint (FR-020). The AG-UI A2UI
// middleware (0.0.11) puts it on the activity content next to, never inside, `a2ui_operations`: `{ status: "building" }`
// (optionally with `progressTokens`), `{ status: "retrying", attempt, maxAttempts, errors }` and
// `{ status: "failed", error, attempts, maxAttempts }`, each stamped with the server's `debugExposure`.
// The painted surface replaces it under the same message id. Framework-free; nothing here alters the content.
import type { JsonValue } from '../../contracts';

export type LifecycleStatus = 'building' | 'retrying' | 'failed';

export interface Lifecycle {
  readonly status: LifecycleStatus;
  /** Why generation failed, as the middleware worded it. */
  readonly error?: string;
  /** The attempt in progress (`retrying`) or the number made (`failed`). */
  readonly attempt?: number;
  readonly maxAttempts?: number;
  /** A throttled estimate of the streamed spec's size. */
  readonly progressTokens?: number;
  /** One line per validation error, `path: message`, prefixed by the attempt that raised it when there are several. */
  readonly details: readonly string[];
  /** The server's choice of how much of `details` to show. The client default is `collapsed`. */
  readonly debugExposure: 'hidden' | 'collapsed' | 'verbose';
}

const isObject = (value: unknown): value is { readonly [key: string]: unknown } => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined);

/** `path: message` for one validation error; a bare string is its own line. */
function line(error: unknown): string | undefined {
  if (typeof error === 'string') return error;
  if (!isObject(error) || typeof error['message'] !== 'string') return undefined;
  return typeof error['path'] === 'string' ? `${error['path']}: ${error['message']}` : error['message'];
}

const lines = (errors: unknown): string[] => (Array.isArray(errors) ? errors.map(line).filter((entry): entry is string => entry !== undefined) : []);

/** The lifecycle an activity's content declares, or undefined when it declares none this view knows. */
export function readLifecycle(content: JsonValue): Lifecycle | undefined {
  if (!isObject(content)) return undefined;
  const { status } = content;
  if (status !== 'building' && status !== 'retrying' && status !== 'failed') return undefined;
  const { attempts } = content;
  const perAttempt = Array.isArray(attempts) ? attempts.flatMap((entry) => (isObject(entry) ? lines(entry['errors']).map((message) => `Attempt ${String(entry['attempt'] ?? '?')} · ${message}`) : [])) : [];
  const debug = content['debugExposure'];
  return {
    status,
    ...(typeof content['error'] === 'string' && { error: content['error'] }),
    ...(status !== 'building' && { attempt: count(content['attempt']) ?? (Array.isArray(attempts) ? attempts.length : count(attempts)) }),
    ...(count(content['maxAttempts']) !== undefined && { maxAttempts: count(content['maxAttempts']) }),
    ...(count(content['progressTokens']) !== undefined && { progressTokens: count(content['progressTokens']) }),
    details: [...lines(content['errors']), ...perAttempt],
    debugExposure: debug === 'hidden' || debug === 'verbose' ? debug : 'collapsed',
  };
}
