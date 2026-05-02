import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir } from '../config/index.js';
import type { ChatMessage } from '../api/types.js';

export interface SessionMeta {
  id: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
  model: string;
  messageCount: number;
  firstUserPrompt?: string;
}

export class Session {
  readonly id: string;
  readonly cwd: string;
  readonly path: string;
  private buffer: ChatMessage[] = [];
  meta: SessionMeta;

  constructor(cwd: string, model: string) {
    this.cwd = cwd;
    this.id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const dir = join(projectDir(cwd), 'sessions');
    this.path = join(dir, `${this.id}.jsonl`);
    this.meta = {
      id: this.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cwd,
      model,
      messageCount: 0,
    };
  }

  async append(msg: ChatMessage): Promise<void> {
    this.buffer.push(msg);
    this.meta.updatedAt = Date.now();
    this.meta.messageCount = this.buffer.length;
    if (msg.role === 'user' && !this.meta.firstUserPrompt && typeof msg.content === 'string') {
      this.meta.firstUserPrompt = msg.content.slice(0, 200);
    }
    try {
      await fs.mkdir(join(projectDir(this.cwd), 'sessions'), { recursive: true });
      await fs.appendFile(this.path, JSON.stringify(msg) + '\n', 'utf8');
      const metaPath = this.path.replace(/\.jsonl$/, '.meta.json');
      await fs.writeFile(metaPath, JSON.stringify(this.meta, null, 2), 'utf8');
    } catch {
      // Persistence is best-effort; never break the chat loop on disk issues.
    }
  }

  messages(): ChatMessage[] {
    return this.buffer;
  }

  clear(): void {
    this.buffer = [];
    this.meta.messageCount = 0;
  }
}

export async function loadSession(cwd: string, id: string): Promise<{ meta: SessionMeta; messages: ChatMessage[] } | null> {
  const dir = join(projectDir(cwd), 'sessions');
  const jsonl = join(dir, `${id}.jsonl`);
  const metaPath = join(dir, `${id}.meta.json`);
  if (!existsSync(jsonl) || !existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as SessionMeta;
    const raw = await fs.readFile(jsonl, 'utf8');
    const messages: ChatMessage[] = raw
      .split('\n')
      .filter(Boolean)
      .map((ln) => JSON.parse(ln) as ChatMessage);
    return { meta, messages };
  } catch {
    return null;
  }
}

export async function listSessions(cwd: string, limit = 20): Promise<SessionMeta[]> {
  const dir = join(projectDir(cwd), 'sessions');
  if (!existsSync(dir)) return [];
  const entries = await fs.readdir(dir).catch(() => []);
  const metas: SessionMeta[] = [];
  for (const f of entries) {
    if (!f.endsWith('.meta.json')) continue;
    try {
      const raw = await fs.readFile(join(dir, f), 'utf8');
      metas.push(JSON.parse(raw) as SessionMeta);
    } catch {}
  }
  metas.sort((a, b) => b.updatedAt - a.updatedAt);
  return metas.slice(0, limit);
}
