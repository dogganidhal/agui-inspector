// Byte helpers for binary frames (spec 013). Framework-free: btoa and atob only.
//
// A binary frame keeps its bytes as canonical base64 text, so one value works in the store, in JSON
// (copy and export) and in a view. Three layers use it: the reader writes it, the session files read it back
// to check it, and the frame detail shows it as hexadecimal text.

const CHUNK = 0x8000;

/** Standard base64 with padding and no line breaks. Chunked, because spreading a large array overflows the stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += CHUNK) binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return btoa(binary);
}

/** The bytes, or undefined unless `text` is canonical: decoding and encoding it again gives the same text. */
export function fromBase64(text: string): Uint8Array | undefined {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return undefined;
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  // Padding, whitespace and unused bits in the last group are all lenient in `atob`, and all change the text.
  return toBase64(bytes) === text ? bytes : undefined;
}

/** How many bytes a canonical base64 text holds, without decoding it. */
export function byteCountOf(base64: string): number {
  if (base64 === '') return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

export interface HexDump {
  /** Two lowercase hexadecimal digits per byte, one space between bytes, sixteen bytes a line. */
  readonly text: string;
  readonly shown: number;
  readonly total: number;
}

/** The first `limit` bytes as hexadecimal text. Only that start is decoded, so a large frame costs the same to show. */
export function hexDump(base64: string, limit: number): HexDump {
  const total = byteCountOf(base64);
  const shown = Math.min(total, limit);
  const chars = Math.ceil(shown / 3) * 4;
  const binary = atob(chars >= base64.length ? base64 : base64.slice(0, chars));
  const lines: string[] = [];
  for (let at = 0; at < shown; at += 16) {
    const row: string[] = [];
    for (let to = at; to < Math.min(at + 16, shown); to += 1) row.push(binary.charCodeAt(to).toString(16).padStart(2, '0'));
    lines.push(row.join(' '));
  }
  return { text: lines.join('\n'), shown, total };
}
