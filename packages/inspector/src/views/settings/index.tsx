import type { ReactElement } from 'react';
import type { SettingsViewProps } from '../../contracts';

/** Scaffold only: agent selection, presets and client profiles are not implemented yet. */
export function SettingsView(_props: SettingsViewProps): ReactElement {
  return (
    <section aria-labelledby="settings-heading" data-view="settings" data-status="not-implemented">
      <h2 id="settings-heading">Settings</h2>
      <p role="status">Not implemented: agent selection, presets and the client profile come in a later slice.</p>
      <label>
        Agent
        <select disabled>
          <option>No agents loaded</option>
        </select>
      </label>
      <button type="button" disabled>
        Import profile
      </button>
      <button type="button" disabled>
        Export profile
      </button>
    </section>
  );
}
