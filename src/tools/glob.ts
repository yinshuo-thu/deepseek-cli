import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Tool } from './types.js';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '.venv', '__pycache__']);
const MAX_RESULTS = 200;

export const GlobTool: Tool = {
  requiresPermission: false,
  definition: {
    type: 'function',
    function: {
      name: 'Glob',
      description:
        'Find files matching a glob pattern (supports * ** ? [abc]). Returns up to 200 matches sorted by mtime descending. Skips node_modules, .git, dist, build by default.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern, e.g. "src/**/*.ts" or "**/*.md".' },
          path: { type: 'string', description: 'Optional root directory. Defaults to cwd.' },
        },
        required: ['pattern'],
      },
    },
  },
  async run(args, ctx) {
    const pattern = String(args?.pattern ?? '').trim();
    if (!pattern) return { ok: false, content: 'Error: pattern is required.' };
    const root = args?.path
      ? (isAbsolute(String(args.path)) ? String(args.path) : resolve(ctx.cwd, String(args.path)))
      : ctx.cwd;

    const re = globToRegExp(pattern);
    const matches: { path: string; mtime: number }[] = [];

    async function walk(dir: string): Promise<void> {
      if (matches.length >= MAX_RESULTS) return;
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); }
      catch { return; }
      for (const e of entries) {
        if (matches.length >= MAX_RESULTS) return;
        if (IGNORE.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (e.isFile()) {
          const rel = relative(root, full);
          if (re.test(rel) || re.test(rel.split(sep).join('/'))) {
            try {
              const st = await fs.stat(full);
              matches.push({ path: full, mtime: st.mtimeMs });
            } catch {}
          }
        }
      }
    }
    await walk(root);
    matches.sort((a, b) => b.mtime - a.mtime);
    if (matches.length === 0) return { ok: true, content: `no files match ${pattern} under ${root}` };
    return { ok: true, content: matches.map((m) => m.path).join('\n') + (matches.length === MAX_RESULTS ? `\n<truncated at ${MAX_RESULTS} results>` : '') };
  },
};

function globToRegExp(pattern: string): RegExp {
  // Translate a minimal glob ( * ** ? [abc] ) to a regex that matches paths.
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i++;
      if (pattern[i + 1] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '.') {
      re += '\\.';
    } else if (c === '[') {
      const close = pattern.indexOf(']', i);
      if (close === -1) re += '\\[';
      else { re += pattern.slice(i, close + 1); i = close; }
    } else if ('+()|^$\\{}'.includes(c!)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  re += '$';
  return new RegExp(re);
}
