// Local auth server. Loopback only; no Express, just node:http.
//
// startAuthServer() returns immediately with a URL the caller can open in a
// browser, plus an awaitResult promise that resolves once the user posts a
// valid cookie (or rejects on timeout). The caller is responsible for
// `close()`-ing the server when the flow is finished.
//
// /authorize/submit accepts CORS POSTs from chat.deepseek.com so the JS
// console snippet running in the DeepSeek tab can post the cookie cross-origin.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { authorizePage } from './page.js';
import { DSWebClient } from './dswebClient.js';
import { OpenAIProxy } from './proxy.js';
import { saveSession, type WebSession } from './session.js';
import { validateCookie } from './validate.js';

export interface AuthResult {
  session: WebSession;
}

export interface AuthServerHandle {
  url: string;
  awaitResult: Promise<AuthResult>;
  close: () => void;
}

const PREFERRED_PORT = 31337;
const TIMEOUT_MS = 5 * 60 * 1000;
const DS_ORIGIN = 'https://chat.deepseek.com';

async function listenOn(server: Server, port: number, host: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('failed to read bound port'));
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

const MAX_BODY_BYTES = 16 * 1024;

class BodyTooLargeError extends Error {
  constructor() {
    super('request body exceeded 16 KB cap');
    this.name = 'BodyTooLargeError';
  }
}

async function readBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      if (aborted) return;
      total += c.length;
      if (total > maxBytes) {
        aborted = true;
        try { req.socket.destroy(); } catch { /* ignore */ }
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (aborted) return;
      reject(err);
    });
  });
}

function parseSubmission(contentType: string | undefined, body: string): { cookie?: string } {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('application/json')) {
    try {
      const parsed = JSON.parse(body) as { cookie?: unknown };
      if (typeof parsed.cookie === 'string') return { cookie: parsed.cookie };
    } catch {
      // fall through
    }
    return {};
  }
  // default: urlencoded (used by the JS bookmarklet / form submit)
  const params = new URLSearchParams(body);
  const cookie = params.get('cookie');
  return cookie ? { cookie } : {};
}

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

/**
 * Add CORS headers for the /authorize/submit endpoint.
 * We allow chat.deepseek.com as origin so the JS console snippet can POST
 * the cookie cross-origin without any browser security block.
 */
function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin ?? '';
  // Allow the DeepSeek website and localhost origins.
  if (origin === DS_ORIGIN || origin.startsWith('http://127.0.0.1') || origin.startsWith('http://localhost')) {
    res.setHeader('access-control-allow-origin', origin);
  } else {
    res.setHeader('access-control-allow-origin', DS_ORIGIN);
  }
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-max-age', '86400');
}

export async function startAuthServer(): Promise<AuthServerHandle> {
  let resolveResult!: (r: AuthResult) => void;
  let rejectResult!: (err: Error) => void;
  const awaitResult = new Promise<AuthResult>((res, rej) => {
    resolveResult = res;
    rejectResult = rej;
  });

  let settled = false;
  let authed = false;
  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    fn();
  };

  // Port is chosen at listen time; we need it for the page's submitUrl.
  let boundPort = PREFERRED_PORT;

  const server = createServer(async (req, res) => {
    try {
      const url = req.url ?? '/';
      const method = (req.method ?? 'GET').toUpperCase();

      // CORS preflight for /authorize/submit.
      if (method === 'OPTIONS' && url === '/authorize/submit') {
        setCorsHeaders(req, res);
        res.statusCode = 204;
        res.end();
        return;
      }

      if (method === 'GET' && url === '/healthz') {
        // Return 'authed' after a successful submit so the polling JS in the
        // authorize page can detect completion without a page reload.
        send(res, 200, 'text/plain; charset=utf-8', authed ? 'authed' : 'ok');
        return;
      }

      if (method === 'GET' && (url === '/' || url === '/authorize')) {
        const submitUrl = `http://127.0.0.1:${boundPort}/authorize/submit`;
        send(res, 200, 'text/html; charset=utf-8', authorizePage({}, submitUrl));
        return;
      }

      if (method === 'POST' && url === '/authorize/submit') {
        setCorsHeaders(req, res);
        let body: string;
        try {
          body = await readBody(req);
        } catch (err) {
          if (err instanceof BodyTooLargeError) {
            try { send(res, 413, 'text/plain; charset=utf-8', 'payload too large'); } catch { /* socket may be dead */ }
            try { req.socket.destroy(); } catch { /* ignore */ }
            return;
          }
          throw err;
        }
        const { cookie } = parseSubmission(req.headers['content-type'], body);
        if (!cookie || !cookie.trim()) {
          send(res, 400, 'text/html; charset=utf-8', authorizePage({ error: 'Cookie was empty. Paste the full Cookie header.' }));
          return;
        }
        const validated = await validateCookie(cookie);
        if (!validated) {
          send(res, 401, 'text/html; charset=utf-8', authorizePage({ error: 'That cookie did not validate. Make sure you are logged in to chat.deepseek.com and try again.' }));
          return;
        }
        const session: WebSession = {
          cookie: cookie.trim(),
          userId: validated.userId,
          email: validated.email,
          createdAt: Date.now(),
        };
        await saveSession(session);
        authed = true;
        send(res, 200, 'text/html; charset=utf-8', authorizePage({ success: true }));
        settle(() => resolveResult({ session }));
        return;
      }

      send(res, 404, 'text/plain; charset=utf-8', 'not found');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try { send(res, 500, 'text/plain; charset=utf-8', `error: ${msg}`); } catch { /* ignore */ }
    }
  });

  try {
    boundPort = await listenOn(server, PREFERRED_PORT, '127.0.0.1');
  } catch {
    boundPort = await listenOn(server, 0, '127.0.0.1');
  }

  const url = `http://127.0.0.1:${boundPort}/authorize`;

  const timeout = setTimeout(() => {
    settle(() => rejectResult(new Error('Login timed out after 5 minutes — no cookie submitted.')));
    try { server.close(); } catch { /* ignore */ }
  }, TIMEOUT_MS);
  if (typeof timeout.unref === 'function') timeout.unref();

  const close = () => {
    clearTimeout(timeout);
    try { server.close(); } catch { /* ignore */ }
  };

  return { url, awaitResult, close };
}

export interface ProxyServerHandle {
  url: string;
  port: number;
  close: () => void;
}

/**
 * Mount the OpenAI-compatible proxy on a fresh local server. The CLI points
 * `DeepSeekClient`'s baseUrl at the returned URL after a successful /login.
 */
export async function startProxyServer(session: WebSession): Promise<ProxyServerHandle> {
  const client = new DSWebClient(session);
  const proxy = new OpenAIProxy(client);

  const server = createServer(async (req, res) => {
    try {
      if ((req.method ?? 'GET').toUpperCase() === 'GET' && req.url === '/healthz') {
        send(res, 200, 'text/plain; charset=utf-8', 'ok');
        return;
      }
      await proxy.handle(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: { message: msg, type: 'server_error' } }));
      } catch { /* ignore */ }
    }
  });

  // Always pick an ephemeral port for the proxy: the auth server may still be
  // bound to :31337 when /login completes.
  const port = await listenOn(server, 0, '127.0.0.1');
  const proxyUrl = `http://127.0.0.1:${port}/v1`;

  const closeProxy = () => {
    try { server.close(); } catch { /* ignore */ }
  };

  return { url: proxyUrl, port, close: closeProxy };
}
