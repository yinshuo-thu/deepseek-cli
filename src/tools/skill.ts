// Explicit Skill(name, args?) tool. Returns the matching skill body as the
// tool result content. If the skill defines `allowed-tools`, that scoping is
// communicated via the result text — actual scoping is handled by the
// triggering pipeline in App.tsx for the *next* turn.

import type { Tool } from './types.js';
import { loadSkills } from '../skills/loader.js';

export const SkillTool: Tool = {
  requiresPermission: false,
  definition: {
    type: 'function',
    function: {
      name: 'Skill',
      description:
        'Invoke a named skill. Returns the skill body as additional context. Use this when you recognise a task that matches a skill you already know exists.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name.' },
          args: { type: 'object', description: 'Optional arguments passed to the skill body.' },
        },
        required: ['name'],
      },
    },
  },
  async run(args, ctx) {
    const name = String(args?.name ?? '').trim();
    if (!name) return { ok: false, content: 'Error: name is required.' };
    const all = await loadSkills(ctx.cwd);
    const def = all.find((d) => d.name === name);
    if (!def) {
      const known = all.map((d) => d.name).join(', ');
      return { ok: false, content: `Unknown skill: ${name}. Known: ${known || '(none)'}` };
    }
    let extra = '';
    if (def.allowedTools && def.allowedTools.length) {
      extra = `\n\n(skill scopes available tools to: ${def.allowedTools.join(', ')})`;
    }
    return { ok: true, content: `<skill name="${def.name}">\n${def.body}\n</skill>${extra}` };
  },
};
