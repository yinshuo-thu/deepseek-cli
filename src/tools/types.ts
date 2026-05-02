import type { ToolDefinition } from '../api/types.js';

export interface ToolContext {
  cwd: string;
  /**
   * Asks the user for permission to run a sensitive operation.
   * Returns one of: 'once' (allow this call), 'always' (allow & remember),
   * 'deny'.
   */
  requestPermission(toolName: string, summary: string): Promise<'once' | 'always' | 'deny'>;
  /** Emit a status line to the UI — used for long-running tools. */
  log(line: string): void;
  /** Per-instance "files this agent has Read" set. Used by Write/Edit guards. */
  readFiles?: Set<string>;
  /** Subagent fields — undefined for top-level. */
  agentId?: string;
  parentId?: string;
  depth?: number;
  /** Subagent runtime hooks — populated by spawn for the Agent/SendMessage/Monitor/TaskStop tools. */
  agentRuntime?: AgentRuntime;
  /** AbortSignal for the current loop; tools may consult it for long ops. */
  signal?: AbortSignal;
}

// Forward-declared to avoid a circular import; the registry module owns the
// implementation details.
export interface AgentRuntime {
  spawn(opts: {
    subagentType: string;
    prompt: string;
    runInBackground?: boolean;
    isolation?: 'none' | 'worktree';
    parentCtx: ToolContext;
  }): Promise<{ agent_id: string; final_text?: string; status: string; error?: string; worktree?: { path: string; branch: string; kept: boolean } }>;
  sendMessage(opts: { agentId: string; prompt: string; runInBackground?: boolean; parentCtx: ToolContext }): Promise<{ agent_id: string; final_text?: string; status: string; error?: string }>;
  monitor(opts: { agentId: string; sinceLine?: number; maxLines?: number }): { status: string; lines: string[]; next_cursor: number; final_text?: string };
  taskStop(opts: { agentId: string }): { stopped: boolean; status: string };
}

export interface ToolResult {
  ok: boolean;
  /** String content surfaced back to the model. */
  content: string;
  /** Optional rich preview for the TUI (markdown). */
  preview?: string;
  /** True if the tool should be marked as "dangerous" in audit logs. */
  sensitive?: boolean;
}

export interface Tool {
  /** Definition emitted to the model in the tools[] array. */
  definition: ToolDefinition;
  /** Whether this tool requires permission before each invocation. */
  requiresPermission: boolean;
  /** Execute the tool with parsed args. */
  run(args: any, ctx: ToolContext): Promise<ToolResult>;
}
