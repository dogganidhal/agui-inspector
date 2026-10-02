// F01 T003: the fixed entry exports render accessible sections, and any surface that still says
// "not implemented" is inert: every control disabled, no success claim. Later slices replace the
// scaffolds without editing this file because the rules apply only to surfaces that declare it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  A2uiViewProps,
  AppProps,
  InspectionSession,
  SessionStore,
} from '../../src/contracts';
import { App, mountApp } from '../../src/app/index';
import { A2uiView } from '../../src/views/a2ui/index';
import { ConnectionView } from '../../src/views/connection/index';
import { ConversationView } from '../../src/views/conversation/index';
import { InspectionView } from '../../src/views/inspection/index';
import { SettingsView } from '../../src/views/settings/index';

/** A callback that records any call: an inert surface must never trigger one. */
const calls: string[] = [];
const spy = (name: string) => () => void calls.push(name);

const session: InspectionSession = { id: 'test', exchanges: [], runs: [], frames: [], findings: [], derived: [] };
const store: SessionStore = {
  appendExchange: spy('appendExchange'),
  updateExchange: spy('updateExchange'),
  appendFrame: spy('appendFrame'),
  addFinding: spy('addFinding'),
  upsertRun: spy('upsertRun'),
  appendDerived: spy('appendDerived'),
  snapshot: () => session,
  subscribe: () => () => {},
};

const props: AppProps = {
  settings: {
    agents: [],
    profile: { protocolVersion: '1.0', tools: [], context: [], renderA2ui: true, injectA2uiTool: false, forwardedProps: {} },
    variables: {},
    onSelectAgent: spy('onSelectAgent'),
    onChangeProfile: spy('onChangeProfile'),
    onChangeVariable: spy('onChangeVariable'),
    onImportProfile: spy('onImportProfile'),
    onExportProfile: spy('onExportProfile'),
  },
  connection: {
    connection: {},
    running: false,
    quickMessages: [],
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
  inspection: {
    store,
    onSendRaw: spy('onSendRaw'),
    onExportSession: spy('onExportSession'),
    onImportSession: spy('onImportSession'),
  },
};

const a2uiProps: A2uiViewProps = { activityId: 'a1', operations: [], renderEnabled: false, onAction: spy('onAction') };

const views = [
  ['settings', renderToStaticMarkup(<SettingsView {...props.settings} />)],
  ['connection', renderToStaticMarkup(<ConnectionView {...props.connection} />)],
  ['conversation', renderToStaticMarkup(<ConversationView {...props.conversation} />)],
  ['inspection', renderToStaticMarkup(<InspectionView {...props.inspection} />)],
  ['a2ui', renderToStaticMarkup(<A2uiView {...a2uiProps} />)],
] as const;

for (const [name, markup] of views) {
  test(`${name} view is a labelled section`, () => {
    // An A2UI view appears once per activity card, so its heading id carries the activity id.
    const headingId = name === 'a2ui' ? 'a2ui-heading-a1' : `${name}-heading`;
    assert.match(markup, new RegExp(`<section aria-labelledby="${headingId}" data-view="${name}"`));
    assert.match(markup, new RegExp(`<h2 id="${headingId}"`));
  });

  test(`${name} view: if it is still a scaffold it says so, disables every control and claims nothing`, () => {
    if (!markup.includes('data-status="not-implemented"')) return;
    assert.match(markup, /role="status"[^>]*>Not implemented/);
    for (const [tag] of markup.matchAll(/<(?:button|input|select|textarea)\b[^>]*>/g)) {
      assert.match(tag, /\bdisabled=""/, `${tag} must be disabled`);
    }
    assert.doesNotMatch(markup, /\b(?:success|succeeded|connected|sent|exported|imported|saved)\b/i);
  });
}

test('the app assembles settings, connection, conversation and inspection', () => {
  const markup = renderToStaticMarkup(<App {...props} />);
  for (const name of ['settings', 'connection', 'conversation', 'inspection']) {
    assert.match(markup, new RegExp(`data-view="${name}"`));
  }
  assert.match(markup, /<h1>/);
});

test('an app that is still a scaffold says it is not MVP acceptance', () => {
  const markup = renderToStaticMarkup(<App {...props} />);
  if (!markup.includes('data-status="scaffold"')) return;
  assert.match(markup, /not MVP acceptance/i);
});

test('rendering never invokes a callback or touches the store', () => {
  assert.deepEqual(calls, []);
});

test('importing the entry module does not boot without a document', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof mountApp, 'function');
});
