import { promises as fs } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Tool } from './types.js';

export const ReadTool: Tool = {
  requiresPermission: false,
  definition: {
    type: 'function',
    function: {
      name: 'Read',
      description:
        'Reads a file from the local filesystem. Provide an absolute path. Returns up to 2000 lines starting at offset (0-indexed). Use offset+limit for large files.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path of the file to read.' },
          offset: { type: 'integer', minimum: 0, description: '0-indexed line to start at.' },
          limit: { type: 'integer', minimum: 1, description: 'Max lines to return (default 2000).' },
        },
        required: ['file_path'],
      },
    },
  },
  async run(args, ctx) {
    const path = String(args?.file_path ?? '');
    if (!path) return { ok: false, content: 'Error: file_path is required.' };
    const abs = isAbsolute(path) ? path : resolve(ctx.cwd, path);
    let raw: string;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch (e) {
      return { ok: false, content: `Error reading ${abs}: ${(e as Error).message}` };
    }
    if (raw === '') return { ok: true, content: `<file is empty: ${abs}>` };
    const lines = raw.split('\n');
    const offset = Math.max(0, Number(args?.offset ?? 0));
    const limit = Math.max(1, Number(args?.limit ?? 2000));
    const slice = lines.slice(offset, offset + limit);
    const numbered = slice
      .map((ln, i) => `${String(offset + i + 1).padStart(6, ' ')}\t${ln}`)
      .join('\n');
    const tail = offset + slice.length < lines.length
      ? `\n<truncated: showing ${slice.length} of ${lines.length} lines, next offset=${offset + slice.length}>`
      : '';
    return { ok: true, content: numbered + tail };
  },
};
