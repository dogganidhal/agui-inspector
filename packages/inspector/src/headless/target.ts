// The rules for a target URL and a header (feature 005), shared by the command line and the headless sessions (feature
// 018). Pure. Each check returns the kind of problem and never the value, so no caller can echo a secret by accident.
import { validateHeaderValue } from 'node:http';

export type TargetProblem = 'form' | 'credentials' | 'query';
export type HeaderProblem = 'form' | 'reserved';

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// The sender sets these itself, so a header of the same name would fight it.
const SET_BY_SENDER = new Set(['host', 'content-length', 'transfer-encoding', 'connection']);

/** The URL of a valid target, or why it is not one. */
export function checkTarget(raw: string): { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly problem: TargetProblem } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: 'form' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, problem: 'form' };
  // A credential or a token in the URL would be written into config.json or a session file. A header is the way.
  if (url.username !== '' || url.password !== '') return { ok: false, problem: 'credentials' };
  if (raw.includes('?') || raw.includes('#')) return { ok: false, problem: 'query' };
  return { ok: true, url };
}

/** Why a header name and value cannot be sent, or undefined. */
export function checkHeader(name: string, value: string): HeaderProblem | undefined {
  if (!TOKEN.test(name) || value === '') return 'form';
  if (SET_BY_SENDER.has(name.toLowerCase())) return 'reserved';
  try {
    validateHeaderValue(name, value);
  } catch {
    return 'form';
  }
  return undefined;
}
