// L07 T049/T051 (unit side): the app shell renders every fixed view entry, the footer states the
// privacy facts of the current mode with the counts of the session on screen, and the shell shows
// no token and requests nothing by itself. Interaction and the browser's enforcement are in
// tests/e2e/hosted/app.spec.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppProps } from '../../src/contracts.ts';
import { App, type AppExtras } from '../../src/app/index.tsx';
import { Brand } from '../../src/app/brand.tsx';
import { defaultProfile } from '../../src/core/profiles/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';

const SYNTHETIC_TOKEN = 'synthetic-token-7f3a91';

function build(patch: Partial<AppExtras> = {}, exchanges = 0, settings: Partial<AppProps['settings']> = {}) {
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
      ...settings,
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

test('the theme switch starts from the theme on the root, and from the system preference when the root has none', () => {
  const scope = globalThis as unknown as Record<string, unknown>;
  const label = (theme: string | undefined, systemDark: boolean) => {
    scope.document = { documentElement: { dataset: theme === undefined ? {} : { theme } } };
    scope.matchMedia = () => ({ matches: systemDark });
    try {
      return /aria-label="(Switch to (?:light|dark) theme)"/.exec(build().markup)?.[1];
    } finally {
      delete scope.document;
      delete scope.matchMedia;
    }
  };
  assert.equal(label('dark', false), 'Switch to light theme', 'a stored dark choice beats a light system');
  assert.equal(label('light', true), 'Switch to dark theme', 'a stored light choice beats a dark system');
  assert.equal(label(undefined, true), 'Switch to light theme');
  assert.equal(label(undefined, false), 'Switch to dark theme');
  assert.equal(label('sepia', true), 'Switch to light theme', 'an unknown value on the root is not a choice');
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

// FX8: the top bar carries a second entry point onto the agent selection Settings already has.

const several = [
  { id: 'support', name: 'Support assistant', url: '/agents/support/stream' },
  { id: 'billing', name: 'Billing assistant', url: '/agents/billing/stream' },
];
/** The top bar's markup: everything before the panes. */
const bar = (markup: string) => markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));

test('the top bar offers the configured agents beside the endpoint, naming the selected one', () => {
  const header = bar(build({}, 0, { agents: several }).markup);
  assert.match(header, /<span class="agui-settings-picker-label">Agent<\/span><span class="agui-settings-picker-name">Support assistant<\/span>/);
  assert.ok(header.indexOf('agui-settings-picker--bar') < header.indexOf('agui-conn-endpoint'), 'the picker comes before the endpoint field');
  for (const text of ['Billing assistant', '/agents/billing/stream']) assert.ok(header.includes(text), text);
  assert.match(header, /aria-pressed="true"[^>]*>(?:(?!<\/button>).)*Support assistant/s);
});

test('the top bar says Custom URL when agents exist and none is selected, and has no picker without agents', () => {
  assert.match(bar(build({}, 0, { agents: several, selectedAgentId: undefined }).markup), /agui-settings-picker-name">Custom URL</);
  assert.doesNotMatch(bar(build({}, 0, { agents: [], selectedAgentId: undefined }).markup), /agui-settings-picker/);
});

// Spec 003: the brand in the top bar. Without one the bar is what 0.1.0 had.

const brandOf = (markup: string) => markup.slice(markup.indexOf('<span class="agui-app-brand">'), markup.indexOf('</h1>') + 5);
const DEFAULT_BRAND = '<span class="agui-app-brand"><span class="agui-app-mark" aria-hidden="true">';

test('with no brand the top bar shows the default mark and the name agui-inspector, and loads no image', () => {
  const header = bar(build().markup);
  assert.ok(header.includes(DEFAULT_BRAND));
  assert.match(brandOf(header), /<\/span><h1>agui-inspector<\/h1>$/);
  assert.doesNotMatch(header, /<img|data-for|agui-app-logo/);
  assert.equal(brandOf(bar(build({ brand: {} }).markup)), brandOf(header));
});

test('a name replaces the heading text only, and is text, never markup', () => {
  const header = bar(build({ brand: { name: 'Acme Console' } }).markup);
  assert.ok(header.includes(DEFAULT_BRAND), 'the default mark stays');
  assert.match(brandOf(header), /<h1>Acme Console<\/h1>$/);
  assert.doesNotMatch(header, /agui-inspector<\/h1>/);
  assert.match(bar(build({ brand: { name: '<b>Acme</b>' } }).markup), /<h1>&lt;b&gt;Acme&lt;\/b&gt;<\/h1>/);
  assert.equal(build({ brand: { name: 'Acme' } }).markup.match(/<h1>/g)?.length, 1);
});

test('a logo with no name shows alone: an unframed decorative image, and the heading agui-inspector is hidden from the eye', () => {
  const header = bar(build({ brand: { logo: '/static/acme.svg' } }).markup);
  assert.ok(brandOf(header).startsWith('<span class="agui-app-brand"><span class="agui-app-logo" aria-hidden="true"><img class="agui-app-logo-img" src="/static/acme.svg" alt=""/></span>'));
  assert.doesNotMatch(header, /agui-app-mark/);
  assert.match(brandOf(header), /<h1 class="agui-app-sr">agui-inspector<\/h1>$/);
  assert.equal(header.match(/<h1/g)?.length, 1);
  assert.deepEqual([...header.matchAll(/\ssrc="([^"]*)"/g)].map((match) => match[1]), ['/static/acme.svg'], 'the logo is the only image the brand adds');

  const both = bar(build({ brand: { name: 'Acme', logo: 'data:image/png;base64,AAAA' } }).markup);
  assert.match(brandOf(both), /<img class="agui-app-logo-img" src="data:image\/png;base64,AAAA" alt=""\/><\/span><h1>Acme<\/h1>$/);

  const dark = bar(build({ brand: { logo: '/a.svg', logoDark: '/b.svg' } }).markup);
  assert.match(brandOf(dark), /<h1 class="agui-app-sr">agui-inspector<\/h1>$/);
});

test('a dark logo is a second image in its own wrapper, and a single logo has no wrapper', () => {
  const header = bar(build({ brand: { logo: '/a.svg', logoDark: '/b.svg' } }).markup);
  assert.ok(
    header.includes(
      '<span class="agui-app-logo" aria-hidden="true"><span data-for="light"><img class="agui-app-logo-img" src="/a.svg" alt=""/></span><span data-for="dark"><img class="agui-app-logo-img" src="/b.svg" alt=""/></span></span>',
    ),
  );
  assert.doesNotMatch(bar(build({ brand: { logo: '/a.svg' } }).markup), /data-for/);
});

test('a logo that failed to load is the default mark again, in the theme that used it', () => {
  const html = (failed: Array<'logo' | 'logoDark'>, brand: { logo: string; logoDark?: string }) => renderToStaticMarkup(<Brand brand={brand} failed={failed} onFailed={() => {}} />);
  const MARK = /<span class="agui-app-mark" aria-hidden="true">/;
  const single = html(['logo'], { logo: '/a.svg' });
  assert.match(single, MARK);
  assert.doesNotMatch(single, /<img/);
  const dark = html(['logoDark'], { logo: '/a.svg', logoDark: '/b.svg' });
  assert.match(dark, /<span data-for="light"><img [^>]*src="\/a\.svg"[^>]*\/><\/span><span data-for="dark"><span class="agui-app-mark"/);
  assert.doesNotMatch(dark, /\/b\.svg/);
  assert.doesNotMatch(html([], { logo: '/a.svg' }), MARK);
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
