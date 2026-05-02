// Top-level orchestrators for /login, /logout, /whoami slash commands.
//
// M2.0 step 2: after a successful /login we additionally spin up a local
// OpenAI-compatible proxy backed by the user's web session. The CLI swaps
// `baseUrl` to the proxy URL and keeps using the existing DeepSeekClient.

import { startAuthServer, startProxyServer, type ProxyServerHandle } from '../auth/server.js';
import { clearSession, loadSession } from '../auth/session.js';

export interface LoginFlowOptions {
  /**
   * Called as soon as the local auth server is up so the TUI can show the URL
   * to the user before we try to open a browser. Optional.
   */
  onUrl?: (url: string) => void;
}

export interface FlowResult {
  ok: boolean;
  message: string;
  /** When ok and proxy started, the local OpenAI-compatible base URL. */
  proxyUrl?: string;
}

let activeProxy: ProxyServerHandle | null = null;

export function getActiveProxy(): ProxyServerHandle | null {
  return activeProxy;
}

export function stopActiveProxy(): void {
  if (!activeProxy) return;
  try { activeProxy.close(); } catch { /* ignore */ }
  activeProxy = null;
}

export async function loginFlow(opts: LoginFlowOptions = {}): Promise<FlowResult> {
  let handle: Awaited<ReturnType<typeof startAuthServer>> | null = null;
  try {
    handle = await startAuthServer();
    opts.onUrl?.(handle.url);

    // Best-effort browser open. open is in package.json.
    try {
      const mod: any = await import('open');
      const opener = (mod && (mod.default ?? mod)) as ((u: string) => Promise<unknown>);
      if (typeof opener === 'function') {
        await opener(handle.url);
      }
    } catch {
      // If `open` isn't available we still printed the URL; user can click it.
    }

    const result = await handle.awaitResult;

    // Tear down any stale proxy from a prior /login invocation.
    stopActiveProxy();

    let proxyUrl: string | undefined;
    try {
      const proxy = await startProxyServer(result.session);
      activeProxy = proxy;
      proxyUrl = proxy.url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: true,
        message: `logged in as ${result.session.userId}, but failed to start local proxy: ${msg}`,
      };
    }

    return {
      ok: true,
      message: `logged in as ${result.session.userId}; local proxy at ${proxyUrl}`,
      proxyUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `login failed: ${msg}` };
  } finally {
    handle?.close();
  }
}

export async function logoutFlow(): Promise<FlowResult> {
  try {
    stopActiveProxy();
    await clearSession();
    return { ok: true, message: 'logged out — web session cleared.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `logout failed: ${msg}` };
  }
}

export async function whoamiFlow(): Promise<FlowResult> {
  const session = await loadSession();
  if (session) {
    const who = session.email ? `${session.email} (${session.userId})` : session.userId;
    return {
      ok: true,
      message: `auth: web session — ${who}\n(cookie persisted ${new Date(session.createdAt).toISOString()})`,
    };
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return { ok: true, message: 'auth: API key from $DEEPSEEK_API_KEY (env)' };
  }
  return { ok: true, message: 'auth: API key from ~/.deepseek/config.json (or none configured)' };
}
