import type { Tool } from './types.js';

export const AgentTool: Tool = {
  requiresPermission: false,
  definition: {
    type: 'function',
    function: {
      name: 'Agent',
      description:
        'Spawn a subagent for a focused task. Foreground returns the final_text. Use run_in_background=true for long jobs and poll with Monitor.',
      parameters: {
        type: 'object',
        properties: {
          subagent_type: { type: 'string', description: 'e.g. general-purpose, Explore, Plan, or any project-defined agent.' },
          prompt: { type: 'string', description: 'Task description for the subagent.' },
          run_in_background: { type: 'boolean', default: false },
          isolation: { type: 'string', enum: ['none', 'worktree'], default: 'none' },
        },
        required: ['subagent_type', 'prompt'],
      },
    },
  },
  async run(args, ctx) {
    if (!ctx.agentRuntime) {
      return { ok: false, content: 'Agent tool unavailable: no agentRuntime in context.' };
    }
    const subagent_type = String(args?.subagent_type ?? '').trim();
    const prompt = String(args?.prompt ?? '').trim();
    if (!subagent_type || !prompt) {
      return { ok: false, content: 'Agent: subagent_type and prompt are required.' };
    }
    const result = await ctx.agentRuntime.spawn({
      subagentType: subagent_type,
      prompt,
      runInBackground: Boolean(args?.run_in_background),
      isolation: args?.isolation === 'worktree' ? 'worktree' : 'none',
      parentCtx: ctx,
    });
    if (result.status === 'error') {
      return { ok: false, content: `Agent error: ${result.error ?? 'unknown'}` };
    }
    if (args?.run_in_background) {
      return { ok: true, content: JSON.stringify({ agent_id: result.agent_id, status: 'running' }) };
    }
    const payload = {
      agent_id: result.agent_id,
      status: result.status,
      final_text: result.final_text ?? '',
      ...(result.worktree ? { worktree: result.worktree } : {}),
    };
    return { ok: true, content: JSON.stringify(payload) };
  },
};
