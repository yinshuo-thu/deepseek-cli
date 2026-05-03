/**
 * Trace Collector — records tool call traces during a benchmark run.
 *
 * For non-agent runs (direct chat completions), tool_calls will be empty.
 * For agent loop runs, tool calls are captured from the loop's callbacks.
 */

export interface ToolCallTrace {
  tool: string;
  args: Record<string, unknown>;
  timestamp: number;
  duration_ms: number;
}

export interface RunTrace {
  problem_id: string;
  model_response: string;
  tool_calls: ToolCallTrace[];
  total_duration_ms: number;
}

export function createTraceCollector(): {
  onToolCall: (tool: string, args: Record<string, unknown>) => void;
  onToolResult: (tool: string, duration_ms: number) => void;
  getTrace: () => ToolCallTrace[];
  reset: () => void;
} {
  const calls: ToolCallTrace[] = [];
  const pending: Map<string, { tool: string; args: Record<string, unknown>; start: number }> = new Map();

  return {
    onToolCall(tool, args) {
      const key = `${tool}-${Date.now()}`;
      pending.set(key, { tool, args, start: Date.now() });
      calls.push({ tool, args, timestamp: Date.now(), duration_ms: 0 });
    },
    onToolResult(tool, duration_ms) {
      const call = calls.findLast(c => c.tool === tool && c.duration_ms === 0);
      if (call) call.duration_ms = duration_ms;
    },
    getTrace: () => [...calls],
    reset: () => {
      calls.length = 0;
      pending.clear();
    },
  };
}
