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
