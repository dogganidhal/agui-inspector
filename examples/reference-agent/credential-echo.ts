// Model-free target that repeats a credential back in its answer (D03 T064; FR-008, FR-036, SC-008).
// A real target can do this by accident, for example by logging the request it received. The
// inspector must keep those bytes exactly as received (evidence, constitution principle I) while
// never writing the credential it holds anywhere itself (principle IV). The credential is always
// synthetic. Erasable TypeScript only, so Node can run it directly.

/** The synthetic credential the end-to-end spec enters. It is not a real secret. */
export const ECHO_TOKEN = 'synthetic-echo-token-0001';

export const ECHO_MESSAGE_ID = 'msg-echo';

/** The headers that can carry the entered token, in the order the target looks at them. */
export const ECHO_HEADERS = ['x-api-key', 'authorization'] as const;

/** What the target sees: the first credential header present, or the word `none`. */
export function credentialOf(headers: Readonly<Record<string, string | string[] | undefined>>): string {
  for (const name of ECHO_HEADERS) {
    const value = headers[name];
    if (value !== undefined) return Array.isArray(value) ? (value[0] ?? 'none') : value;
  }
  return 'none';
}

/**
 * The data text of the frame that repeats the credential. Its spacing and key order are not what
 * `JSON.stringify` writes and it holds non-ASCII text, so a view that re-serializes or re-encodes it
 * no longer matches these bytes.
 */
export function echoData(credential: string): string {
  return `{"type" : "TEXT_MESSAGE_CONTENT", "messageId":"${ECHO_MESSAGE_ID}",  "delta":${JSON.stringify(`Écho reçu — credential: ${credential}`)}}`;
}

/** The whole envelope of that frame, delimiter included. Carriage returns are kept on purpose. */
export const echoFrame = (credential: string): string => `data: ${echoData(credential)}\r\n\r\n`;

const frame = (event: object): string => `data: ${JSON.stringify(event)}\n\n`;

/** The complete response body: a valid run whose one text message carries the echo frame. */
export function credentialEchoBody(threadId: string, runId: string, credential: string): string {
  return [
    frame({ type: 'RUN_STARTED', threadId, runId }),
    frame({ type: 'TEXT_MESSAGE_START', messageId: ECHO_MESSAGE_ID, role: 'assistant' }),
    echoFrame(credential),
    frame({ type: 'TEXT_MESSAGE_END', messageId: ECHO_MESSAGE_ID }),
    frame({ type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'success' } }),
  ].join('');
}
