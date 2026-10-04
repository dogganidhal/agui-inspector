// An example plugin for agui-inspector (plugin API version 0). It is plain JavaScript: a browser loads it as it is, so it
// needs no build. A deployment lists it in `plugins` of config.json and serves it from the page's own origin, with a
// JavaScript content type. It uses each extension point once, against the reference agent of this repository:
//
//   beforeRun         adds a counter to the forwarded properties of every run
//   provideHeaders    gives each request to the agent a header that changes every time
//   renderCustomEvent draws the custom event `example.note`
//   renderActivity    draws the activity type `example-plan`
//
// The module is the deployer's code and runs with the page's rights. The page does not sandbox it.

export default function activate(api) {
  // The plugin was written for version 0 of the API. Throwing is how a plugin refuses a page it does not support: the page
  // shows the message as a warning and carries on without the plugin.
  if (api.version !== 0) throw new Error(`written for plugin API 0, this page has ${api.version}`);

  // A hook sees a copy of the input that the preset and the client profile made, and returns the input to send. Returning
  // nothing keeps it, and throwing refuses the run. The thread id and the run id must stay as they are.
  let runs = 0;
  api.beforeRun((run) => ({
    ...run.input,
    forwardedProps: { ...run.input.forwardedProps, examplePlugin: { run: (runs += 1) } },
  }));

  // A provider is called before each preparation, run and raw request, with the method, the address and the body. Check the
  // address before you return a credential: the page cannot tell which origin the credential belongs to, and a hosted page can
  // be pointed at any HTTPS server. The headers are kept in memory for that one request.
  let requests = 0;
  api.provideHeaders((request) => {
    if (!new URL(request.url).pathname.startsWith('/interactive')) return undefined;
    return { 'X-Example-Request': String((requests += 1)) };
  });

  // A renderer draws into an empty container. Use the DOM, and `textContent` for anything the server sent: the text of an
  // event is not yours. The page's policy forbids inline script and inline style attributes, so set styles through
  // `element.style` and use the page's own properties, such as `var(--agui-accent)`. The function it returns is called
  // before the next draw and when the card goes away.
  api.renderCustomEvent('example.note', (event, container) => {
    const note = document.createElement('p');
    note.textContent = `Note: ${event.value.text}`;
    note.dataset.testid = 'example-note';
    note.style.borderLeft = '3px solid var(--agui-accent)';
    note.style.paddingLeft = '8px';
    container.append(note);
  });

  api.renderActivity('example-plan', (activity, container) => {
    const list = document.createElement('ol');
    list.dataset.testid = 'example-plan';
    for (const step of activity.content.steps) {
      const item = document.createElement('li');
      item.textContent = step;
      list.append(item);
    }
    container.append(list);
    return () => list.remove();
  });
}
