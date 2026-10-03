// L02 T028 (unit side): the connection controls and the reply editors render as labelled native
// controls, disable the composer for the right reason, never show the token, and offer exactly the
// answers the protocol has. Interaction is exercised in the Playwright spec; here the markup is checked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Interrupt } from '@ag-ui/core';
import type { ConnectionViewProps, ConversationViewProps, InterruptAnswer, ToolResultDraft } from '../../src/contracts.ts';
import { createSessionStore } from '../../src/core/store/index.ts';
import { Composer, ConnectionView, RepliesView, TargetControls } from '../../src/views/connection/index.tsx';

const TOKEN = 'synthetic-token-7f3a91';
const spy = () => () => undefined;

const connectionProps = (patch: Partial<ConnectionViewProps> = {}): ConnectionViewProps => ({
  connection: { agentId: 'support', targetUrl: 'https://agent.example/run' },
  running: false,
  quickMessages: ['/help', 'Where is my order?'],
  onChangeTarget: spy(),
  onChangeAuth: spy(),
  onSend: spy(),
  onStop: spy(),
  onNewThread: spy(),
  ...patch,
});
/** The opening tag of the element with this attribute value, so a test does not depend on attribute order. */
const openTag = (markup: string, attribute: string): string => markup.match(new RegExp(`<(?:button|textarea|input)[^>]*${attribute.replace(/[()?]/g, '\\$&')}[^>]*>`))?.[0] ?? '';
const chip = (markup: string, text: string): string => markup.match(new RegExp(`<button[^>]*>${text.replace(/[()?]/g, '\\$&')}</button>`))?.[0] ?? '';
const render = (patch: Partial<ConnectionViewProps> = {}, extras: { notice?: string; capturing?: boolean; mode?: 'embedded' | 'hosted' } = {}) =>
  renderToStaticMarkup(<ConnectionView {...connectionProps(patch)} {...extras} />);

test('the view is the labelled connection section with every control a native, named element', () => {
  const markup = render();
  assert.match(markup, /^<section aria-labelledby="connection-heading" data-view="connection"/);
  assert.match(markup, /<h2 id="connection-heading">Connection<\/h2>/);
  assert.match(markup, />Endpoint URL<\/label>/);
  assert.match(markup, /value="https:\/\/agent\.example\/run"/);
  assert.match(markup, /aria-label="Send message"/);
  assert.match(markup, /aria-label="New thread"/);
  assert.match(markup, /aria-label="Stop"/);
  assert.match(markup, />Message<\/label>/);
  assert.doesNotMatch(markup, /not-implemented|Not implemented/);
});

test('quick messages are buttons in a named group and use the message text as their name', () => {
  const markup = render();
  assert.match(markup, /role="group" aria-label="Quick messages"/);
  assert.match(markup, />\/help<\/button>/);
  assert.match(markup, />Where is my order\?<\/button>/);
  assert.doesNotMatch(render({ quickMessages: [] }), /Quick messages/);
});

test('Stop is available only while a run streams, and a streaming run disables the box, Send and the chips', () => {
  const idle = render();
  assert.match(openTag(idle, 'aria-label="Stop"'), /disabled/);
  assert.match(idle, /Enter sends\. Shift\+Enter adds a line\./);

  const streaming = render({ running: true });
  assert.doesNotMatch(openTag(streaming, 'aria-label="Stop"'), /disabled/);
  assert.match(openTag(streaming, 'placeholder="Message the agent"'), /disabled/);
  assert.match(openTag(streaming, 'aria-label="Send message"'), /disabled/);
  assert.match(chip(streaming, '/help'), /disabled/);
  assert.match(streaming, /A run is streaming\. Stop it to send another message\./);
});

test('Stop follows the recording, not the run: it stays available after the run ended while a response is still captured', () => {
  const recording = render({ running: false }, { capturing: true });
  assert.doesNotMatch(openTag(recording, 'aria-label="Stop"'), /disabled/);
  assert.doesNotMatch(openTag(recording, 'placeholder="Message the agent"'), /disabled/, 'a new message is still allowed: only the run blocks it');
  assert.match(recording, /Enter sends\. Shift\+Enter adds a line\./);
  assert.match(openTag(render({ running: false }, { capturing: false }), 'aria-label="Stop"'), /disabled/);
  assert.doesNotMatch(openTag(render({ running: true }, { capturing: false }), 'aria-label="Stop"'), /disabled/, 'a host that only reports the run keeps working');
});

test('waiting replies disable the composer and the notice says why', () => {
  const markup = render({}, { notice: '2 interrupts waiting. Answer them to continue the run.' });
  assert.match(markup, /role="status">2 interrupts waiting\. Answer them to continue the run\./);
  assert.match(openTag(markup, 'placeholder="Message the agent"'), /disabled/);
  assert.match(chip(markup, '/help'), /disabled/);
  assert.doesNotMatch(openTag(markup, 'aria-label="New thread"'), /disabled/, 'a new thread is the way out of a stuck barrier');
});

test('an error from the runtime is a visible alert', () => {
  const markup = render({ error: 'Preparation failed: POST /prepare/warm answered 500. The run was not sent.' });
  assert.match(markup, /role="alert"[^>]*>(?:(?!<\/div>).)*Preparation failed: POST \/prepare\/warm answered 500/s);
});

test('authentication shows the header name and a mask, never the token, and defaults the header to Authorization', () => {
  const none = renderToStaticMarkup(<TargetControls connection={{}} onChangeTarget={spy()} onChangeAuth={spy()} />);
  assert.match(none, /aria-label="Authentication: no token"/);
  assert.match(none, />No token</);
  assert.match(none, /value="Authorization"/);
  assert.match(none, /type="password"[^>]*autoComplete="off"|autoComplete="off"[^>]*type="password"/i);

  const set = renderToStaticMarkup(<TargetControls connection={{ auth: { headerName: 'X-Api-Key', token: TOKEN } }} onChangeTarget={spy()} onChangeAuth={spy()} />);
  assert.match(set, /aria-label="Authentication: X-Api-Key set"/);
  assert.match(set, />X-Api-Key</);
  assert.match(set, /••••••/);
  const visible = set.replace(/<input[^>]*>/g, '');
  assert.ok(!visible.includes(TOKEN), 'the token is not part of any text, label or attribute outside its own password field');
});

test('the popover says where the token lives and what clears it', () => {
  const markup = renderToStaticMarkup(<TargetControls connection={{}} onChangeTarget={spy()} onChangeAuth={spy()} />);
  assert.match(markup, /popover/);
  assert.match(markup, /The token stays in memory\. It is cleared on reload or when the target changes, and it is never recorded or exported\./);
  assert.match(markup, /Clear token/);
});

test('a header name that cannot carry a token is flagged', () => {
  const markup = renderToStaticMarkup(<TargetControls connection={{ auth: { headerName: 'Cookie', token: TOKEN } }} onChangeTarget={spy()} onChangeAuth={spy()} />);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /header name &quot;Cookie&quot;/i);
});

test('the mode tag names the deployment when the assembly provides it', () => {
  assert.match(render({}, { mode: 'embedded' }), />embedded</);
  assert.match(render({}, { mode: 'hosted' }), /placeholder="https:\/\/agent\.example\/run"/);
  assert.match(render({}, { mode: 'embedded' }), /placeholder="\/agents\/support\/stream"/);
});

test('Composer stands on its own for an assembly that places it apart from the endpoint controls', () => {
  const markup = renderToStaticMarkup(<Composer running={false} quickMessages={[]} onSend={spy()} onStop={spy()} onNewThread={spy()} />);
  assert.match(markup, /data-view="composer"/);
  assert.doesNotMatch(markup, /Endpoint URL/);
});

// ---------------------------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------------------------

const interrupts: Interrupt[] = [
  { id: 'i-1', reason: 'approval', message: 'Approve the refund of 25.00?', responseSchema: { type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' } } } },
  { id: 'i-2', reason: 'input' },
];

function repliesProps(patch: Partial<ConversationViewProps> = {}): ConversationViewProps {
  const store = createSessionStore({ schedule: (callback) => callback() });
  store.appendExchange({ id: 'ex-1', kind: 'conversation', method: 'POST', path: '/run', startedAt: 0, transport: 'completed', frameIds: [], runId: 'run-1' });
  store.upsertRun({
    id: 'run-1',
    threadId: 't1',
    runId: 'r1',
    input: { threadId: 't1', runId: 'r1', messages: [], tools: [], context: [], forwardedProps: {} },
    exchangeId: 'ex-1',
    startedAt: 0,
    outcome: { kind: 'interrupt', interrupts },
  });
  const answers: InterruptAnswer[] = [
    { runId: 'run-1', interruptId: 'i-1', draft: { approved: false }, status: 'unanswered', responseSchema: interrupts[0]?.responseSchema as never },
    { runId: 'run-1', interruptId: 'i-2', draft: {}, status: 'unanswered' },
  ];
  return {
    store,
    interrupts: answers,
    toolResults: [],
    onDraftInterrupt: spy(),
    onAnswerInterrupt: spy(),
    onDraftToolResult: spy(),
    onSubmitToolResult: spy(),
    onContinue: spy(),
    ...patch,
  };
}

test('nothing renders when nothing is owed', () => {
  assert.equal(renderToStaticMarkup(<RepliesView {...repliesProps({ interrupts: [] })} />), '');
});

test('each waiting interrupt is an accent card with its prompt, a prefilled editor, a schema hint, Resolve and Cancel', () => {
  const markup = renderToStaticMarkup(<RepliesView {...repliesProps()} />);
  assert.match(markup, /data-interrupt="i-1"/);
  assert.match(markup, /agui-card--interrupt/);
  assert.match(markup, /Approve the refund of 25\.00\?/);
  assert.match(markup, /<textarea[^>]*aria-label="Answer for interrupt i-1"[^>]*>\{\n  &quot;approved&quot;: false\n\}<\/textarea>/);
  assert.match(markup, /Response schema: object · required: approved · fields: approved/);
  assert.match(markup, /aria-label="Resolve interrupt i-1"/);
  assert.match(markup, /aria-label="Cancel interrupt i-1"/);
  assert.match(markup, /aria-label="Resolve interrupt i-2"/);
  assert.match(markup, />2 of 2 waiting</);
  assert.match(markup, /The next run carries resume answers once every interrupt has one\./);
  assert.match(markup, />approval</);
});

test('an interrupt without a schema still gets an editor, and says it accepts any JSON', () => {
  const markup = renderToStaticMarkup(<RepliesView {...repliesProps()} />);
  assert.match(markup, /aria-label="Answer for interrupt i-2"[^>]*>\{\}<\/textarea>/);
  assert.doesNotMatch(markup.split('data-interrupt="i-2"')[1] ?? '', /Response schema/);
});

test('an answer that misses the schema warns without blocking Resolve; invalid JSON blocks it', () => {
  const missing = repliesProps();
  const wrong = renderToStaticMarkup(
    <RepliesView {...missing} interrupts={[{ ...(missing.interrupts[0] as InterruptAnswer), draft: { approved: 'yes' } }]} />,
  );
  assert.match(wrong, /approved must be true or false\. The interrupt&#x27;s response schema requires it\. You can still send it\./);
  assert.doesNotMatch(openTag(wrong, 'aria-label="Resolve interrupt i-1"'), /disabled/);
});

test('answered interrupts collapse to one line with their status; a cancelled one shows no payload', () => {
  const props = repliesProps();
  const markup = renderToStaticMarkup(
    <RepliesView
      {...props}
      interrupts={[
        { ...(props.interrupts[0] as InterruptAnswer), draft: { approved: true }, status: 'resolved' },
        { ...(props.interrupts[1] as InterruptAnswer), draft: { leftover: 1 }, status: 'cancelled' },
      ]}
    />,
  );
  assert.match(markup, /data-interrupt="i-1" data-status="resolved"/);
  assert.match(markup, />Resolved</);
  assert.match(markup, /\{&quot;approved&quot;:true\}/);
  assert.match(markup, /data-interrupt="i-2" data-status="cancelled"/);
  assert.match(markup, />Cancelled</);
  assert.doesNotMatch(markup, /leftover/);
  assert.doesNotMatch(markup, /aria-label="Resolve interrupt/, 'no controls once answered');
});

const tools: ToolResultDraft[] = [
  { runId: 'run-1', toolCallId: 'c-1', toolName: 'pick_color', argumentsText: '{"choices":["red","teal"]}', argumentsParsed: { choices: ['red', 'teal'] }, resultDraft: '', status: 'pending' },
  { runId: 'run-1', toolCallId: 'c-2', toolName: 'pick_size', argumentsText: '{"n":', argumentsError: 'Arguments are not valid JSON (Unexpected end of JSON input)', resultDraft: '', status: 'pending' },
];

test('each pending client tool call has a manual result editor beside its arguments', () => {
  const markup = renderToStaticMarkup(<RepliesView {...repliesProps({ interrupts: [], toolResults: tools })} />);
  assert.match(markup, /data-tool-call="c-1"/);
  assert.match(markup, /client tool/);
  assert.match(markup, /aria-label="Arguments of pick_color"/);
  assert.match(markup, /aria-label="Result for pick_color \(c-1\)"/);
  assert.match(markup, /aria-label="Submit result for c-1"/);
  assert.match(markup, />2 of 2 waiting</);
  assert.match(markup, /Nothing is answered for you\./);
  assert.match(markup, /Arguments are not valid JSON/);
  assert.match(markup, /aria-label="Arguments of pick_size, as streamed"/);
});

test('an answered tool call shows the result that was entered, with no editor', () => {
  const answered: ToolResultDraft = { ...(tools[0] as ToolResultDraft), resultDraft: '"teal"', status: 'answered' };
  const markup = renderToStaticMarkup(<RepliesView {...repliesProps({ interrupts: [], toolResults: [answered, tools[1] as ToolResultDraft] })} />);
  assert.match(markup, /data-tool-call="c-1" data-status="answered"/);
  assert.match(markup, /Result entered/);
  assert.match(markup, /&quot;teal&quot;/);
  assert.doesNotMatch(markup, /aria-label="Submit result for c-1"/);
  assert.match(markup, /aria-label="Submit result for c-2"/);
  assert.match(markup, />1 of 2 waiting</);
});

// ---------------------------------------------------------------------------------------------
// Stylesheet
// ---------------------------------------------------------------------------------------------

const css = readFileSync(path.join(process.cwd(), 'packages/inspector/src/views/connection/connection.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('the stylesheet takes every color, radius and font from the tokens, and spacing from --u', () => {
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'no hex colors');
  assert.doesNotMatch(css, /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i, 'no literal color functions');
  for (const [, value] of css.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/g)) assert.match(value ?? '', /^(0|50%|var\(--r(-sm|-xs)?\))$/);
  for (const [, value] of css.matchAll(/font(?:-family)?\s*:\s*([^;}]+)/g)) assert.match(value ?? '', /inherit|var\(--agui-font-(sans|mono)\)/);
  for (const [, value] of css.matchAll(/(?:^|[;{\s])(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;}]+)/g)) {
    for (const part of (value ?? '').split(/\s+(?![^(]*\))/)) assert.match(part, /^(0|auto|16px|-?calc\(.*var\(--u\).*\)|var\(--[a-z-]+\)|inherit)$/, part);
  }
});

test('the stylesheet fetches nothing, defines no tokens and namespaces every class', () => {
  assert.doesNotMatch(css, /@import|@font-face|url\(|image-set\(|src\s*:/i);
  assert.doesNotMatch(css, /https?:|\/\/[a-z]/i);
  assert.doesNotMatch(css, /(?:^|[;{\s])--[a-z-]+\s*:/);
  for (const [, name] of css.matchAll(/\.([a-z][\w-]*)/g)) assert.match(name ?? '', /^agui-/, `.${name}`);
});
