// Persists subagent runs to `<projectDir>/agent-<id>.meta.json` + `agent-<id>.jsonl`.
// Per-message JSONL flush, best-effort meta updates.

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir, type PermissionMode } from '../config/index.js';
import type { ChatMessage } from '../api/types.js';

export interface AgentRecord {
  id: string;
  type: string;
  parent_id?: string;
  started_at: number;
  status: 'running' | 'done' | 'error' | 'stopped';
  cwd: string;
  model: string;
  tools: string[];
  permission_mode: PermissionMode;
  message_count: number;
  last_user_prompt: string;
  error?: string;
  worktree?: { path: string; branch: string; kept: boolean };
  final_text?: string;
  ended_at?: number;
}

function metaPathFor(cwd: string, id: string): string {
  return join(projectDir(cwd), `agent-${id}.meta.json`);
}
function jsonlPathFor(cwd: string, id: string): string {
  return join(projectDir(cwd), `agent-${id}.jsonl`);
}

export async function ensureAgentDir(cwd: string): Promise<void> {
  await fs.mkdir(projectDir(cwd), { recursive: true });
}

export async function writeRecord(record: AgentRecord): Promise<void> {
  try {
    await ensureAgentDir(record.cwd);
    await fs.writeFile(metaPathFor(record.cwd, record.id), JSON.stringify(record, null, 2), 'utf8');
  } catch {
    // best-effort
  }
}

export async function appendMessage(cwd: string, id: string, msg: ChatMessage): Promise<void> {
  try {
    await ensureAgentDir(cwd);
    await fs.appendFile(jsonlPathFor(cwd, id), JSON.stringify(msg) + '\n', 'utf8');
  } catch {
    // best-effort
  }
}

export async function readRecord(cwd: string, id: string): Promise<AgentRecord | null> {
  const fp = metaPathFor(cwd, id);
  if (!existsSync(fp)) return null;
  try {
    return JSON.parse(await fs.readFile(fp, 'utf8')) as AgentRecord;
  } catch { return null; }
}

export async function readAgentMessages(cwd: string, id: string): Promise<ChatMessage[]> {
  const fp = jsonlPathFor(cwd, id);
  if (!existsSync(fp)) return [];
  try {
    const raw = await fs.readFile(fp, 'utf8');
    return raw.split('\n').filter(Boolean).map((ln) => JSON.parse(ln) as ChatMessage);
  } catch { return []; }
}

export function metaPath(cwd: string, id: string): string { return metaPathFor(cwd, id); }
export function jsonlPath(cwd: string, id: string): string { return jsonlPathFor(cwd, id); }
