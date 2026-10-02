// Session export and import controls (design.md, Session export and import). Export always shows
// the sensitive-data warning first and only then calls the host; import reads a local file and
// hands its text over. Neither makes a request. What a file holds and how it is validated lives in
// core/session-files.
import { useRef, useState, type ReactElement } from 'react';
import { SESSION_FILE_NAME } from '../../core/session-files/index.ts';
import { Button, Dialog, Finding, Icon } from '../theme/index.ts';
import './inspection.css';

export interface SessionControlsProps {
  readonly exchangeCount: number;
  readonly frameCount: number;
  /** Called after the warning is confirmed. */
  onExport(): void;
  /** Called with the text of the chosen file. */
  onImport(text: string): void;
  /** The chosen file could not be read at all. */
  onReadError(message: string): void;
}

const count = (n: number, noun: string) => `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;

export function SessionControls({ exchangeCount, frameCount, onExport, onImport, onReadError }: SessionControlsProps): ReactElement {
  const [warning, setWarning] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  async function chosen(file: File | undefined) {
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      onReadError('The file could not be read.');
      return;
    }
    onImport(text);
  }

  return (
    <>
      <Button onClick={() => setWarning(true)}>
        <Icon name="export" size={15} />
        Export session
      </Button>
      <Button onClick={() => picker.current?.click()}>
        <Icon name="import" size={15} />
        Import session
      </Button>
      <input
        ref={picker}
        type="file"
        accept=".json,application/json"
        className="agui-ins-file"
        aria-label="Session file to import"
        tabIndex={-1}
        onChange={(event) => {
          const input = event.currentTarget;
          void chosen(input.files?.[0]).finally(() => {
            // The same file can be chosen again after a failed import.
            input.value = '';
          });
        }}
      />
      <Dialog
        open={warning}
        onClose={() => setWarning(false)}
        title="Export this session"
        footer={
          <>
            <Button onClick={() => setWarning(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setWarning(false);
                onExport();
              }}
            >
              Export session
            </Button>
          </>
        }
      >
        <p>The file holds this session's exchanges, every frame as received, run inputs and timings, as pre-stable version 0 JSON.</p>
        <Finding variant="warn" kind="Sensitive data">
          Raw frames and request bodies can contain personal or sensitive data. Anyone who has the file can read it, so share it only where that is acceptable.
        </Finding>
        <p>Headers and authentication tokens are never included.</p>
        <p className="agui-ins-mono" data-export-summary="">
          {SESSION_FILE_NAME} · {count(exchangeCount, 'exchange')} · {count(frameCount, 'frame')} · 0 headers
        </p>
      </Dialog>
    </>
  );
}
