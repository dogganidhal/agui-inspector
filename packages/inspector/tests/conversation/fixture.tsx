// L03 T033: the browser fixture host. It renders the conversation and state views over a real session
// store and exposes a small script API on window, so the Playwright spec can stream events in one at a
// time and look at what a user would see. Test support, never part of the shipped app.
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';
import type { ConversationViewProps, EvidenceTarget } from '../../src/contracts';
import { publishChunkExpansions } from '../../src/core/projection/index';
import { ConversationView } from '../../src/views/conversation/index';
import { StateView } from '../../src/views/conversation/state';
import { harness } from './support';
// The stylesheets the assembly loads: the theme, then this view's own.
import '../../src/views/theme/index';
import '../../src/views/conversation/conversation.css';

const host = harness((callback) => void requestAnimationFrame(callback));

const noop = () => undefined;
/** `?reveal` gives the conversation view a reveal action, so its run ids and frame references are buttons. Off by default, as the views mount on their own. */
const withReveal = new URLSearchParams(location.search).has('reveal');
/** What the conversation and state views asked the page to reveal, in order: the page's navigation is outside this host. */
const revealed: EvidenceTarget[] = [];
const props: ConversationViewProps = {
  store: host.store,
  interrupts: [],
  toolResults: [],
  onDraftInterrupt: noop,
  onAnswerInterrupt: noop,
  onDraftToolResult: noop,
  onSubmitToolResult: noop,
  onContinue: noop,
};

function Page(): ReactElement {
  return (
    <main style={{ background: 'var(--bg)', color: 'var(--fg)', display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: '100vh' }}>
      <div data-pane="conversation">
        <ConversationView
          {...props}
          {...(withReveal && { onReveal: (target: EvidenceTarget) => void revealed.push(target) })}
          renderActivity={(entry) => (entry.activityType === 'rendered-demo' ? <p data-testid="rendered-activity">Surface for {entry.messageId}</p> : undefined)}
        />
      </div>
      <div data-pane="state">
        <StateView store={host.store} onReveal={(target) => void revealed.push(target)} />
      </div>
    </main>
  );
}

declare global {
  interface Window {
    __conversation: {
      open(id: string, options?: Parameters<typeof host.open>[1]): void;
      push(exchangeId: string, event: object | string, offsetMs: number): void;
      close(exchangeId: string, transport?: Parameters<typeof host.close>[1]): void;
      /** Appends the chunk expansions to the store, the way the assembly does. Returns how many were added. */
      publish(): number;
      session(): ReturnType<typeof host.session>;
      /** The targets the views asked to reveal. */
      revealed: EvidenceTarget[];
    };
  }
}

window.__conversation = {
  open: (id, options) => host.open(id, options),
  push: (exchangeId, event, offsetMs) => host.push(exchangeId, event, offsetMs),
  close: (exchangeId, transport) => host.close(exchangeId, transport),
  publish: () => publishChunkExpansions(host.store),
  session: () => host.session(),
  revealed,
};

createRoot(document.getElementById('root') as HTMLElement).render(<Page />);
