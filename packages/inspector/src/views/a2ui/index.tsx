import type { ReactElement } from 'react';
import type { A2uiViewProps } from '../../contracts';

/** Scaffold only: the v0.9 renderer is not wired in yet, so no surface renders and no action fires. */
export function A2uiView(_props: A2uiViewProps): ReactElement {
  return (
    <section aria-labelledby="a2ui-heading" data-view="a2ui" data-status="not-implemented">
      <h2 id="a2ui-heading">A2UI surface</h2>
      <p role="status">Not implemented: surfaces are not rendered by this scaffold.</p>
    </section>
  );
}
