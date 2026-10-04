// One plugin renderer on screen (specs/014-plugin-api, FR-014 to FR-017). It owns an empty container that React never fills,
// so nothing a plugin does inside it can confuse a reconciliation, and it calls the renderer through `mountRender`: a copy of
// the data, an empty container, the cleanup before the next draw and when the card goes away.
//
// The conversation view builds its entries again from the whole thread on every store change, so an entry is a new object
// each time and its identity says nothing. The effect is keyed on the renderer and on the JSON text of the data, so the
// renderer is called again when the content changes and not on every frame of the stream.
// ponytail: one JSON.stringify of the entry per slot per conversation render; a view over a very large activity redraws for
// each change of it. Upgrade path: a content version from the projection, so the text is not needed as the key.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Render } from '../contracts';
import { mountRender } from '../core/plugins/mount';
import { CodeBlock } from '../views/theme/primitives';

export interface PluginSlotProps<T> {
  readonly render: Render<T>;
  readonly data: T;
  /** A throw in the renderer or its cleanup. The host turns it into one warning. */
  onError(error: unknown): void;
  /** What the JSON view is called for assistive technology. */
  readonly label: string;
}

export function PluginSlot<T>({ render, data, onError, label }: PluginSlotProps<T>): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const report = useRef(onError);
  report.current = onError;
  const text = JSON.stringify(data) ?? 'null';
  // The renderer and the text it failed on. A new text or another renderer gets a fresh try.
  const [failedOn, setFailedOn] = useState<{ render: Render<T>; text: string }>();
  const failed = failedOn?.render === render && failedOn.text === text;

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    return mountRender(render as (data: T, container: HTMLDivElement) => void | (() => void), text, element, (error) => {
      report.current(error);
      setFailedOn({ render, text });
    });
  }, [render, text]);

  return (
    <>
      <div ref={container} data-plugin-view="" hidden={failed} />
      {failed && <CodeBlock text={JSON.stringify(JSON.parse(text), null, 2)} aria-label={label} />}
    </>
  );
}
