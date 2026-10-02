// The public demo's page start (P03, FR-005, FR-009, FR-012, FR-015, FR-016). It prepares the
// browser-local examples, then mounts the one shared inspector app, exactly once:
//
//   1. register the sibling worker (scope: this directory) and wait, for at most 10 seconds in all,
//      for the page to be controlled by that worker's script and for it to say it is ready
//   2. mount the shared app with the examples' configuration when it is, or with none when it is not
//
// Examples are enabled only by that configuration, so nothing can send an example request before the
// worker answers for it. When the worker is unavailable the same app mounts with no example agents:
// a visitor can still type their own server's URL or open a recording. No fake transport, no reload,
// no remount, no replay of a request. Nothing is stored. The status text sits outside the app's root.
//
// The shared app is an external import of the demo build's own `app.js`, never bundled again here.
import { mountApp } from '../packages/inspector/src/app/index.tsx';

/** What the page asks and what the worker answers, mirroring demo/service-worker.ts. Nothing else crosses. */
const HELLO = 'agui-demo-hello';
const READY_TYPE = 'agui-demo-ready';
const READY_VERSION = 1;

const WORKER = './service-worker.js';
/** Beside the page, named for what it is: the build writes no `config.json`, so the fallback start is the empty one. */
const EXAMPLES_CONFIG = 'examples.json';
/** The whole setup attempt, registration included. */
const WAIT_MS = 10_000;

type Outcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const unavailable = (reason: string): Outcome => ({ ok: false, reason });

/** Registers the worker and resolves once this page is controlled by it and it has answered, or says why not. */
function prepareExamples(): Promise<Outcome> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(unavailable('this browser does not support service workers.'));
  if (!window.isSecureContext) return Promise.resolve(unavailable('service workers need a secure page (HTTPS or localhost).'));

  const container = navigator.serviceWorker;
  const script = new URL(WORKER, location.href).href;
  const scope = new URL('./', location.href).href;

  return new Promise((resolve) => {
    // Workers that have said they are ready, and controllers that have been asked: each controller is greeted once.
    const ready = new WeakSet<ServiceWorker>();
    const asked = new WeakSet<ServiceWorker>();
    let wrongVersion = false;

    const finish = (outcome: Outcome) => {
      clearTimeout(timer);
      container.removeEventListener('message', onMessage);
      container.removeEventListener('controllerchange', check);
      resolve(outcome);
    };
    const timer = setTimeout(
      () =>
        finish(
          unavailable(
            wrongVersion
              ? 'an older version of the example worker is still in control.'
              : container.controller === null
                ? 'the example worker did not take control of this page within 10 seconds.'
                : container.controller.scriptURL !== script
                  ? 'a different worker is in control of this page.'
                  : 'the example worker did not answer within 10 seconds.',
          ),
        ),
      WAIT_MS,
    );

    // Control and readiness arrive in either order, so both are checked on every event.
    function check() {
      const controller = container.controller;
      if (controller === null || controller.scriptURL !== script) return;
      if (ready.has(controller)) return finish({ ok: true });
      if (!asked.has(controller)) {
        asked.add(controller);
        controller.postMessage({ type: HELLO });
      }
    }
    function onMessage(event: MessageEvent) {
      const { source, data } = event;
      if (!(source instanceof ServiceWorker) || source.scriptURL !== script) return;
      const message = data as { type?: unknown; version?: unknown; ready?: unknown } | null;
      if (message?.type !== READY_TYPE) return;
      if (message.version !== READY_VERSION || message.ready !== true) wrongVersion = true;
      else ready.add(source);
      check();
    }

    // Before registering, so neither the worker's first message nor the control it claims is missed.
    container.addEventListener('message', onMessage);
    container.addEventListener('controllerchange', check);
    container.register(WORKER, { scope: './', updateViaCache: 'none' }).then(
      (registration) => {
        if (registration.scope !== scope) return finish(unavailable('the example worker has an unexpected scope.'));
        check();
      },
      (error: unknown) => finish(unavailable(`the example worker could not be registered (${error instanceof Error ? error.name : 'error'}).`)),
    );
  });
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    // Blocked storage only means the profile is not remembered.
    return undefined;
  }
}

const status = document.getElementById('demo-status');
const show = (text: string) => {
  if (status !== null) status.textContent = text;
};

async function start(): Promise<void> {
  const outcome = await prepareExamples();
  show(
    outcome.ok
      ? 'Browser-local examples are ready: choose an example agent in Settings, then send one of its quick messages.'
      : `Browser-local examples are unavailable: ${outcome.reason} You can still inspect your own server or open a recording. To try again, reload the page; export any recording you need first.`,
  );
  if (outcome.ok) {
    // A controller that changes after the page was ready never causes a reload or a repeated request.
    navigator.serviceWorker.addEventListener('controllerchange', () =>
      show('The example worker was replaced, so the examples may stop answering. Export any recording you need, then reload the page.'),
    );
  }

  const container = document.getElementById('demo-mount');
  if (container === null) return;
  // The shell's styles and theme tokens are scoped to #root. The page has none while the app module
  // loads, so its own auto-mount never fires; the mount point takes the id only now, for the one mount.
  container.id = 'root';
  const storage = browserStorage();
  await mountApp(container, {
    document,
    origin: location.origin,
    baseUrl: document.baseURI,
    fetch: globalThis.fetch.bind(globalThis),
    ...(storage !== undefined && { storage }),
    ...(outcome.ok && { configFile: EXAMPLES_CONFIG }),
  });
}

void start();
