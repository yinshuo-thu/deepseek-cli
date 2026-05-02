// Hook system types — settings.json-driven shell hooks fired at lifecycle
// boundaries by the agent loop.

export type HookEventName = 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop';

export interface HookSpec {
  event: HookEventName;
  /** Optional regex string compiled as ^(?:matcher)$ against tool name (PreToolUse/PostToolUse). */
  matcher?: string;
  /** Shell command, run via /bin/sh -c. */
  command: string;
  /** PreToolUse only: non-zero exit → block tool when true. */
  exit_blocks_tool?: boolean;
  /** Per-hook timeout in ms; default 5000. */
  timeoutMs?: number;
  /** Whether this came from the user's ~/.deepseek/settings.json or project .deepseek/settings.json. */
  source: 'user' | 'project';
  /** Whether this hook is currently enabled. Project hooks default disabled until trusted. */
  enabled: boolean;
}

export interface HookEvent {
  /** The event name. */
  event: HookEventName;
  /** Arbitrary structured payload — serialised as JSON to the hook's stdin. */
  payload: Record<string, unknown>;
}

export interface HookRunResult {
  spec: HookSpec;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  error?: string;
}

export interface HookAggregate {
  results: HookRunResult[];
  /** True if PreToolUse and any blocking hook denied. */
  blocked: boolean;
  /** Reason for block if blocked=true. */
  blockReason?: string;
  /** Optional rewrite payload from a UserPromptSubmit hook. */
  rewrite?: string;
}
