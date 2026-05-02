import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { Tool } from './types.js';

const MAX_OUTPUT = 200; // lines

export const GrepTool: Tool = {
  requiresPermission: false,
  definition: {
    type: 'function',
    function: {
      name: 'Grep',
      description:
        'Search file contents for a regex pattern. Uses ripgrep if available, falls back to a JS implementation. Returns up to 200 matches.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern.' },
          path: { type: 'string', description: 'Optional path to search under.' },
          glob: { type: 'string', description: 'Optional glob filter for filenames (e.g. "*.ts").' },
          ignore_case: { type: 'boolean', default: false },
        },
        required: ['pattern'],
      },
    },
  },
  async run(args, ctx) {
    const pattern = String(args?.pattern ?? '');
    if (!pattern) return { ok: false, content: 'Error: pattern is required.' };
    const root = args?.path
      ? (isAbsolute(String(args.path)) ? String(args.path) : resolve(ctx.cwd, String(args.path)))
      : ctx.cwd;
    const ignoreCase = Boolean(args?.ignore_case);
    const glob = args?.glob ? String(args.glob) : null;

    const rg = await tryRipgrep(pattern, root, glob, ignoreCase);
    if (rg !== null) return { ok: true, content: rg };
    return { ok: true, content: await fallbackGrep(pattern, root, glob, ignoreCase) };
  },
};

function tryRipgrep(pattern: string, cwd: string, glob: string | null, ignoreCase: boolean): Promise<string | null> {
  return new Promise((resolveP) => {
    const args = ['--line-number', '--no-heading', '--color', 'never', '--max-count', '50'];
    if (ignoreCase) args.push('-i');
    if (glob) args.push('--glob', glob);
    args.push(pattern, cwd);
    const child = spawn('rg', args, { cwd });
    let out = '';
    let bytes = 0;
    child.stdout.on('data', (b) => {
      out += b.toString('utf8');
      bytes += b.length;
      if (bytes > 200_000) child.kill();
    });
    child.on('error', () => resolveP(null));
    child.on('close', (code) => {
      if (code === 127 || code === null) { resolveP(null); return; }
      const lines = out.split('\n').filter(Boolean).slice(0, MAX_OUTPUT);
      resolveP(lines.join('\n') || `no matches`);
    });
  });
}

async function fallbackGrep(pattern: string, root: string, glob: string | null, ignoreCase: boolean): Promise<string> {
  const re = new RegExp(pattern, ignoreCase ? 'i' : '');
  const filenameRe = glob ? globToRegExp(glob) : null;
  const matches: string[] = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache']);
  async function walk(dir: string): Promise<void> {
    if (matches.length >= MAX_OUTPUT) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        if (filenameRe && !filenameRe.test(e.name)) continue;
        let txt: string;
        try { txt = await fs.readFile(full, 'utf8'); } catch { continue; }
        const lines = txt.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i] ?? '')) {
            matches.push(`${full}:${i + 1}:${(lines[i] ?? '').slice(0, 200)}`);
            if (matches.length >= MAX_OUTPUT) return;
          }
        }
      }
    }
  }
  await walk(root);
  return matches.length ? matches.join('\n') : 'no matches';
}

function globToRegExp(pattern: string): RegExp {
  let re = '^';
  for (const c of pattern) {
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if ('.+()|^$\\{}[]'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp(re + '$');
}
