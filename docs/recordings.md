# Session recordings

`agui-inspector` is a working name. This page describes the session file: what export writes,
what import accepts, and what to be careful about before sharing one. The code is in
`packages/inspector/src/core/session-files`.

## Read this before you share a file

A recording holds the request bodies you sent and every frame the server returned, exactly as
received. Either can contain personal data, business data or secrets, for example a tool result
with a customer record, or a server that repeats a credential back in its answer. The inspector
does not edit, mask or filter received bytes, so the file contains whatever crossed the wire.

- The export dialog warns about this each time and only then writes the file.
- Treat the file like the traffic it came from. Check it before you attach it to a ticket, a chat
  or a public issue, and prefer synthetic data when you can reproduce a problem with it.
- If you find a secret in a recording, rotate the secret. Deleting the file does not recall copies.
- Sessions live in the browser's memory only. The inspector never stores them on a server. A file exists only because you exported it.

## A token you entered and a server that repeats it

A credential can end up near a recording in two ways. The inspector treats them differently
(constitution 1.0.3, principle IV).

- **A credential the inspector holds.** The token you enter lives in memory only. The inspector never
  writes it into configuration, browser storage, a request recording, an inspection view, a log or an
  export. The recorder does not read headers, and the file has no header fields, so there is nowhere for
  the token to be copied from.
- **Bytes the target sent.** A server can repeat your token in its answer, for example by logging the
  request it received. Those bytes are the evidence of what the server did. The inspector keeps them
  exactly as received, in capture and in the export, even when they contain the token you entered. It
  does not redact, mask or hash them, and it does not check the file for your token.

So an exported file can contain your token if, and only if, the server sent it back. The export dialog
warns about that each time. If you find a token in a file, rotate it before you share the file.

`tests/e2e/inspection/credential-echo.spec.ts` covers both. A scripted target
(`examples/reference-agent/credential-echo.ts`) repeats a synthetic token in one frame with unusual
spacing, non-ASCII text and `\r\n` delimiters. The test checks that the frame is identical on the
clipboard and in the exported file, and that the warning appears before the download. It also checks
that the token is absent from the configuration, the exported profile, browser storage, all requests
except the chosen header on the one request to the target, the exchanges and runs in the file, and
every field name that could hold a header.

## What a file contains

A file is one JSON object with a version and a session:

```json
{ "version": 0, "session": { "id": "…", "exchanges": [], "runs": [], "frames": [], "findings": [], "derived": [] } }
```

| Collection | Holds |
| --- | --- |
| `exchanges` | Every preparation request, conversation run and raw submission, in capture order: method, path, the exact request body text, the response status, any non-stream response body, wall-clock start, elapsed time, how the transport ended, and the ids of its frames. |
| `runs` | Each run's thread, run and parent ids, the input as sent, its start and end time and the outcome the stream showed. |
| `frames` | Every received frame in arrival order: the original envelope text including delimiters, the extracted data text, the offset in milliseconds from the request's start, the event type when identifiable, the summary, the JSON and schema verdicts and the parsed value. Control and partial evidence is included, marked as such. |
| `findings` | Additive judgements that point at a frame, a run or an exchange. They never replace the evidence they describe. |
| `derived` | Client-derived entries such as chunk expansions, each listing the frames it came from. They are marked `derived` and carry no frame index. |

Order is part of the format. Records are written in the order the store holds them, and a second
export of an imported file gives back the same bytes.

## What a file never contains

- Request or response headers. No record has a field for them.
- The authentication header name or token, the target URL of the connection, the abort controller
  or any other live connection state. This is about what the inspector holds: a token repeated inside
  a received frame is the target's evidence and stays as sent (see above).
- Anything executable. Import displays a recording; it never sends one of its requests, runs a
  preparation or starts a run, and it makes no network request of its own.

Export writes an explicit list of fields for every record rather than serializing whatever object
is in memory, so a stray field on an in-memory object cannot reach the file. The end-to-end tests
send a synthetic token to a scripted agent and check that the exported file has no field named after a
header, cookie, token or credential, and that the token appears in the file only inside frames the
agent chose to echo.

## What import checks

The whole file is checked in memory before anything is shown. A file that fails any check is
refused with a visible error naming the first problem, and the session you were looking at stays
exactly as it was.

- The text is valid JSON, an object with exactly `version` and `session`, and the version is the
  number `0`. A missing version, a string, or another number is refused.
- Every record has exactly its documented fields. An unknown field is refused. A field whose name
  suggests a header, cookie, token or credential gets a more specific message. Words inside a
  payload (a tool argument called `headers`, say) are evidence and are not checked.
- Ids are unique within each collection.
- Every reference resolves: a frame names an exchange in the file, a run names its exchange, a
  finding points at a frame, run or exchange that exists, a derived entry's sources are frames in
  the file and an `identified` entry names at least one.
- Each exchange lists its own frames, all of them, in arrival order. Frame `index` values count up
  from zero within the exchange and `offsetMs` never goes backwards.
- Times are finite numbers of zero or more, and a run does not end before it starts.
- A frame agrees with itself: its JSON verdict matches whether the data text parses, `parsed`
  equals the data text, and control or partial evidence has no data and no verdicts.
- A run's input is a run input, an interrupt outcome holds interrupts, and a path holds no URL
  credentials.

Exchange start times are wall-clock values and are not required to increase, because a clock can
be adjusted during a session.

An opened recording is inspect-only. Filters, raw expansion and copying work as for a live capture.

## Pre-stable format and migration

The format is version 0 and pre-stable. Version 1, with published JSON Schemas, is a 1.0.0
obligation and is not promised here. Until then:

- An incompatible change to the version 0 format is possible in any release before 1.0.0. It is
  announced in the changelog with migration steps, and the version number stays 0.
- A file written by one release may therefore be refused by another. The error says which part of
  the file the importer rejected.
- A file with any other version number is refused. This build does not guess at newer or older
  formats.
- There is no changelog yet because there is no release. When the first one exists, format changes
  go there.

## Raw submissions in a recording

A request sent from the raw request editor is an exchange of kind `raw`. Its `requestBody` is the
text as entered, with whitespace and key order intact, apart from one platform rule: a text area
reports line breaks as a line feed, so a carriage return typed or pasted into the editor is sent
as a line feed. The server's answer is recorded like any other, including error responses. No run
is created for it.
