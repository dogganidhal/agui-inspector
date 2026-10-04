# Validation guide: Protocol rule catalogue

**Status**: acceptance commands for the implementation. The planning pull request does not run them.

## Prerequisites

Node 24 or newer. `npm ci --ignore-scripts`. For the browser check, `npx playwright install chromium`. No model, no
account, no network beyond loopback.

## 1. The catalogue and its fixtures

```sh
npm run typecheck
npm run test:unit -- packages/inspector/tests/rules
```

Expect: every id matches the grammar and is unique. Fixtures and docs list exactly the catalogue ids. Every fixture
produces a finding with the id of its rule. Each sequence fixture is rejected by the real client with the message that
its pattern expects. Each compat shape is accepted by the real client, and `upgradeFrame` equals what the client
delivers.

## 2. Findings carry ids

```sh
npm run test:unit -- packages/inspector/tests/frames packages/inspector/tests/recorder packages/inspector/tests/runtime packages/inspector/tests/inspection
```

Expect: every finding in the existing tests has a rule. A frame can have several findings, and the first keeps its id.
The same streams give identical frames with and without the rule step. A `RUN_FINISHED` with `outcome: null` ends the
terminal check. A session exports with `rule` and imports back, and a 0.1.0 session imports unchanged.

## 3. Capability findings

```sh
npm run test:unit -- packages/inspector/tests/rules/capability.test.ts
```

Expect: the four capability rules fire on `false` and not on `true` or an omitted flag, inline and by capabilities URL.
A failed or unloaded URL gives no finding and no new error. The reference agent and the demo agents give none.

## 4. In a browser

```sh
npm run test:e2e -- tests/e2e/hosted/rules.spec.ts --workers=2
```

Expect: on the production page, an agent configured with `reasoning.supported: false` whose scripted stream emits a
reasoning event shows the finding in that frame's detail, with the rule id, in the warning styling. The exported session
has the same finding with its `rule`.

## 5. Docs

```sh
npm run test:unit -- packages/inspector/tests/runtime/docs.test.ts packages/inspector/tests/conversation/docs.test.ts packages/inspector/tests/foundation/policy.test.ts
```

Read `website/content/docs/rules.mdx` for the 39 rules, the naming scheme and the stability rule. "Read frames and
findings" lists the two new kinds and links to the rules page.

## Gate

```sh
npm run check:ci
```
