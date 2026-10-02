// The rules of the raw request editor, as plain functions. The entered text is the request: it is
// parsed only to judge it, never to rewrite it, and what is sent is the same string.
import { RunAgentInputSchema } from '@ag-ui/core/schemas';

export type RawAnalysis =
  /** Nothing to send yet. */
  | { readonly state: 'empty' }
  /** Not JSON. Blocks sending. */
  | { readonly state: 'syntax-error'; readonly message: string }
  /** JSON. `warnings` lists where it departs from a run input; they never block sending. */
  | { readonly state: 'ok'; readonly warnings: readonly string[] };

const MAX_WARNINGS = 5;
const MAX_MESSAGE = 200;

export function analyzeRawInput(text: string): RawAnalysis {
  if (text.trim() === '') return { state: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The text is not valid JSON';
    return { state: 'syntax-error', message: message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { state: 'ok', warnings: ['The document is not a JSON object, so it is not a run input.'] };
  }
  const result = RunAgentInputSchema.safeParse(parsed);
  if (result.success) return { state: 'ok', warnings: [] };
  const { issues } = result.error;
  const warnings = issues.slice(0, MAX_WARNINGS).map((issue) => `${issue.path.map(String).join('.') || 'document'}: ${issue.message}`);
  if (issues.length > MAX_WARNINGS) warnings.push(`and ${issues.length - MAX_WARNINGS} more`);
  return { state: 'ok', warnings };
}

/** Hands exactly `text` to `send`, or does nothing and returns false when the text is not JSON. */
export function sendRaw(text: string, send: (text: string) => void): boolean {
  if (analyzeRawInput(text).state !== 'ok') return false;
  send(text);
  return true;
}
