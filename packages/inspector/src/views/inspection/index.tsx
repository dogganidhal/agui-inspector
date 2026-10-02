import type { ReactElement } from 'react';
import type { InspectionViewProps } from '../../contracts';

/** Scaffold only: frames, raw requests and session files are not implemented yet. */
export function InspectionView(_props: InspectionViewProps): ReactElement {
  return (
    <section aria-labelledby="inspection-heading" data-view="inspection" data-status="not-implemented">
      <h2 id="inspection-heading">Inspection</h2>
      <p role="status">Not implemented: no exchanges, frames or recordings are captured by this scaffold.</p>
      <label>
        Raw request
        <textarea disabled rows={4} />
      </label>
      <button type="button" disabled>
        Send raw
      </button>
      <button type="button" disabled>
        Export session
      </button>
      <button type="button" disabled>
        Import session
      </button>
    </section>
  );
}
