#!/usr/bin/env tsx
export interface ToolCall {
  tool: string;
  timestamp: number;
}

export interface ProcessMetrics {
  required_hit_rate: number;   // required tools that were used / total required
  sequence_score: number;      // 0-1, how well sequence matches preferred
  used_forbidden: boolean;
  tool_calls: string[];
}

export function evaluateProcess(
  toolCalls: ToolCall[],
  taskType: string,
  patterns: Record<string, any>
): ProcessMetrics {
  const pattern = patterns[taskType] ?? patterns['analysis'];
  const usedTools = toolCalls.map(t => t.tool);

  const required: string[] = pattern.required_tools ?? [];
  const forbidden: string[] = pattern.forbidden_tools ?? [];
  const preferred: string[] = pattern.preferred_sequence ?? [];

  const required_hit_rate = required.length === 0
    ? 1.0
    : required.filter(t => usedTools.includes(t)).length / required.length;

  const used_forbidden = forbidden.some(t => usedTools.includes(t));

  // Sequence score: count preferred tools appearing in correct relative order
  let seq_score = 1.0;
  if (preferred.length >= 1) {
    let lastIdx = -1;
    let matches = 0;
    for (const pt of preferred) {
      // pt may be "Edit|Write" meaning either
      const options = pt.split('|');
      const idx = usedTools.findIndex((t, i) => i > lastIdx && options.includes(t));
      if (idx > -1) { matches++; lastIdx = idx; }
    }
    seq_score = matches / preferred.length;
  }

  return { required_hit_rate, sequence_score: seq_score, used_forbidden, tool_calls: usedTools };
}
