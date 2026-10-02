// L07 T049/T051 (unit side): the app shell renders every fixed view entry, the footer states the
// privacy facts of the current mode with the counts of the session on screen, and the shell shows
// no token and requests nothing by itself. Interaction and the browser's enforcement are in
// tests/e2e/hosted/app.spec.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppProps } from '../../src/contracts.ts';
import { App, type AppExtras } from '../../src/app/index.tsx';
import { defaultProfile } from '../../src/core/profiles/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';

const SYNTHETIC_TOKEN = 'synthetic-token-7f3a91';

function build(patch: Partial<AppExtras> = {}, exchanges = 0) {
  const store = createSessionStore({ schedule: (callback) => callback() });
  for (let index = 0; index < exchanges; index += 1) {
    store.appendExchange({ id: `exchange-${index}`, kind: 'raw', method: 'POST', path: '/agent', startedAt: 1, transport: 'completed', frameIds: [] });
  }
  const calls: string[] = [];
  const spy = (name: string) => () => void calls.push(name);
  const props: AppProps & AppExtras = {
    settings: {
      agents: [{ id: 'support', name: 'Support assistant', url: '/agents/support/stream' }],
      selectedAgentId: 'support',
      profile: defaultProfile(),
      variables: {},
      onSelectAgent: spy('onSelectAgent'),
      onChangeProfile: spy('onChangeProfile'),
      onChangeVariable: spy('onChangeVariable'),
      onImportProfile: spy('onImportProfile'),
      onExportProfile: spy('onExportProfile'),
    },
    connection: {
      connection: { agentId: 'support', targetUrl: '/agents/support/stream', auth: { headerName: 'Authorization', token: SYNTHETIC_TOKEN } },
      running: false,
      quickMessages: ['Where is my refund?'],
      onChangeTarget: spy('onChangeTarget'),
      onChangeAuth: spy('onChangeAuth'),
      onSend: spy('onSend'),
      onStop: spy('onStop'),
      onNewThread: spy('onNewThread'),
    },
    conversation: {
      store,
      interrupts: [],
      toolResults: [],
      onDraftInterrupt: spy('onDraftInterrupt'),
      onAnswerInterrupt: spy('onAnswerInterrupt'),
      onDraftToolResult: spy('onDraftToolResult'),
      onSubmitToolResult: spy('onSubmitToolResult'),
      onContinue: spy('onContinue'),
    },
    inspection: { store, onSendRaw: spy('onSendRaw'), onExportSession: spy('onExportSession'), onImportSession: spy('onImportSession') },
    ...patch,
  };
  return { markup: renderToStaticMarkup(<App {...props} />), calls };
}

test('the shell has one h1, the four fixed views, the composer and the footer, and calls nothing while rendering', () => {
  const { markup, calls } = build({ mode: 'embedded' });
  assert.equal(markup.match(/<h1>/g)?.length, 1);
  for (const view of ['settings', 'conversation', 'inspection', 'connection', 'footer']) {
    assert.match(markup, new RegExp(`data-view="${view}"`), view);
  }
  assert.match(markup, /class="agui-app" data-pane="conversation" data-mode="embedded"/);
  assert.deepEqual(calls, []);
});

test('the layout is two panes under a top bar, with a pane switch and the inspection tabs', () => {
  const { markup } = build({ mode: 'hosted' });
  assert.ok(markup.indexOf('agui-app-bar') < markup.indexOf('agui-app-switch') && markup.indexOf('agui-app-switch') < markup.indexOf('agui-app-panes'));
  assert.ok(markup.indexOf('agui-app-conversation') < markup.indexOf('agui-app-inspection'), 'conversation left, inspection right');
  assert.match(markup, /role="group" aria-label="Pane"/);
  assert.match(markup, /role="group" aria-label="Inspection pane"/);
  for (const label of ['Conversation', 'Inspection', 'State', 'Settings']) assert.match(markup, new RegExp(`aria-pressed="(?:true|false)"[^>]*>${label}<`), label);
  assert.match(markup, /<footer class="agui-app-footer"[^>]*>(?:(?!<\/footer>).)*<\/footer>\s*<\/div><\/div><\/div>$/s, 'the footer closes the inspection pane');
});

test('the footer names the counts and the privacy facts of the mode', () => {
  const embedded = build({ mode: 'embedded' }, 1).markup;
  assert.match(embedded, /1 exchange · 0 frames · requests only to this origin · no telemetry · headers never recorded/);

  const hosted = build({ mode: 'hosted', allowedOrigins: ['https://agent.example', 'http://127.0.0.1:8787'] }, 3).markup;
  assert.match(hosted, /3 exchanges · 0 frames · requests only to this origin and https:\/\/agent\.example, http:\/\/127\.0\.0\.1:8787 · no telemetry · headers never recorded/);

  assert.match(build({ mode: 'hosted', allowedOrigins: [] }).markup, /requests only to this origin ·/);
  assert.match(build({ mode: 'hosted', allowedOrigins: [], allowVisitorTargets: false }).markup, /requests only to this origin ·/);
  assert.match(build({ recording: true }).markup, /imported recording, inspection only/);
});

test('an open recording is announced and the composer says why it cannot send', () => {
  const { markup } = build({ recording: true, notice: 'An imported recording is open for inspection. Reload the page to send requests again.' });
  assert.match(markup, /Imported recording: inspection only\. Reload the page to send requests again\./);
  assert.match(markup, /<p class="agui-conn-notice" role="status">An imported recording is open/);
  assert.doesNotMatch(build().markup, /Imported recording/);
});

test('every control has an accessible name, and outside its own password field the token is never rendered', () => {
  const { markup } = build({ mode: 'hosted' });
  for (const [tag] of markup.matchAll(/<button\b[^>]*>(?:(?!<\/button>).)*<\/button>/gs)) {
    const named = /aria-label="[^"]+"/.test(tag) || />[^<>]*[A-Za-z][^<>]*</.test(tag.replace(/<svg.*?<\/svg>/gs, ''));
    assert.ok(named, `unnamed button: ${tag.slice(0, 120)}`);
  }
  for (const [tag] of markup.matchAll(/<(?:input|textarea)\b[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    const labelled = /aria-label="[^"]+"/.test(tag) || (id !== undefined && markup.includes(`for="${id}"`));
    assert.ok(labelled || /type="(?:file|hidden)"/.test(tag), `unlabelled field: ${tag}`);
  }
  // The authentication popover's password field holds what the user typed; nothing else may show it.
  assert.ok(!markup.replace(/<input\b[^>]*type="password"[^>]*>/g, '').includes(SYNTHETIC_TOKEN), 'the token is never rendered');
  assert.match(markup, /Authentication: Authorization set/);
});

test('the markup requests nothing and carries no inline script, handler or remote reference', () => {
  const { markup } = build({ mode: 'hosted', allowedOrigins: ['https://agent.example'] });
  assert.doesNotMatch(markup, /<script|<iframe|<img|<link|\son[a-z]+=|srcset|src="|href="https?:/i);
});

// P01 T004 (US2.4, FR-009): the footer follows the policy and only the policy.

test('with the visitor-target option the footer names HTTPS targets and supported local servers, not "only this origin"', () => {
  const { markup } = build({ mode: 'hosted', allowedOrigins: [], allowVisitorTargets: true }, 2);
  assert.match(
    markup,
    /2 exchanges · 0 frames · requests to this origin, HTTPS targets and supported local servers \(use localhost; browser CORS and local-network rules apply\) · no telemetry · headers never recorded/,
  );
  assert.doesNotMatch(markup, /requests only to/);
  // No URL, query or token can reach the footer through the policy: it states a scope, not addresses.
  assert.doesNotMatch(markup.slice(markup.indexOf('<footer')), /https?:\/\/|\?|synthetic-token/);
});

test('fixed origins are not listed when the option is on (they are inside it), and the default footer keeps naming them', () => {
  const on = build({ mode: 'hosted', allowedOrigins: ['https://agent.example'], allowVisitorTargets: true }).markup;
  assert.match(on, /requests to this origin, HTTPS targets and supported local servers/);
  assert.ok(!on.slice(on.indexOf('<footer')).includes('agent.example'));
  assert.match(build({ mode: 'hosted', allowedOrigins: ['https://agent.example'] }).markup, /requests only to this origin and https:\/\/agent\.example ·/);
});

test('the option is stated only for a hosted page: embedded and unknown modes keep the own-origin footer', () => {
  for (const mode of ['embedded', undefined] as const) {
    const markup = build({ ...(mode !== undefined && { mode }), allowVisitorTargets: true }).markup;
    assert.match(markup, /requests only to this origin · no telemetry · headers never recorded/);
    assert.doesNotMatch(markup, /HTTPS targets/);
  }
});

test('the footer text is the same for the live page and the recording, which adds only its own suffix', () => {
  const markup = build({ mode: 'hosted', allowVisitorTargets: true, recording: true }).markup;
  assert.match(markup, /headers never recorded · imported recording, inspection only/);
});
