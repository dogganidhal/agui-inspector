# Quickstart: validate adopter branding

Run these from the repository root after implementation. Node 24 or newer and uv are needed.

## 1. Unit tests

```sh
npm ci --ignore-scripts
npm run test:unit -- packages/inspector/tests/config/brand
npm run test:unit -- packages/inspector/tests/hosted
npm run test:unit -- packages/inspector/tests/foundation
```

Expect: the reader tests for the default, every valid shape and every rejected value pass. The startup test shows no
extra request and the same policy text with and without a brand. The markup test shows the 0.1.0 markup with no
brand. The four-copy mark test still passes.

## 2. Python tests

```sh
npm run build
uv sync --project packages/python --locked --extra embedded --group test
uv run --project packages/python python -m unittest discover -s packages/python/tests
```

Expect: `Brand` reaches `config.json` as given, `logo_dark` as `logoDark`, and a mount with no brand serves the 0.1.0
bytes.

## 3. End to end

```sh
npx playwright install chromium
npm run test:e2e -- tests/e2e/branding --workers=2
npm run test:e2e -- tests/e2e/theme --workers=2
```

Expect: the same top bar in hosted, embedded, Python and generic static serving, in light and dark. Each rejected
value gives one warning and no request to another origin. The theme tests are unchanged.

## 4. By hand, embedded

```python
from agui_inspector import Agent, Brand, mount_inspector
mount_inspector(app, agents=[Agent(id="demo", url="/agent")], enabled=True,
                brand=Brand(name="Acme Console", logo="/static/acme.svg", logo_dark="/static/acme-dark.svg"))
```

Open `/agui-inspector/`. The top bar shows "Acme Console" and the logo. Press the theme switch and the dark logo
appears. Change `logo` to `https://example.com/x.png`: the default mark returns, a "Configuration" warning shows,
and the network panel shows no request to example.com.

## 5. The full gate

```sh
npm run check:ci
```
