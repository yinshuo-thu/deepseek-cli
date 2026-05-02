// In-process registry of running subagent instances. Provides depth/concurrency
// caps, ring buffers for background output, and the AgentRuntime hooks that
// the Agent/SendMessage/Monitor/TaskStop tools call.

import type { ChatMessage } from '../api/types.js';
import type { AgentRuntime, ToolContext } from '../tools/types.js';
import type { AgentRecord } from './persistence.js';
import { MAX_AGENT_DEPTH, MAX_CONCURRENT_AGENTS } from '../config/index.js';

export interface AgentInstance {
  record: AgentRecord;
  messages: ChatMessage[];
  abort: AbortController;
  ringBuffer: string[];     // last ~256 lines
  finalText?: string;
  donePromise: Promise<void>;
  resolveDone: () => void;
  depth: number;
  parentId?: string;
}

const RING_CAP = 256;

class Registry {
  private instances = new Map<string, AgentInstance>();
  private temporaryWorktrees = new Set<string>();

  get(id: string): AgentInstance | undefined { return this.instances.get(id); }

  add(inst: AgentInstance): void { this.instances.set(inst.record.id, inst); }

  remove(id: string): void { this.instances.delete(id); }

  list(): AgentInstance[] { return Array.from(this.instances.values()); }

  trackWorktree(path: string) { this.temporaryWorktrees.add(path); }
  untrackWorktree(path: string) { this.temporaryWorktrees.delete(path); }
  trackedWorktrees(): string[] { return Array.from(this.temporaryWorktrees); }

  /** Append a line to a running agent's ring buffer (background view). */
  pushRing(id: string, line: string): void {
    const inst = this.instances.get(id);
    if (!inst) return;
    inst.ringBuffer.push(line);
    if (inst.ringBuffer.length > RING_CAP) inst.ringBuffer.shift();
  }

  /** Concurrency check — count active under a parent (or at root if no parent). */
  countActiveChildren(parentId: string | undefined): number {
    let n = 0;
    for (const inst of this.instances.values()) {
      if (inst.record.status === 'running' && inst.parentId === parentId) n++;
    }
    return n;
  }

  enforceCaps(parentId: string | undefined, depth: number): string | null {
    if (depth > MAX_AGENT_DEPTH) {
      return `Agent depth ${depth} exceeds MAX_AGENT_DEPTH=${MAX_AGENT_DEPTH}.`;
    }
    if (this.countActiveChildren(parentId) >= MAX_CONCURRENT_AGENTS) {
      return `Too many concurrent subagents (>= ${MAX_CONCURRENT_AGENTS}) under this parent.`;
    }
    return null;
  }
}

export const agentRegistry = new Registry();

export function createInstance(record: AgentRecord, depth: number, parentId?: string): AgentInstance {
  let resolveDone: () => void = () => {};
  const donePromise = new Promise<void>((res) => { resolveDone = res; });
  const abort = new AbortController();
  return {
    record,
    messages: [],
    abort,
    ringBuffer: [],
    donePromise,
    resolveDone,
    depth,
    parentId,
  };
}

/** Best-effort cleanup of any tracked worktrees on process exit. */
let exitHookInstalled = false;
export function installExitHook(prune: (path: string) => Promise<void>) {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const handler = () => {
    for (const p of agentRegistry.trackedWorktrees()) {
      // Fire and forget — process is exiting.
      void prune(p).catch(() => {});
    }
  };
  process.on('exit', handler);
}

export function makeRuntime(spawnFn: AgentRuntime['spawn'], sendFn: AgentRuntime['sendMessage']): AgentRuntime {
  return {
    spawn: spawnFn,
    sendMessage: sendFn,
    monitor({ agentId, sinceLine = 0, maxLines = 100 }) {
      const inst = agentRegistry.get(agentId);
      if (!inst) {
        return { status: 'unknown', lines: [], next_cursor: sinceLine };
      }
      const total = inst.ringBuffer.length;
      // ringBuffer is bounded; treat its current contents as a sliding window
      // whose first line index is (total_pushed - length). We approximate by
      // exposing line numbers relative to the currently retained tail.
      const start = Math.max(0, sinceLine);
      const tail = inst.ringBuffer.slice(start, start + maxLines);
      return {
        status: inst.record.status,
        lines: tail,
        next_cursor: start + tail.length,
        ...(inst.finalText ? { final_text: inst.finalText } : {}),
      };
    },
    taskStop({ agentId }) {
      const inst = agentRegistry.get(agentId);
      if (!inst) return { stopped: false, status: 'unknown' };
      if (inst.record.status === 'running') {
        inst.abort.abort();
      }
      return { stopped: inst.record.status === 'running' || inst.record.status === 'stopped', status: inst.record.status };
    },
  };
}

// Re-export types for convenience.
export type { AgentRuntime, ToolContext };
