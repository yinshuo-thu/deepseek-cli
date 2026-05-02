import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Tool } from './types.js';

const HIDDEN_BY_DEFAULT = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache', '.venv', '__pycache__', '.DS_Store']);

export const ListDirTool: Tool = {
  requiresPermission: false,
  definition: {
    type: 'function',
    function: {
      name: 'list_dir',
      description:
        'Lists immediate contents of a directory. Returns directories first, then files, with sizes and entry counts. Skips heavyweight directories (node_modules, .git, dist, build) by default.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative directory. Defaults to cwd.' },
          show_hidden: { type: 'boolean', default: false, description: 'Include normally-hidden directories.' },
          depth: { type: 'integer', minimum: 1, maximum: 3, default: 1, description: 'Recursion depth (1–3).' },
        },
      },
    },
  },
  async run(args, ctx) {
    const path = args?.path
      ? (isAbsolute(String(args.path)) ? String(args.path) : resolve(ctx.cwd, String(args.path)))
      : ctx.cwd;
    if (!existsSync(path)) return { ok: false, content: `Directory not found: ${path}` };
    const showHidden = Boolean(args?.show_hidden);
    const depth = Math.max(1, Math.min(3, Number(args?.depth ?? 1)));
    const lines: string[] = [`${path}:`];
    await walk(path, '', depth, showHidden, lines);
    return { ok: true, content: lines.join('\n') };
  },
};

async function walk(dir: string, indent: string, depth: number, showHidden: boolean, out: string[]): Promise<void> {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (e) { out.push(`${indent}<error: ${(e as Error).message}>`); return; }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const e of entries) {
    if (!showHidden && HIDDEN_BY_DEFAULT.has(e.name)) continue;
    if (e.isDirectory()) {
      out.push(`${indent}${e.name}/`);
      if (depth > 1) await walk(join(dir, e.name), indent + '  ', depth - 1, showHidden, out);
    } else if (e.isFile()) {
      try {
        const st = await fs.stat(join(dir, e.name));
        out.push(`${indent}${e.name}  ${formatBytes(st.size)}`);
      } catch {
        out.push(`${indent}${e.name}`);
      }
    } else {
      out.push(`${indent}${e.name}  (special)`);
    }
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}M`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)}G`;
}
