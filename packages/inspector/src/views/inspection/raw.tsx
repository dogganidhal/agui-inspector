// The raw request editor (design.md, Raw request). It sends the entered text as written, outside
// the conversation: no preset, profile or preparation touches it. Invalid JSON blocks sending; a
// document that is not a run input is flagged and still goes out, so a server's handling of bad
// input can be inspected. The reply lands in the frames list as a `raw` exchange.
import { useId, useMemo, useState, type ReactElement } from 'react';
import { Button, Editor, Finding, Icon, Label } from '../theme/index.ts';
import './inspection.css';
import { analyzeRawInput, sendRaw } from './raw-input.ts';

export interface RawRequestProps {
  /** Receives the entered text, unchanged. */
  onSend(text: string): void;
  /** Text to start from. */
  readonly initialText?: string;
}

export function RawRequest({ onSend, initialText = '' }: RawRequestProps): ReactElement {
  const [text, setText] = useState(initialText);
  const analysis = useMemo(() => analyzeRawInput(text), [text]);
  const findings = useId();
  const blocked = analysis.state !== 'ok';

  return (
    <section className="agui-raw" aria-labelledby={`${findings}-heading`} data-view="raw-request">
      <p id={`${findings}-heading`}>
        The request goes out exactly as written, outside the conversation. Presets, the client profile and preparation requests are not applied. The reply appears in Frames.
      </p>
      <div className="agui-raw-field">
        <Label>Request body</Label>
        <Editor
          aria-label="Raw request body"
          aria-describedby={findings}
          placeholder='{"threadId": "…", "runId": "…", "messages": []}'
          value={text}
          invalid={analysis.state === 'syntax-error'}
          onChange={(event) => setText(event.currentTarget.value)}
        />
      </div>
      <div id={findings} className="agui-raw-findings">
        {analysis.state === 'syntax-error' && (
          <Finding variant="err" kind="Not valid JSON">
            {analysis.message}. Fix the text to send it.
          </Finding>
        )}
        {analysis.state === 'ok' && analysis.warnings.length > 0 && (
          <Finding variant="warn" kind="Not a valid run input">
            {analysis.warnings.join(' · ')}
          </Finding>
        )}
        {analysis.state === 'ok' && analysis.warnings.length === 0 && (
          <Finding icon="check" kind="Valid run input">
            The document matches the run input schema.
          </Finding>
        )}
      </div>
      <div className="agui-raw-actions">
        <Button variant="primary" disabled={blocked} onClick={() => sendRaw(text, onSend)}>
          <Icon name="send" size={14} />
          Send unchanged
        </Button>
        <span className="agui-ins-note">
          {analysis.state === 'ok' && analysis.warnings.length > 0 ? 'It will still be sent as written.' : 'Sent as written, byte for byte.'}
        </span>
      </div>
    </section>
  );
}
