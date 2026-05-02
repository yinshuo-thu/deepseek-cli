// `git worktree add` helper for the `worktree` isolation mode.
// On clean exit we prune the worktree; if it has uncommitted changes or new
// commits, we keep it and surface the path/branch back to the parent.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface ExecResult { stdout: string; stderr: string; code: number }

function exec(cmd: string, args: string[], cwd?: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd });
    let out = '', err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => resolve({ stdout: out, stderr: err, code: code ?? -1 }));
    proc.on('error', () => resolve({ stdout: out, stderr: err, code: -1 }));
  });
}

async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await exec('git', ['rev-parse', '--is-inside-work-tree'], cwd);
  return r.code === 0 && r.stdout.trim() === 'true';
}

export interface WorktreeRef { path: string; branch: string }

export async function addWorktree(cwd: string, agentId: string): Promise<WorktreeRef> {
  if (!await isGitRepo(cwd)) {
    throw new Error('isolation=worktree requires a git repository');
  }
  const branch = `deepseek/agent-${agentId}`;
  const path = await fs.mkdtemp(join(tmpdir(), `deepseek-agent-${agentId}-`));
  // Remove the empty dir — git worktree wants to create it.
  await fs.rm(path, { recursive: true, force: true });
  const r = await exec('git', ['worktree', 'add', '-b', branch, path], cwd);
  if (r.code !== 0) {
    throw new Error(`git worktree add failed: ${r.stderr.trim() || 'exit ' + r.code}`);
  }
  return { path, branch };
}

export async function isWorktreeDirty(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  // Any untracked, modified, or staged content?
  const status = await exec('git', ['status', '--porcelain'], path);
  if (status.code !== 0) return true; // treat error as dirty (don't auto-prune)
  if (status.stdout.trim().length > 0) return true;
  // Any commits ahead of the parent?
  const ahead = await exec('git', ['rev-list', '--count', '@{u}..HEAD'], path);
  if (ahead.code === 0 && Number(ahead.stdout.trim()) > 0) return true;
  return false;
}

export async function pruneWorktree(path: string): Promise<void> {
  if (!existsSync(path)) return;
  // `git worktree remove` from inside the worktree itself is supported via
  // --force from the parent repo path; safer is to call from the worktree.
  await exec('git', ['worktree', 'remove', '--force', path], path);
  // Best-effort directory cleanup if git left anything behind.
  await fs.rm(path, { recursive: true, force: true }).catch(() => {});
}
