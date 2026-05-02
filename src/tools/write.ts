import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Tool } from './types.js';

const readBefore = new Set<string>();
export function markRead(absPath: string) { readBefore.add(absPath); }

export const WriteTool: Tool = {
  requiresPermission: true,
  definition: {
    type: 'function',
    function: {
      name: 'Write',
      description:
        'Writes a file to the local filesystem. Overwrites if it exists. If a file exists, you MUST Read it first.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  async run(args, ctx) {
    const path = String(args?.file_path ?? '');
    const content = String(args?.content ?? '');
    if (!path) return { ok: false, content: 'Error: file_path is required.' };
    const abs = isAbsolute(path) ? path : resolve(ctx.cwd, path);

    if (existsSync(abs) && !readBefore.has(abs)) {
      return { ok: false, content: `Error: ${abs} exists. Use Read first to acknowledge current contents.` };
    }

    const decision = await ctx.requestPermission('Write', `Write ${content.length} bytes → ${abs}`);
    if (decision === 'deny') return { ok: false, content: 'User denied Write.' };

    try {
      await fs.mkdir(dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
      markRead(abs);
      return { ok: true, content: `Wrote ${content.length} bytes to ${abs}.` };
    } catch (e) {
      return { ok: false, content: `Error writing ${abs}: ${(e as Error).message}` };
    }
  },
};
