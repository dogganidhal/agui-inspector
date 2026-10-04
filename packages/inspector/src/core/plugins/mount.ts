// How one plugin renderer is called (specs/014-plugin-api, FR-014). Framework-free, and it needs nothing of the container
// but `replaceChildren`, so a test drives it with a fake and the page with a real element.
//
// The renderer gets a copy of the data (the JSON text is parsed again for each call) and an empty container, so nothing it
// does to its arguments reaches a recorded value. What it returns, when it is a function, is the cleanup: it runs before
// the next draw and when the card goes away, and the container is emptied after it either way. A throw in either is handed to
// `onError` once, and the container ends empty, so a half-drawn view never stays.

/** Draws `text` (the JSON of the data) into `container`. Returns what ends the draw: cleanup, then empty. */
export function mountRender<T, C extends { replaceChildren(): void }>(
  render: (data: T, container: C) => void | (() => void),
  text: string,
  container: C,
  onError: (error: unknown) => void,
): () => void {
  container.replaceChildren();
  let cleanup: unknown;
  try {
    cleanup = render(JSON.parse(text) as T, container);
  } catch (error) {
    onError(error);
    container.replaceChildren();
    return () => undefined;
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    try {
      if (typeof cleanup === 'function') cleanup();
    } catch (error) {
      onError(error);
    }
    container.replaceChildren();
  };
}
