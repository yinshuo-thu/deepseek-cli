// Runs hooks for a given event. Spawns each command via /bin/sh -c, writes
// the JSON event payload to the child's stdin, captures stdout (capped at
// 1MB), and enforces a default 5s timeout (SIGTERM, then SIGKILL after 2s).
//
// Multiple hooks fire in [user..., project...] order — preserved by the
// settings loader. For PreToolUse, ANY blocking exit denies (deny wins).

import { execFile } from 'node:child_process';
import { loadHooks } from './settings.js';
import type { HookEventName, HookRunResult, HookAggregate, HookSpec } from './types.js';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_STDOUT = 1024 * 1024;

function matches(spec: HookSpec, toolName?: string): boolean {
  if (!spec.matcher) return true;
  if (spec.event !== 'PreToolUse' && spec.event !== 'PostToolUse') return true;
  if (!toolName) return false;
  try {
    return new RegExp('^(?:' + spec.matcher + ')$').test(toolName);
  } catch {
    return false;
  }
}

interface RunHookOpts {
  spec: HookSpec;
  payload: Record<string, unknown>;
  cwd: string;
  signal?: AbortSignal;
}

export function runSingleHook(opts: RunHookOpts): Promise<HookRunResult> {
  const { spec, payload, cwd, signal } = opts;
  const start = Date.now();
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolveP) => {
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    let stdoutOver = 0;
    const child = execFile('/bin/sh', ['-c', spec.command], {
      cwd,
      env: { ...process.env, DEEPSEEK_HOOK_EVENT: spec.event },
      maxBuffer: MAX_STDOUT,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
    }, timeoutMs);

    const onAbort = () => {
      try { child.kill('SIGTERM'); } catch {}
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (stdout.length + s.length > MAX_STDOUT) {
        stdout += s.slice(0, MAX_STDOUT - stdout.length);
        stdoutOver++;
      } else {
        stdout += s;
      }
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (stderr.length + s.length <= MAX_STDOUT) stderr += s;
    });

    // Write payload to stdin and close.
    try {
      child.stdin?.write(JSON.stringify(payload));
      child.stdin?.end();
    } catch { /* best effort */ }

    child.on('error', (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolveP({
        spec,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        timedOut,
        error: err.message,
      });
    });

    child.on('close', (code, sig) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (stdoutOver > 0) stderr += `\n[hook stdout truncated at ${MAX_STDOUT} bytes]`;
      resolveP({
        spec,
        exitCode: code,
        signal: sig,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        timedOut,
      });
    });
  });
}

/**
 * Fire all matching, enabled hooks for a given event. Returns aggregated
 * blocking + rewrite info. PreToolUse: any blocking non-zero exit denies.
 * UserPromptSubmit: first hook whose stdout parses to {rewrite: string} wins.
 */
export async function runHooks(opts: {
  event: HookEventName;
  payload: Record<string, unknown>;
  cwd: string;
  toolName?: string;
  signal?: AbortSignal;
}): Promise<HookAggregate> {
  const { event, payload, cwd, toolName, signal } = opts;
  const { hooks } = await loadHooks(cwd);
  const matchedFiltered = hooks.filter((h) => h.event === event && h.enabled && matches(h, toolName));
  const results: HookRunResult[] = [];
  let blocked = false;
  let blockReason: string | undefined;
  let rewrite: string | undefined;
  for (const spec of matchedFiltered) {
    const r = await runSingleHook({ spec, payload, cwd, signal });
    results.push(r);
    if (event === 'PreToolUse' && spec.exit_blocks_tool && r.exitCode !== 0) {
      blocked = true;
      blockReason = blockReason ?? (r.stderr.trim() || `Hook ${spec.command} exited ${r.exitCode}`);
    }
    if (event === 'UserPromptSubmit' && rewrite === undefined) {
      const trimmed = r.stdout.trim();
      if (trimmed.startsWith('{')) {
        try {
          const j = JSON.parse(trimmed);
          if (j && typeof j.rewrite === 'string') rewrite = j.rewrite;
        } catch { /* not JSON, ignore */ }
      }
    }
  }
  return { results, blocked, blockReason, rewrite };
}
