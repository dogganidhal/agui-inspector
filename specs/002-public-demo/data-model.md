# Data model: Public demo

No new session/profile saved format or backend database. Existing version-0 config/exports remain
authoritative; this adds a hosting field and transient demo state.

## HostingConfig / TransportPolicy

| Field | Type / default | Rule |
| --- | --- | --- |
| version | Existing optional literal 0 | Other versions fail visibly. |
| mode | Existing hosted / embedded | Required. |
| allowedOrigins | Existing normalized list / [] | Existing no wildcard/userinfo/path semantics; with visitor opt-in every entry must also satisfy its HTTPS/proven-loopback boundary. |
| config | Existing optional URL | Same guarded loading/default config.json. |
| allowVisitorTargets | Optional boolean / false | Deployer startup-only; any occurrence in embedded config rejected; wrong types/unknown keys fail. |

Out-of-bound fixed origins with opt-in fail startup; the guard also enforces the opt-in boundary
on manually constructed policy objects. Default-off origin semantics stay unchanged.
Policy's optional boolean means false when absent; old callers remain valid. Runtime/settings/
profiles never mutate it. Demo config-file override affects initial config resource only, not
policy. Parsed URL checks retain own/fixed origins and add opted-in HTTPS/exact proven loopback
HTTP. Test normalization/numeric aliases/ports/IPv6 brackets/suffix tricks/userinfo/scheme-relative
URLs; unsupported numeric sources fail visibly, no substring predicate or all-HTTP fallback.

## Shared ScenarioResponse

Pure input: parsed inert run input and explicit scenario selection.
Response descriptor: status, content type, ordered immutable Uint8Array chunks and ending
(close / hold-until-abort); reuse recorder fixture descriptor vocabulary where applicable.
Error response is bytes/status, never a successful stream. No headers/auth/I/O functions passed
to producers. Adapters own I/O/cancellation/CORS. Existing Node request logs/failure/open-stream
controls stay Node-only, never worker storage.

Protocol producer identifiers accept existing fixed defaults; default hashes unchanged.
Generate input-matched IDs at source, not by rewriting raw fixture/captured evidence.

## Example AgentConfig

Existing fields only: unique id, name, url, capabilities, preset. Preset uses existing variables,
forwardedProps, message mode, ordered preparations and string quickMessages; no auth/policy/SW
metadata or version bump.

| Agent | Endpoint below base | Demonstration |
| --- | --- | --- |
| Interactive | __demo__/agent/interactive | Plain default; interrupt/tools/slow/state/broken quick messages; ordered session/warm preparations. |
| A2UI | __demo__/agent/a2ui | Form plus normal action envelope and existing continuation. |
| Protocol baseline | __demo__/agent/protocol/baseline | Baseline producer with input IDs. |
| Protocol run error | __demo__/agent/protocol/run-error | Existing error producer; completes all-31 coverage. |

Build prefixes only these source URL/preparation references with the deployment origin and base (absolute URLs), preserving
literal threadId/runId template variables; ordinary config/user URLs never rebased.

## DemoReadiness

Preparing -> ready or unavailable; reload starts a new setup attempt.
Ready requires matching script/scope/controller/version within 10 seconds. Unsupported/insecure/
registration failure/timeout/mismatch supplies an accessible visible reason. Controller changes
never replay a POST. Status outside app root uses native accessible elements; no UI redesign.

Mount once per initialization, after the bounded setup attempt. Unavailable mount has no example agents
using an absent optional config; own-server/import remain usable. No remount, auto-reload or stored readiness.
Reload guidance warns visitors to export a current recording first.

## Artifact relationship

Shared app is the base; demo adds DOM bootstrap/worker/HTML/config in a distinct output.
Worker scope equals page directory and route matching also checks exact origin/reserved paths.
Readiness handshake may carry type/version/ready only, never session/auth/body/target metadata.
