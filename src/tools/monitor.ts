import type { Tool } from './types.js';

export const MonitorTool: Tool = {
  requiresPermission: false,
  definition: {
    type: 'function',
    function: {
      name: 'Monitor',
      description: 'Read the latest output lines from a running (or recently finished) subagent.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          since_line: { type: 'integer', minimum: 0, default: 0 },
          max_lines: { type: 'integer', minimum: 1, maximum: 256, default: 100 },
        },
        required: ['agent_id'],
      },
    },
  },
  async run(args, ctx) {
    if (!ctx.agentRuntime) return { ok: false, content: 'Monitor unavailable: no agentRuntime in context.' };
    const agent_id = String(args?.agent_id ?? '').trim();
    if (!agent_id) return { ok: false, content: 'Monitor: agent_id is required.' };
    const r = ctx.agentRuntime.monitor({
      agentId: agent_id,
      sinceLine: Number(args?.since_line ?? 0),
      maxLines: Number(args?.max_lines ?? 100),
    });
    return { ok: true, content: JSON.stringify(r) };
  },
};
