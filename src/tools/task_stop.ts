import type { Tool } from './types.js';

export const TaskStopTool: Tool = {
  requiresPermission: false,
  definition: {
    type: 'function',
    function: {
      name: 'TaskStop',
      description: 'Stop a running subagent. Already-stopped agents return their final status.',
      parameters: {
        type: 'object',
        properties: { agent_id: { type: 'string' } },
        required: ['agent_id'],
      },
    },
  },
  async run(args, ctx) {
    if (!ctx.agentRuntime) return { ok: false, content: 'TaskStop unavailable: no agentRuntime in context.' };
    const agent_id = String(args?.agent_id ?? '').trim();
    if (!agent_id) return { ok: false, content: 'TaskStop: agent_id is required.' };
    const r = ctx.agentRuntime.taskStop({ agentId: agent_id });
    return { ok: true, content: JSON.stringify(r) };
  },
};
