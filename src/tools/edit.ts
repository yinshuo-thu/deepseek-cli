import { promises as fs } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Tool } from './types.js';
import { markRead } from './write.js';

export const EditTool: Tool = {
  requiresPermission: true,
  definition: {
    type: 'function',
    function: {
      name: 'Edit',
      description:
        'Performs an exact-string replacement in a file. old_string must appear exactly once unless replace_all=true. The file must have been Read first.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
          replace_all: { type: 'boolean', default: false },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  async run(args, ctx) {
    const path = String(args?.file_path ?? '');
    const oldStr = String(args?.old_string ?? '');
    const newStr = String(args?.new_string ?? '');
    const replaceAll = Boolean(args?.replace_all);
    if (!path || oldStr === newStr) {
      return { ok: false, content: 'Error: file_path and a non-trivial old/new string pair are required.' };
    }
    const abs = isAbsolute(path) ? path : resolve(ctx.cwd, path);
    let raw: string;
    try { raw = await fs.readFile(abs, 'utf8'); }
    catch (e) { return { ok: false, content: `Error reading ${abs}: ${(e as Error).message}` };}

    const occurrences = countOccurrences(raw, oldStr);
    if (occurrences === 0) return { ok: false, content: `old_string not found in ${abs}.` };
    if (occurrences > 1 && !replaceAll) {
      return { ok: false, content: `old_string appears ${occurrences} times. Either disambiguate it with more context or set replace_all=true.` };
    }

    const decision = await ctx.requestPermission('Edit', `Edit ${abs} (${occurrences} replacement${occurrences > 1 ? 's' : ''})`);
    if (decision === 'deny') return { ok: false, content: 'User denied Edit.' };

    const next = replaceAll ? raw.split(oldStr).join(newStr) : raw.replace(oldStr, newStr);
    try {
      await fs.writeFile(abs, next, 'utf8');
      markRead(abs, ctx);
      return {
        ok: true,
        content: `Edited ${abs}: replaced ${occurrences} occurrence${occurrences > 1 ? 's' : ''}.`,
      };
    } catch (e) {
      return { ok: false, content: `Error writing ${abs}: ${(e as Error).message}` };
    }
  },
};

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
