import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { SessionController, SessionRegistry, ProjectRegistry } from '@vessel/application';
import type { SessionPermission } from '@vessel/application';
import { MockProvider } from '@vessel/llm';
import type { SessionMeta } from '@vessel/application';

/**
 * SessionController factory. The server never composes a session itself — that
 * is the application layer's job. Callers (tests / CLI / future web) inject an
 * optional factory; when omitted the server builds a smoke controller backed by
 * the deterministic MockProvider so `vessel serve` works offline with zero
 * external dependencies.
 */
export type SessionFactory = (input: {
  workspaceRoot: string;
  provider?: string;
  model?: string;
  permission?: SessionPermission;
  registry?: SessionRegistry;
}) => Promise<SessionController>;

export interface VesselServerOptions {
  /** port to bind; defaults to 5678. Pass 0 for a random free port (tests). */
  port?: number;
  projectRegistry?: ProjectRegistry;
  sessionRegistry?: SessionRegistry;
  /** directory to serve static assets from; defaults to <package>/public */
  staticDir?: string;
  /** provider label → wired ChatProvider (see notes in default session factory). */
  providers?: Record<string, { providerLabel?: string; model?: string }>;
  /** session factory override (defaults to a mock-backed smoke controller). */
  sessionFactory?: SessionFactory;
}

export interface VesselServer {
  /** Start listening. Resolves once the underlying http server is bound. */
  listen(): Promise<VesselServer>;
  /** Close the http server and all live sessions. */
  close(): Promise<void>;
  /** the bound port (useful when started with port 0) */
  readonly port: number;
}

const DEFAULT_PORT = 5678;
const VERSION = '0.10.0';

/** repo root resolved from this file (apps/local-server/src/server.ts → up 3). */
const PKG_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(PKG_DIR, '..', '..', '..');
const DEFAULT_POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const DEFAULT_BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');
const DEFAULT_STATIC = path.join(PKG_DIR, '..', 'public');

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/**
 * Simple request-body reader: read the whole stream, parse JSON. Returns null on
 * empty/undecodable bodies so handlers can respond with a 400.
 */
async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Split a URL pathname into segments (`/api/sessions/abc` → ['api','sessions','abc']). */
function segment(pathname: string): string[] {
  return pathname.split('/').filter((s) => s.length > 0);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

export function createVesselServer(opts: VesselServerOptions = {}): VesselServer {
  const port = opts.port ?? DEFAULT_PORT;
  const staticDir = path.resolve(opts.staticDir ?? DEFAULT_STATIC);
  const projectRegistry = opts.projectRegistry ?? new ProjectRegistry();
  const sessionRegistry = opts.sessionRegistry ?? new SessionRegistry();
  const defaultFactory: SessionFactory = async (input) => {
    const provider = new MockProvider([{ when: /.*/, response: { text: `(mock) ${input.model ?? 'default'}` } }], {
      model: input.model ?? 'default',
    });
    return SessionController.create({
      workspaceRoot: input.workspaceRoot,
      provider,
      model: input.model ?? 'default',
      policySystemPath: DEFAULT_POLICY,
      behaviorIRPath: DEFAULT_BEHAVIOR,
      permission: input.permission ?? 'workspace-write',
      registry: input.registry,
    });
  };
  const sessionFactory = opts.sessionFactory ?? defaultFactory;

  /** live session controllers keyed by session id (owns the run loop). */
  const controllers = new Map<string, SessionController>();

  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      if (res.writableEnded) return;
      json(res, 500, { error: 'internal_error', message: err instanceof Error ? err.message : String(err) });
    });
  });

  server.on('error', (err) => {
    // surface bind failures (e.g. 5678 taken) to the caller via attachment below
    server.emit('vessel:error', err);
  });

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const segs = segment(url.pathname);

    // API namespace
    if (segs[0] === 'api') {
      return handleApi(method, segs, req, res);
    }
    // everything else → static assets
    return serveStatic(url.pathname, res);
  }

  async function handleApi(method: string, segs: string[], req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // GET /api/health
    if (segs.length === 2 && segs[1] === 'health' && method === 'GET') {
      return json(res, 200, { ok: true, version: VERSION });
    }

    // GET /api/projects
    if (segs.length === 2 && segs[1] === 'projects' && method === 'GET') {
      return json(res, 200, { projects: projectRegistry.list() });
    }

    // POST /api/projects/open
    if (segs.length === 3 && segs[1] === 'projects' && segs[2] === 'open' && method === 'POST') {
      const body = (await readJsonBody(req)) as { workspaceRoot?: string } | null;
      if (!body) return json(res, 400, { error: 'bad_json' });
      if (!body.workspaceRoot) return json(res, 400, { error: 'missing_workspaceRoot' });
      try {
        const project = projectRegistry.open(body.workspaceRoot);
        return json(res, 200, { project });
      } catch (err) {
        return json(res, 400, { error: 'open_failed', message: err instanceof Error ? err.message : String(err) });
      }
    }

    // GET /api/sessions
    if (segs.length === 2 && segs[1] === 'sessions' && method === 'GET') {
      return json(res, 200, { sessions: sessionRegistry.list() });
    }

    // POST /api/sessions
    if (segs.length === 2 && segs[1] === 'sessions' && method === 'POST') {
      const body = (await readJsonBody(req)) as {
        workspaceRoot?: string;
        provider?: string;
        model?: string;
        permission?: SessionPermission;
      } | null;
      if (!body) return json(res, 400, { error: 'bad_json' });
      if (!body.workspaceRoot) return json(res, 400, { error: 'missing_workspaceRoot' });
      try {
        const ctl = await sessionFactory({
          workspaceRoot: body.workspaceRoot,
          provider: body.provider,
          model: body.model,
          permission: body.permission,
          registry: sessionRegistry,
        });
        controllers.set(ctl.sessionId, ctl);
        const meta = sessionRegistry.get(ctl.sessionId);
        return json(res, 201, { session: (meta ?? ctl.state) });
      } catch (err) {
        return json(res, 400, { error: 'session_create_failed', message: err instanceof Error ? err.message : String(err) });
      }
    }

    // /api/sessions/:id/...
    if (segs.length >= 3 && segs[1] === 'sessions') {
      const id = segs[2] ?? '';
      const sub = segs[3];
      const ctl = controllers.get(id);

      // GET /api/sessions/:id
      if (segs.length === 3 && method === 'GET') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        return json(res, 200, { session: ctl.state });
      }

      // POST /api/sessions/:id/turns
      if (segs.length === 4 && sub === 'turns' && method === 'POST') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        const body = (await readJsonBody(req)) as { prompt?: string } | null;
        if (!body || typeof body.prompt !== 'string' || body.prompt.trim() === '') {
          return json(res, 400, { error: 'missing_prompt' });
        }
        try {
          const result = await ctl.runTurn(body.prompt);
          return json(res, 200, {
            finalText: result.finalText,
            kind: result.kind,
            steps: result.steps,
            turnId: result.turnId,
          });
        } catch (err) {
          return json(res, 500, { error: 'turn_failed', message: err instanceof Error ? err.message : String(err) });
        }
      }

      // POST /api/sessions/:id/interrupt
      if (segs.length === 4 && sub === 'interrupt' && method === 'POST') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        ctl.interrupt();
        return json(res, 200, { ok: true });
      }

      // POST /api/sessions/:id/steer
      if (segs.length === 4 && sub === 'steer' && method === 'POST') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        const body = (await readJsonBody(req)) as { message?: string } | null;
        if (!body || typeof body.message !== 'string') {
          return json(res, 400, { error: 'missing_message' });
        }
        ctl.steer(body.message);
        return json(res, 200, { ok: true, pendingSteerCount: ctl.pendingSteerCount });
      }

      // GET /api/sessions/:id/events → SSE
      if (segs.length === 4 && sub === 'events' && method === 'GET') {
        if (!ctl) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(suggestNotFound(id)));
          return;
        }
        return streamEvents(ctl, req, res);
      }

      return json(res, 404, { error: 'not_found' });
    }

    return json(res, 404, { error: 'not_found' });
  }

  function streamEvents(ctl: SessionController, req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, SSE_HEADERS);
    res.write(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`);

    const forwards = new Map<string, () => void>();
    const forward = (type: string) => {
      const off = ctl.bus.on(type, (payload) => {
        // best-effort; responder may already be closed
        res.write(`data: ${JSON.stringify({ type, payload, ts: Date.now() })}\n\n`);
      }, `local-server:sse:${type}`);
      forwards.set(type, off);
    };
    forward('after_turn');
    forward('after_model');

    const heartbeat = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`);
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      for (const off of forwards.values()) off();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  function suggestNotFound(id: string): { error: string; sessionId: string } {
    return { error: 'session_not_found', sessionId: id };
  }

  function serveStatic(pathname: string, res: http.ServerResponse): void {
    let file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    // prevent path traversal
    const safe = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '');
    const target = path.join(staticDir, safe);
    if (!target.startsWith(staticDir + path.sep) && target !== staticDir) {
      return json(res, 403, { error: 'forbidden' });
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return json(res, 404, { error: 'not_found' });
    }
    const ext = path.extname(target).toLowerCase();
    const mime =
      ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.js' ? 'text/javascript; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8'
      : ext === '.json' ? 'application/json'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.png' ? 'image/png'
      : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(target).pipe(res);
  }

  const vesselServer: VesselServer = {
    port,
    async listen() {
      server.listen(port, '127.0.0.1');
      await once(server, 'listening');
      const addr = server.address();
      (vesselServer as { port: number }).port = typeof addr === 'object' && addr ? addr.port : port;
      return vesselServer;
    },
    async close() {
      for (const ctl of controllers.values()) {
        try {
          await ctl.close();
        } catch {
          // best-effort close of a live session
        }
      }
      controllers.clear();
      if (server.listening) {
        server.close();
        await once(server, 'close');
      }
    },
  };

  return vesselServer;
}

export { VERSION };
export type { SessionMeta };