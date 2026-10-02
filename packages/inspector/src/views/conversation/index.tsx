import type { ReactElement } from 'react';
import type { ConversationViewProps } from '../../contracts';

/** Scaffold only: transcript, interrupt and tool-result replies are not implemented yet. */
export function ConversationView(_props: ConversationViewProps): ReactElement {
  return (
    <section aria-labelledby="conversation-heading" data-view="conversation" data-status="not-implemented">
      <h2 id="conversation-heading">Conversation</h2>
      <p role="status">Not implemented: there is no transcript, state view or reply editor yet.</p>
      <button type="button" disabled>
        Continue run
      </button>
    </section>
  );
}
