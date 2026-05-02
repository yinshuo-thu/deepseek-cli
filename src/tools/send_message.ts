import type { Tool } from './types.js';

export const SendMessageTool: Tool = {
  requiresPermission: false,
  definition: {
    type: 'function',
    function: {
      name: 'SendMessage',
      description: 'Send a follow-up prompt to an existing subagent (resumes its conversation).',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          prompt: { type: 'string' },
          run_in_background: { type: 'boolean', default: false },
        },
        required: ['agent_id', 'prompt'],
      },
    },
  },
  async run(args, ctx) {
    if (!ctx.agentRuntime) {
      return { ok: false, content: 'SendMessage unavailable: no agentRuntime in context.' };
    }
    const agent_id = String(args?.agent_id ?? '').trim();
    const prompt = String(args?.prompt ?? '').trim();
    if (!agent_id || !prompt) return { ok: false, content: 'SendMessage: agent_id and prompt are required.' };
    const result = await ctx.agentRuntime.sendMessage({
      agentId: agent_id,
      prompt,
      runInBackground: Boolean(args?.run_in_background),
      parentCtx: ctx,
    });
    if (result.status === 'error') {
      return { ok: false, content: `SendMessage error: ${result.error ?? 'unknown'}` };
    }
    if (args?.run_in_background) {
      return { ok: true, content: JSON.stringify({ agent_id, status: 'running' }) };
    }
    return { ok: true, content: JSON.stringify({ agent_id, status: result.status, final_text: result.final_text ?? '' }) };
  },
};
