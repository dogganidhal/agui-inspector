// Two ways to serve the production build beyond `openSite`: behind the real Python helper, and from a generic
// static server that knows nothing about either. Shared by the theme and branding specs.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createServer as createSocketServer, type AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AGENT_REPLY, root } from './support';

async function freePort(): Promise<number> {
  const server = createSocketServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// A Starlette host that mounts the real helper over the build under test, with a scripted agent. The
// packaged copy is not touched: other specs stage it, and two stagings must not meet.
const PYTHON_HOST = `
import json, mimetypes, pathlib, sys
import uvicorn
from starlette.applications import Starlette
from starlette.responses import Response, StreamingResponse
from starlette.routing import Route
import agui_inspector
from agui_inspector import Agent, Brand, mount_inspector

port, dist, options = int(sys.argv[1]), pathlib.Path(sys.argv[2]), json.loads(sys.argv[3])
agui_inspector._assets_root = lambda: dist

async def stream(request):
    run = await request.json()
    ids = {"threadId": run["threadId"], "runId": run["runId"]}
    events = [
        {"type": "RUN_STARTED", **ids},
        {"type": "TEXT_MESSAGE_START", "messageId": "m", "role": "assistant"},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m", "delta": ${JSON.stringify(AGENT_REPLY)}},
        {"type": "TEXT_MESSAGE_END", "messageId": "m"},
        {"type": "RUN_FINISHED", **ids, "outcome": {"type": "success"}},
    ]
    return StreamingResponse((f"data: {json.dumps(e)}\\n\\n" for e in events), media_type="text/event-stream")

async def asset(request):
    # The host's own route for a logo or a plugin module: the helper serves none.
    name = request.path_params["name"]
    return Response(options.get("assets", {}).get(name, ""), media_type=mimetypes.guess_type(name)[0] or "application/octet-stream")

app = Starlette(routes=[Route("/agents/demo/stream", stream, methods=["POST"]), Route("/static/{name}", asset)])
brand = options.get("brand")
mount_inspector(app, agents=[Agent(id="demo", name="Demo agent", url="/agents/demo/stream")], enabled=True, theme=options.get("theme"), brand=Brand(**brand) if brand is not None else None, plugins=options.get("plugins"))
uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
`;

export interface PythonOptions {
  readonly theme?: unknown;
  /** The `Brand` fields in Python's spelling (`logo_dark`). */
  readonly brand?: { name?: unknown; logo?: unknown; logo_dark?: unknown };
  /** Files the host serves from its own `/static/<name>` route, with the content type of the name: a logo or a plugin module. */
  readonly assets?: Record<string, string>;
  /** The `plugins` argument of `mount_inspector`: module addresses on the host's origin. */
  readonly plugins?: readonly string[];
}

export async function startPython(dist: string, options: PythonOptions = {}): Promise<{ origin: string; stop(): void }> {
  const port = await freePort();
  const child: ChildProcess = spawn(
    'uv',
    ['run', '--project', 'packages/python', '--locked', '--extra', 'embedded', '--group', 'test', 'python', '-c', PYTHON_HOST, String(port), dist, JSON.stringify(options)],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
  child.stdout?.resume();
  let exited = false;
  child.on('exit', () => (exited = true));
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 600; attempt++) {
    if (exited) throw new Error(`the Python host exited early:\n${stderr}`);
    if (await fetch(`${origin}/agui-inspector/config.json`).then((response) => response.ok, () => false)) return { origin, stop: () => void child.kill() };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`the Python host did not start:\n${stderr}`);
}

/** A generic static server: the build's files and one adjacent config.json, nothing else. */
export async function startStatic(dist: string, config: string, files: Record<string, { type: string; body: string }> = {}): Promise<{ origin: string; requested: string[]; close(): Promise<void> }> {
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const requested: string[] = [];
  const server: Server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://x');
    requested.push(pathname);
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    let body: string | Buffer | undefined;
    if (name === 'config.json') body = config;
    else if (files[pathname] !== undefined) body = files[pathname].body;
    else if (/^[\w.-]+$/.test(name)) {
      try {
        body = readFileSync(path.join(dist, name));
      } catch {
        body = undefined;
      }
    }
    if (body === undefined) return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': files[pathname]?.type ?? types[path.extname(name)] ?? 'text/html' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requested, close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
