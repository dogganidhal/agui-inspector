# Contract: `agui-inspector run`

```text
agui-inspector run --target <url> [--header "<Name>: <value>"]...
                   (--message <text> | --input <file> | --input -)
                   [--profile <file>] [--timeout <seconds>] [--out <file>] [--force]
```

| Option | Meaning |
| --- | --- |
| `--target` | One target, feature 005 rules. Exactly one. |
| `--header` | After `--target`, feature 005 rules. Values are never printed. |
| `--message` | Send this text as a user message. |
| `--input` | A run input as JSON text from a file, or `-` for standard input. Sent unchanged, valid or not. |
| `--profile` | A client profile file: automatic replies, their limit, encoding. |
| `--timeout` | Seconds before capture is stopped. Default 60. |
| `--out` | Write the session file here. Without it, the file goes to standard output. |
| `--force` | Replace an existing `--out` file. Without it the command refuses and writes nothing. |

Exactly one of `--message` and `--input` is required.

Output: one version-0 session file. Standard error gets one line per problem and, at the end, one summary line
(`<n> frames, <n> findings[, timed out]`). Standard output gets the file only, or nothing when `--out` is given.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | The run completed with no findings. |
| 1 | The run could not complete: the target was unreachable, answered non-2xx, redirected, or the time limit passed. The file holds what was recorded. |
| 2 | Wrong arguments. Nothing was sent or written. |
| 3 | The run completed with findings. |

Messages name options and target numbers, never a header value or anything the developer typed after `--header`.
