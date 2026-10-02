import type { ReactElement } from 'react';
import type { ConnectionViewProps } from '../../contracts';

/** Scaffold only: connecting and running are not implemented yet, so every control is disabled. */
export function ConnectionView(_props: ConnectionViewProps): ReactElement {
  return (
    <section aria-labelledby="connection-heading" data-view="connection" data-status="not-implemented">
      <h2 id="connection-heading">Connection</h2>
      <p role="status">Not implemented: this scaffold cannot send requests.</p>
      <label>
        Target URL
        <input type="url" disabled />
      </label>
      <label>
        Header name
        <input type="text" defaultValue="Authorization" disabled />
      </label>
      <label>
        Token
        <input type="password" autoComplete="off" disabled />
      </label>
      <label>
        Message
        <input type="text" disabled />
      </label>
      <button type="button" disabled>
        Send
      </button>
      <button type="button" disabled>
        Stop
      </button>
      <button type="button" disabled>
        New thread
      </button>
    </section>
  );
}
