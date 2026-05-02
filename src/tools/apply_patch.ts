import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Tool } from './types.js';
import { markRead } from './write.js';

/**
 * apply_patch — accepts a unified-diff-ish patch and applies it to the workspace.
 *
 * Supports the OpenAI/Anthropic "apply_patch" envelope:
 *   *** Begin Patch
 *   *** Update File: relative/path/to/file.ts
 *   @@
 *   -old line
 *   +new line
 *   *** End Patch
 *
 * Also supports *** Add File / *** Delete File envelopes.
 *
 * For Update, hunks are matched by exact context — any single hunk that fails to
 * apply aborts the whole patch (no partial writes).
 */
export const ApplyPatchTool: Tool = {
  requiresPermission: true,
  definition: {
    type: 'function',
    function: {
      name: 'apply_patch',
      description:
        'Apply a unified diff to one or more files atomically. Wrap with `*** Begin Patch` / `*** End Patch`. Each file uses `*** Update File: <path>`, `*** Add File: <path>` or `*** Delete File: <path>`.',
      parameters: {
        type: 'object',
        properties: {
          patch: { type: 'string', description: 'The patch envelope text.' },
        },
        required: ['patch'],
      },
    },
  },
  async run(args, ctx) {
    const text = String(args?.patch ?? '');
    if (!text.includes('*** Begin Patch') || !text.includes('*** End Patch')) {
      return { ok: false, content: 'Error: patch must be wrapped in *** Begin Patch / *** End Patch.' };
    }
    let parsed: PatchOp[];
    try { parsed = parsePatch(text); }
    catch (e) { return { ok: false, content: `parse error: ${(e as Error).message}` }; }
    if (parsed.length === 0) return { ok: false, content: 'patch contained no operations.' };

    const summary = parsed.map((op) => `${op.kind} ${op.path}`).join('\n  ');
    const decision = await ctx.requestPermission('apply_patch', `Apply patch:\n  ${summary}`);
    if (decision === 'deny') return { ok: false, content: 'User denied apply_patch.' };

    // Pre-flight: load all current contents and prepare next contents.
    const writes: { path: string; next: string | null }[] = [];
    for (const op of parsed) {
      const abs = isAbsolute(op.path) ? op.path : resolve(ctx.cwd, op.path);
      if (op.kind === 'delete') {
        if (!existsSync(abs)) return { ok: false, content: `Delete failed: ${abs} does not exist.` };
        writes.push({ path: abs, next: null });
      } else if (op.kind === 'add') {
        if (existsSync(abs)) return { ok: false, content: `Add failed: ${abs} already exists.` };
        writes.push({ path: abs, next: op.body });
      } else {
        if (!existsSync(abs)) return { ok: false, content: `Update failed: ${abs} does not exist.` };
        const current = await fs.readFile(abs, 'utf8');
        const applied = applyHunks(current, op.hunks);
        if (applied === null) return { ok: false, content: `Hunk did not apply cleanly to ${abs}. Re-read the file and resubmit.` };
        writes.push({ path: abs, next: applied });
      }
    }

    // Commit.
    for (const w of writes) {
      if (w.next === null) await fs.unlink(w.path);
      else {
        await fs.mkdir(dirname(w.path), { recursive: true });
        await fs.writeFile(w.path, w.next, 'utf8');
        markRead(w.path);
      }
    }
    return { ok: true, content: `applied ${writes.length} file change${writes.length === 1 ? '' : 's'}:\n  ${summary}` };
  },
};

interface UpdateOp { kind: 'update'; path: string; hunks: Hunk[] }
interface AddOp    { kind: 'add';    path: string; body: string }
interface DeleteOp { kind: 'delete'; path: string }
type PatchOp = UpdateOp | AddOp | DeleteOp;

interface Hunk { contextBefore: string[]; remove: string[]; add: string[]; contextAfter: string[] }

function parsePatch(text: string): PatchOp[] {
  const lines = text.split('\n');
  const ops: PatchOp[] = [];
  let i = 0;
  // Skip until *** Begin Patch
  while (i < lines.length && !lines[i]?.startsWith('*** Begin Patch')) i++;
  if (i >= lines.length) throw new Error('missing *** Begin Patch');
  i++;

  while (i < lines.length) {
    const ln = lines[i] ?? '';
    if (ln.startsWith('*** End Patch')) return ops;
    if (ln.startsWith('*** Update File: ')) {
      const path = ln.slice('*** Update File: '.length).trim();
      i++;
      const hunks: Hunk[] = [];
      while (i < lines.length && !lines[i]!.startsWith('*** ')) {
        if (lines[i] === '@@' || lines[i]!.startsWith('@@')) {
          i++;
          const hunk: Hunk = { contextBefore: [], remove: [], add: [], contextAfter: [] };
          while (i < lines.length && !lines[i]!.startsWith('*** ') && !lines[i]!.startsWith('@@')) {
            const c = lines[i] ?? '';
            const head = c[0];
            const rest = c.slice(1);
            if (head === '+') { hunk.add.push(rest); }
            else if (head === '-') { hunk.remove.push(rest); }
            else if (head === ' ' || c === '') {
              // Context: assigned to before until we see a +/-, then to after.
              if (hunk.add.length === 0 && hunk.remove.length === 0) hunk.contextBefore.push(rest);
              else hunk.contextAfter.push(rest);
            }
            i++;
          }
          hunks.push(hunk);
        } else {
          i++;
        }
      }
      ops.push({ kind: 'update', path, hunks });
    } else if (ln.startsWith('*** Add File: ')) {
      const path = ln.slice('*** Add File: '.length).trim();
      i++;
      const body: string[] = [];
      while (i < lines.length && !lines[i]!.startsWith('*** ')) {
        const c = lines[i] ?? '';
        body.push(c.startsWith('+') ? c.slice(1) : c);
        i++;
      }
      ops.push({ kind: 'add', path, body: body.join('\n') });
    } else if (ln.startsWith('*** Delete File: ')) {
      const path = ln.slice('*** Delete File: '.length).trim();
      i++;
      ops.push({ kind: 'delete', path });
    } else {
      i++;
    }
  }
  throw new Error('missing *** End Patch');
}

function applyHunks(content: string, hunks: Hunk[]): string | null {
  let lines = content.split('\n');
  for (const h of hunks) {
    const search = [...h.contextBefore, ...h.remove, ...h.contextAfter];
    if (search.length === 0) continue;
    const idx = findSubsequence(lines, search);
    if (idx < 0) return null;
    const replace = [...h.contextBefore, ...h.add, ...h.contextAfter];
    lines = [...lines.slice(0, idx), ...replace, ...lines.slice(idx + search.length)];
  }
  return lines.join('\n');
}

function findSubsequence(haystack: string[], needle: string[]): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
